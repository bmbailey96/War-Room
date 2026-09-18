// Focused weekly decision engine.
// Offense is projected from actual nflverse weekly production and workload.
// Sleeper projection is kept only as a transparent fallback/comparison.

import { MY_USER_ID, getPlayersTrim, pInfo, slotPos, normName, normTeam, store } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";

const NV = "https://github.com/nflverse/nflverse-data/releases/download";

async function j(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function text(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) return null;
  return r.text();
}
function splitLine(line) {
  const out=[]; let field="", q=false;
  for (let i=0;i<line.length;i++) {
    const c=line[i];
    if (q) {
      if (c === '"') { if (line[i+1] === '"') { field+='"'; i++; } else q=false; }
      else field+=c;
    } else if (c === '"') q=true;
    else if (c === ",") { out.push(field); field=""; }
    else field+=c;
  }
  out.push(field); return out;
}
function parseCsv(textValue, wanted) {
  if (!textValue) return [];
  const lines=textValue.split(/\r?\n/); if (!lines.length) return [];
  const h=splitLine(lines[0]); const ix={};
  for (const w of wanted) { const i=h.indexOf(w); if (i>=0) ix[w]=i; }
  const out=[];
  for (let n=1;n<lines.length;n++) {
    if (!lines[n]) continue;
    const cells=splitLine(lines[n]); const row={};
    for (const [k,i] of Object.entries(ix)) row[k]=cells[i];
    out.push(row);
  }
  return out;
}
const num=v => (v==null || v==="" || v==="NA" || Number.isNaN(+v)) ? 0 : +v;
const avg=a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const round=x=>Math.round(x*10)/10;
const DEFAULT_MODEL = { role: 0.28, matchup: 0.25, environment: 0.35, scheme: 0.22, learned: false };

function easternKickoffMs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const [y,m,d]=dateStr.split("-").map(Number);
  const [hh,mm]=timeStr.split(":").map(Number);
  if (![y,m,d,hh,mm].every(Number.isFinite)) return null;

  // nflverse game times are Eastern. Convert that wall-clock time to UTC
  // without hard-coding EST/EDT, so November's DST transition is correct.
  const guess=Date.UTC(y,m-1,d,hh,mm);
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(guess));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
  const offset=rendered-guess;
  return guess-offset;
}

function playerValue(p) {
  if (!p) return 0;
  return p.locked && p.actual != null ? p.actual : (p.projection || 0);
}

function fantasyPoints(r, s={}, pos=null) {
  const w=(key,fallback=0)=>typeof s[key]==="number"?s[key]:fallback;
  let p=0;
  p+=num(r.passing_yards)*w("pass_yd",0.04);
  p+=num(r.passing_tds)*w("pass_td",4);
  p+=num(r.passing_interceptions)*w("pass_int",-2);
  p+=num(r.completions)*w("pass_cmp",0);
  p+=num(r.attempts)*w("pass_att",0);
  p+=num(r.rushing_yards)*w("rush_yd",0.1);
  p+=num(r.rushing_tds)*w("rush_td",6);
  p+=num(r.carries)*w("rush_att",0);
  p+=num(r.receptions)*w("rec",1);
  p+=num(r.targets)*w("rec_tgt",0);
  p+=num(r.receiving_yards)*w("rec_yd",0.1);
  p+=num(r.receiving_tds)*w("rec_td",6);
  p+=num(r.passing_first_downs)*w("pass_fd",0);
  p+=num(r.rushing_first_downs)*w("rush_fd",0);
  p+=num(r.receiving_first_downs)*w("rec_fd",0);
  p+=num(r.passing_2pt_conversions)*w("pass_2pt",0);
  p+=num(r.rushing_2pt_conversions)*w("rush_2pt",0);
  p+=num(r.receiving_2pt_conversions)*w("rec_2pt",0);
  if(pos==="TE") p+=num(r.receptions)*w("bonus_rec_te",0);

  const py=num(r.passing_yards), ry=num(r.rushing_yards), recy=num(r.receiving_yards);
  if(py>=300)p+=w("bonus_pass_yd_300",0);
  if(py>=400)p+=w("bonus_pass_yd_400",0);
  if(ry>=100)p+=w("bonus_rush_yd_100",0);
  if(ry>=200)p+=w("bonus_rush_yd_200",0);
  if(recy>=100)p+=w("bonus_rec_yd_100",0);
  if(recy>=200)p+=w("bonus_rec_yd_200",0);

  const lost=num(r.rushing_fumbles_lost)+num(r.receiving_fumbles_lost)+num(r.passing_fumbles_lost);
  p+=lost*w("fum_lost",-2);
  return p;
}

function scoreSleeperProjection(stats, scoring, pos=null) {
  if(!stats)return null;
  let total=0, matched=0;
  for(const [key,value] of Object.entries(stats)){
    const weight=scoring?.[key];
    if(typeof value!=="number" || typeof weight!=="number")continue;
    total+=value*weight; matched++;
  }
  if(!matched)return typeof stats.pts_ppr==="number"?round(stats.pts_ppr):null;

  const bonus=k=>typeof scoring?.[k]==="number"?scoring[k]:0;
  if(pos==="TE" && typeof stats.rec==="number") total+=stats.rec*bonus("bonus_rec_te");
  if((stats.pass_yd||0)>=300)total+=bonus("bonus_pass_yd_300");
  if((stats.pass_yd||0)>=400)total+=bonus("bonus_pass_yd_400");
  if((stats.rush_yd||0)>=100)total+=bonus("bonus_rush_yd_100");
  if((stats.rush_yd||0)>=200)total+=bonus("bonus_rush_yd_200");
  if((stats.rec_yd||0)>=100)total+=bonus("bonus_rec_yd_100");
  if((stats.rec_yd||0)>=200)total+=bonus("bonus_rec_yd_200");
  return round(total);
}

function usage(r,pos) {
  if (pos==="QB") return num(r.attempts) + num(r.carries)*1.5;
  if (pos==="RB") return num(r.carries) + num(r.targets)*1.35;
  if (pos==="WR" || pos==="TE") {
    const wopr=num(r.wopr);
    if(wopr>0) return wopr*100;
    return num(r.targets)*1.25 + num(r.carries);
  }
  return 0;
}

function weightedMean(rows, getter) {
  if (!rows.length) return null;
  let n=0,d=0;
  rows.forEach((r,i)=>{ const weight=Math.pow(0.82, rows.length-1-i); n+=getter(r)*weight; d+=weight; });
  return d ? n/d : null;
}

function sd(values) {
  if (values.length < 2) return null;
  const m=avg(values); return Math.sqrt(avg(values.map(v=>(v-m)*(v-m))));
}

function quantile(values, q) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  if(a.length===1)return a[0];
  const p=(a.length-1)*q, lo=Math.floor(p), hi=Math.ceil(p);
  if(lo===hi)return a[lo];
  return a[lo]+(a[hi]-a[lo])*(p-lo);
}

const POS_CV={QB:.28,RB:.45,WR:.5,TE:.5,K:.42,DEF:.48,DL:.48,LB:.42,DB:.48,UNK:.5};

function projectionRange(projection, values, pos) {
  if(projection==null)return {floor:null,ceiling:null,sigma:null,volatility:null,rangeSource:"none"};
  const vals=(values||[]).filter(v=>Number.isFinite(v) && v>=0).slice(-10);
  const center=avg(vals);
  if(vals.length>=4 && center!=null && center>0.5){
    const scale=projection/center;
    const q20=quantile(vals,.20), q80=quantile(vals,.80);
    const histSd=sd(vals);
    const sigma=histSd!=null ? Math.max(1,histSd*scale) : Math.max(1,projection*(POS_CV[pos]||.5));
    return {
      floor:round(Math.min(projection,Math.max(0,(q20??0)*scale))),
      ceiling:round(Math.max(projection,(q80??projection)*scale)),
      sigma:round(sigma),
      volatility:round(sigma/Math.max(1,projection)),
      rangeSource:"empirical",
    };
  }
  const sigma=Math.max(1,projection*(POS_CV[pos]||POS_CV.UNK));
  return {
    floor:round(Math.max(0,projection-.84*sigma)),
    ceiling:round(projection+.84*sigma),
    sigma:round(sigma),
    volatility:round(sigma/Math.max(1,projection)),
    rangeSource:"position_prior",
  };
}

// Abramowitz-Stegun normal CDF approximation. Plenty accurate enough for
// communicating fantasy decision uncertainty without pretending it is exact.
function normalCdf(x) {
  const sign=x<0?-1:1, z=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+.3275911*z);
  const erf=sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-z*z));
  return .5*(1+erf);
}

function probabilityBetter(a,b) {
  if(!a || !b || a.projection==null || b.projection==null)return null;
  const sigma=Math.sqrt(Math.pow(a.sigma||Math.max(1,a.projection*.5),2)+Math.pow(b.sigma||Math.max(1,b.projection*.5),2));
  if(!sigma)return a.projection>b.projection?1:.5;
  return clamp(normalCdf((a.projection-b.projection)/sigma),.01,.99);
}

function confidenceGrade(score) {
  if(score>=75)return "HIGH";
  if(score>=55)return "MEDIUM";
  return "LOW";
}

function playerConfidenceScore({sample=0,priorSample=0,injury=null,source="custom",projection=null,sleeper=null,volatility=null}) {
  let score=50;
  score+=Math.min(18,sample*4);
  score+=Math.min(8,priorSample);
  if(source==="custom")score+=12;
  else if(source==="league_history")score+=5;
  else score-=12;

  const inj=String(injury||"").toLowerCase();
  if(/out|ir|pup|sus/.test(inj))score-=45;
  else if(/doubt/.test(inj))score-=28;
  else if(/question/.test(inj))score-=12;

  if(projection>0 && typeof sleeper==="number"){
    const disagreement=Math.abs(projection-sleeper)/Math.max(4,projection);
    if(disagreement>.4)score-=12;
    else if(disagreement>.25)score-=7;
    else if(disagreement<.1)score+=4;
  }
  if(volatility!=null){
    if(volatility>.7)score-=12;
    else if(volatility>.5)score-=7;
    else if(volatility<.3)score+=4;
  }
  return Math.round(clamp(score,5,95));
}

function lineupSigma(picked) {
  return Math.sqrt((picked||[]).reduce((sum,x)=>{
    const p=x.player;
    if(!p || p.locked)return sum;
    const s=p.sigma||Math.max(1,(p.projection||0)*.5);
    return sum+s*s;
  },0));
}

function lineupRange(picked) {
  let floor=0, ceiling=0;
  for(const x of picked||[]){
    const p=x.player;
    if(!p)continue;
    if(p.locked){
      floor+=p.actual||0; ceiling+=p.actual||0;
    } else {
      floor+=p.floor??p.projection??0;
      ceiling+=p.ceiling??p.projection??0;
    }
  }
  return {floor:round(floor),ceiling:round(ceiling)};
}

async function matchupPointHistory(stateStore, league, week, season) {
  const currentKey=`league_points_${league.league_id}_${season}_w${week}`;
  let current=await stateStore.get(currentKey,{type:"json"}).catch(()=>null);
  if(!current || Date.now()-(current.at||0)>6*60*60*1000){
    const weeks=Array.from({length:Math.max(0,week-1)},(_,i)=>i+1);
    const rows=await Promise.all(weeks.map(w=>
      j(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${w}`).catch(()=>[])
    ));
    const points={};
    rows.forEach((matches,i)=>{
      const w=weeks[i];
      for(const m of matches||[]){
        for(const [pid,pts] of Object.entries(m.players_points||{})){
          if(typeof pts!=="number")continue;
          (points[pid]=points[pid]||[]).push({week:w,pts});
        }
      }
    });
    current={at:Date.now(),points};
    await stateStore.setJSON(currentKey,current).catch(()=>{});
  }

  let prior={points:{}};
  if(league.previous_league_id){
    const priorKey=`league_points_prior_${league.previous_league_id}`;
    prior=await stateStore.get(priorKey,{type:"json"}).catch(()=>null);
    if(!prior){
      // Last ten NFL weeks are enough to establish a league-scored baseline
      // for K/DEF/IDP without making every cold request fan out to 18 calls.
      const weeks=Array.from({length:10},(_,i)=>i+9);
      const rows=await Promise.all(weeks.map(w=>
        j(`https://api.sleeper.app/v1/league/${league.previous_league_id}/matchups/${w}`).catch(()=>[])
      ));
      const points={};
      rows.forEach((matches,i)=>{
        const w=weeks[i];
        for(const m of matches||[]){
          for(const [pid,pts] of Object.entries(m.players_points||{})){
            if(typeof pts!=="number")continue;
            (points[pid]=points[pid]||[]).push({week:w,pts});
          }
        }
      });
      prior={at:Date.now(),points};
      await stateStore.setJSON(priorKey,prior).catch(()=>{});
    }
  }
  return {current:current.points||{},prior:prior?.points||{}};
}

function eligibility(slot, player) {
  if (!player) return false;
  const eligible = new Set([player.slot, ...(player.eligibleSlots || [])].filter(Boolean));
  if (slot==="FLEX") return ["RB","WR","TE"].some(p=>eligible.has(p));
  if (slot==="REC_FLEX") return ["WR","TE"].some(p=>eligible.has(p));
  if (slot==="SUPER_FLEX") return ["QB","RB","WR","TE"].some(p=>eligible.has(p));
  return eligible.has(slot);
}

function hungarianMin(cost) {
  // Rectangular Hungarian algorithm, rows <= columns. Returns the chosen
  // column index for each row. O(n^2 m), tiny for a fantasy lineup.
  const n=cost.length;
  const m=n ? cost[0].length : 0;
  const u=Array(n+1).fill(0), v=Array(m+1).fill(0);
  const p=Array(m+1).fill(0), way=Array(m+1).fill(0);

  for(let i=1;i<=n;i++){
    p[0]=i;
    let j0=0;
    const minv=Array(m+1).fill(Infinity);
    const used=Array(m+1).fill(false);
    do{
      used[j0]=true;
      const i0=p[j0];
      let delta=Infinity, j1=0;
      for(let j=1;j<=m;j++){
        if(used[j]) continue;
        const cur=cost[i0-1][j-1]-u[i0]-v[j];
        if(cur<minv[j]){minv[j]=cur;way[j]=j0;}
        if(minv[j]<delta){delta=minv[j];j1=j;}
      }
      for(let j=0;j<=m;j++){
        if(used[j]){u[p[j]]+=delta;v[j]-=delta;}
        else if(j>0) minv[j]-=delta;
      }
      j0=j1;
    }while(p[j0]!==0);

    do{
      const j1=way[j0];
      p[j0]=p[j1];
      j0=j1;
    }while(j0!==0);
  }

  const assignment=Array(n).fill(-1);
  for(let j=1;j<=m;j++){
    if(p[j]>0 && p[j]<=n) assignment[p[j]-1]=j-1;
  }
  return assignment;
}

function optimize(players, slots, current=[]) {
  // Locked starters are fixed in the exact slot they occupied at kickoff.
  // Everything else is solved as a maximum-weight bipartite assignment:
  // lineup slots on one side, eligible players on the other. This avoids the
  // subtle greedy failure where a multi-eligible IDP gets consumed by DL and
  // leaves LB with a much worse option even though swapping the two is better.
  const assigned=slots.map((slot,index)=>({slot,index,player:null}));
  const used=new Set();
  for(let i=0;i<assigned.length;i++){
    const p=current[i]?.player;
    if(p?.locked){
      assigned[i].player=p;
      used.add(p.pid);
    }
  }

  const rows=assigned.filter(x=>!x.player);
  if(!rows.length){
    return {total:assigned.reduce((s,x)=>s+playerValue(x.player),0),picked:assigned.map(({slot,player})=>({slot,player}))};
  }

  const candidates=players
    .filter(p=>p.projection!=null && !p.out && !p.locked && !used.has(p.pid))
    .sort((a,b)=>playerValue(b)-playerValue(a));

  // One dummy column per open slot guarantees a legal "leave empty" option,
  // so the assignment always exists even with an injured/empty roster.
  const cols=[
    ...candidates,
    ...rows.map((_,i)=>({pid:`__EMPTY_${i}`,dummy:true,projection:0,slot:"EMPTY",eligibleSlots:[]}))
  ];
  const ILLEGAL=1000000;
  const cost=rows.map(row=>cols.map(p=>{
    if(p.dummy) return 0;
    return eligibility(row.slot,p) ? -playerValue(p) : ILLEGAL;
  }));

  const chosen=hungarianMin(cost);
  rows.forEach((row,i)=>{
    const col=chosen[i];
    const p=col>=0?cols[col]:null;
    if(p && !p.dummy && eligibility(row.slot,p)) row.player=p;
  });

  assigned.sort((a,b)=>a.index-b.index);
  return {
    total:assigned.reduce((s,x)=>s+playerValue(x.player),0),
    picked:assigned.map(({slot,player})=>({slot,player})),
  };
}

function currentStarters(matchup, players, slots) {
  const byId=Object.fromEntries(players.map(p=>[p.pid,p]));
  return (matchup?.starters||[]).map((pid,i)=>({slot:slots[i]||"?",player:byId[pid]||null}));
}

function lineupChanges(current, optimal) {
  const curIds=new Set(current.map(x=>x.player?.pid).filter(Boolean));
  const optIds=new Set(optimal.picked.map(x=>x.player?.pid).filter(Boolean));
  const incoming=optimal.picked.filter(x=>x.player && !curIds.has(x.player.pid));
  const outgoing=current.filter(x=>x.player && !optIds.has(x.player.pid));
  const unused=[...outgoing];

  // Pair only when the incoming player can legally occupy the outgoing
  // player's CURRENT slot. This prevents invented "X over Y" swaps caused
  // by a third player shifting between WR/TE/FLEX in the optimized lineup.
  const calls=incoming.map(entry=>{
    const idx=unused.findIndex(out=>eligibility(out.slot,entry.player));
    const out=idx>=0?unused.splice(idx,1)[0]:null;
    return {
      start:entry.player,
      sit:out?.player||null,
      slot:out?.slot||entry.slot,
      directLegal:!!out,
    };
  });

  return {
    calls,
    starts:incoming.map(x=>({slot:x.slot,player:x.player})),
    sits:outgoing.map(x=>({slot:x.slot,player:x.player})),
    unpairedSits:unused,
  };
}

function hardUnavailable(sleeperStatus="", officialStatus="") {
  const combined=`${sleeperStatus||""} ${officialStatus||""}`.toLowerCase();
  return /\b(out|ir|pup|sus|suspended|doubtful)\b/.test(combined);
}

function confidence(sample, injury, fallback) {
  if (fallback) return "LOW";
  if ((injury||"").toLowerCase().includes("question")) return "MEDIUM";
  if (sample>=5) return "HIGH";
  if (sample>=2) return "MEDIUM";
  return "LOW";
}

export default async req => {
  try {
    const url=new URL(req.url);
    const leagues=await getMyLeagues();
    const requested=url.searchParams.get("league");
    const chosen=leagues.find(l=>l.id===requested) || leagues[0];
    if (!chosen) return new Response(JSON.stringify({error:"no leagues found"}),{status:404});

    const [league,rosters,users,state,playersDB] = await Promise.all([
      j(`https://api.sleeper.app/v1/league/${chosen.id}`),
      j(`https://api.sleeper.app/v1/league/${chosen.id}/rosters`),
      j(`https://api.sleeper.app/v1/league/${chosen.id}/users`),
      j("https://api.sleeper.app/v1/state/nfl"),
      getPlayersTrim(),
    ]);
    const week=Number(state.week)||1, season=Number(state.season)||chosen.season;
    const stateStore=store();
    const [learnedModel,learnedReasoning,leaguePointHistory]=await Promise.all([
      stateStore.get(`model_${chosen.id}`,{type:"json"}).catch(()=>null),
      stateStore.get(`reasoning_${chosen.id}`,{type:"json"}).catch(()=>null),
      matchupPointHistory(stateStore,league,week,season),
    ]);
    const model={...DEFAULT_MODEL,...(learnedModel?.weights||{})};
    const positionScale=learnedModel?.positionScale||{};
    const [matchups,currentCsv,priorCsv,snapCsv,injuryCsv,gamesCsv,sleeperProj] = await Promise.all([
      j(`https://api.sleeper.app/v1/league/${chosen.id}/matchups/${week}`).catch(()=>[]),
      text(`${NV}/stats_player/stats_player_week_${season}.csv`),
      text(`${NV}/stats_player/stats_player_week_${season-1}.csv`),
      text(`${NV}/snap_counts/snap_counts_${season}.csv`),
      text(`${NV}/injuries/injuries_${season}.csv`),
      text("https://github.com/nflverse/nfldata/raw/master/data/games.csv"),
      j(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&order_by=ppr`).catch(()=>[]),
    ]);

    const mine=rosters.find(r=>r.owner_id===MY_USER_ID);
    if (!mine) throw new Error("my roster not found in selected league");
    const myMatch=matchups.find(m=>m.roster_id===mine.roster_id);
    const oppMatch=matchups.find(m=>m.matchup_id===myMatch?.matchup_id && m.roster_id!==mine.roster_id);
    const userById=Object.fromEntries(users.map(u=>[u.user_id,u]));
    const rosterById=Object.fromEntries(rosters.map(r=>[r.roster_id,r]));
    const oppRoster=oppMatch ? rosterById[oppMatch.roster_id] : null;
    const oppUser=oppRoster ? userById[oppRoster.owner_id] : null;
    const opponent=(oppUser?.metadata||{}).team_name || oppUser?.display_name || "Opponent";

    const wanted=[
      "player_display_name","position","week","team","opponent_team","season_type",
      "completions","attempts","passing_yards","passing_tds","passing_interceptions","passing_fumbles_lost",
      "carries","rushing_yards","rushing_tds","rushing_fumbles_lost",
      "targets","receptions","receiving_yards","receiving_tds","receiving_fumbles_lost",
      "target_share","air_yards_share","wopr",
      "passing_first_downs","rushing_first_downs","receiving_first_downs",
      "passing_2pt_conversions","rushing_2pt_conversions","receiving_2pt_conversions"
    ];
    const currentRows=parseCsv(currentCsv,wanted).filter(r=>!r.season_type || r.season_type==="REG");
    const priorRows=parseCsv(priorCsv,wanted).filter(r=>!r.season_type || r.season_type==="REG");
    const byName=(rows)=>{
      const m={}; for(const r of rows){ const k=normName(r.player_display_name); if(k)(m[k]=m[k]||[]).push(r); }
      for(const a of Object.values(m)) a.sort((x,y)=>num(x.week)-num(y.week)); return m;
    };
    const cur=byName(currentRows), prior=byName(priorRows);

    // Official weekly injury reports are a second hard-availability source.
    // Sleeper's player metadata can lag designation changes; nflverse mirrors
    // the report/practice status by week and is checked on every board build.
    const officialInjuryByName={};
    for(const r of parseCsv(injuryCsv,[
      "full_name","week","report_status","practice_status",
      "report_primary_injury","practice_primary_injury"
    ])){
      const wk=num(r.week), key=normName(r.full_name||"");
      if(!key || wk>week)continue;
      const prev=officialInjuryByName[key];
      if(!prev || wk>=prev.week){
        officialInjuryByName[key]={
          week:wk,
          status:(r.report_status||r.practice_status||"").trim(),
          practice:(r.practice_status||"").trim(),
          injury:(r.report_primary_injury||r.practice_primary_injury||"").trim(),
        };
      }
    }

    // Offensive snap share is a leading indicator for role changes. The
    // nflverse snap feed updates throughout the week; only use games from
    // before the current fantasy week so Thursday results cannot leak into
    // a Sunday projection.
    const snapByName={};
    for(const r of parseCsv(snapCsv,["player","position","team","week","offense_pct","game_type"])){
      if(r.game_type && r.game_type!=="REG") continue;
      if(num(r.week)>=week) continue;
      const key=normName(r.player||"");
      if(!key) continue;
      let pct=num(r.offense_pct);
      if(pct<=1.01) pct*=100;
      (snapByName[key]=snapByName[key]||[]).push({week:num(r.week),pct});
    }
    for(const rows of Object.values(snapByName)) rows.sort((a,b)=>a.week-b.week);

    // Team pass/run tendency is kept separate from player workload so the
    // learner can discover whether genuine scheme movement matters in this
    // league instead of treating every change as "role."
    const teamWeeks={};
    for(const r of currentRows){
      const wk=num(r.week);
      if(wk>=week || !r.team) continue;
      const tm=normTeam(r.team);
      const k=`${tm}|${wk}`;
      const row=teamWeeks[k]||(teamWeeks[k]={team:tm,week:wk,att:0,car:0});
      row.att+=num(r.attempts);
      row.car+=num(r.carries);
    }
    const formByTeam={};
    for(const row of Object.values(teamWeeks)){
      (formByTeam[row.team]=formByTeam[row.team]||[]).push(row);
    }
    const teamForm={};
    for(const [tm,rows] of Object.entries(formByTeam)){
      rows.sort((a,b)=>a.week-b.week);
      const calc=arr=>{
        const att=arr.reduce((s,x)=>s+x.att,0), car=arr.reduce((s,x)=>s+x.car,0);
        const plays=att+car;
        return plays?att/plays:null;
      };
      const seasonRate=calc(rows), recentRate=calc(rows.slice(-3));
      if(seasonRate!=null && recentRate!=null){
        teamForm[tm]={seasonPassRate:seasonRate,recentPassRate:recentRate,games:rows.length};
      }
    }

    // Defensive matchup strength is deliberately stabilized early in the
    // season. Week 1 alone should not make a defense look elite or terrible.
    // Current-season games only count if they happened before this fantasy
    // week, then earn progressively more weight against the prior-season
    // baseline as the sample grows.
    const buildAllowed=(rows,maxWeek=null)=>{
      const allowed={};
      for(const r of rows){
        if(maxWeek!=null && num(r.week)>=maxWeek)continue;
        const pos=r.position, def=normTeam(r.opponent_team);
        if(!def || !["QB","RB","WR","TE"].includes(pos)) continue;
        const d=(allowed[def]=allowed[def]||{}), b=(d[pos]=d[pos]||{pts:0,weeks:new Set()});
        b.pts+=fantasyPoints(r,league.scoring_settings||{},pos); b.weeks.add(num(r.week));
      }
      const out={};
      for(const [team,v] of Object.entries(allowed)){
        out[team]={};
        for(const [pos,b] of Object.entries(v)){
          out[team][pos]={avg:b.pts/Math.max(1,b.weeks.size),weeks:b.weeks.size};
        }
      }
      return out;
    };
    const currentDefense=buildAllowed(currentRows,week);
    const priorDefense=buildAllowed(priorRows,null);
    const defense={};
    const teams=new Set([...Object.keys(currentDefense),...Object.keys(priorDefense)]);
    for(const team of teams){
      defense[team]={};
      for(const pos of ["QB","RB","WR","TE"]){
        const cur=currentDefense[team]?.[pos], prev=priorDefense[team]?.[pos];
        if(!cur && !prev)continue;
        if(cur && prev){
          const alpha=Math.min(.75,cur.weeks/6);
          defense[team][pos]=prev.avg*(1-alpha)+cur.avg*alpha;
        }else{
          defense[team][pos]=(cur||prev).avg;
        }
      }
    }
    const leagueAllowed={};
    for(const pos of ["QB","RB","WR","TE"]) leagueAllowed[pos]=avg(Object.values(defense).map(d=>d[pos]).filter(x=>x!=null));

    // NFL game context.
    const gameRows=parseCsv(gamesCsv,["season","week","game_type","home_team","away_team","gameday","gametime","spread_line","total_line"]);
    const gameByTeam={};
    const nowMs=Date.now();
    for(const g of gameRows){
      if(num(g.season)!==season || num(g.week)!==week || (g.game_type && g.game_type!=="REG")) continue;
      const h=normTeam(g.home_team), a=normTeam(g.away_team), total=num(g.total_line), spread=num(g.spread_line);
      const hi=total ? total/2 + spread/2 : null, ai=total ? total/2 - spread/2 : null;
      const kickoffMs=easternKickoffMs(g.gameday,g.gametime);
      const locked=kickoffMs!=null && nowMs>=kickoffMs;
      const likelyComplete=kickoffMs!=null && nowMs>=kickoffMs+(5*60*60*1000);
      const shared={kickoffAt:kickoffMs?new Date(kickoffMs).toISOString():null,locked,likelyComplete};
      gameByTeam[h]={opp:a,implied:hi,...shared};
      gameByTeam[a]={opp:h,implied:ai,...shared};
    }
    const impliedAvg=avg(Object.values(gameByTeam).map(x=>x.implied).filter(x=>x!=null))||22;
    const sleeperById=Object.fromEntries((sleeperProj||[]).map(r=>[r.player_id,r]));

    const projectPid=(pid,matchRow)=>{
      const info=pInfo(playersDB,pid), slot=slotPos(info), key=normName(info.name);
      const allCurrent=(cur[key]||[]);
      const c=allCurrent.filter(r=>num(r.week)<week), played=allCurrent.find(r=>num(r.week)===week) || null;
      const p=(prior[key]||[]).slice(-8);
      const hist=[...p,...c];
      const currentMean=weightedMean(c,r=>fantasyPoints(r,league.scoring_settings||{},slot));
      const priorMean=weightedMean(p,r=>fantasyPoints(r,league.scoring_settings||{},slot));
      let rawBase=null;
      if(c.length>=3) rawBase=(currentMean*0.72)+(priorMean!=null?priorMean*0.28:currentMean*0.28);
      else if(c.length===2) rawBase=(currentMean*0.58)+(priorMean!=null?priorMean*0.42:currentMean*0.42);
      else if(c.length===1) rawBase=(currentMean*0.38)+(priorMean!=null?priorMean*0.62:currentMean*0.62);
      else if(priorMean!=null) rawBase=priorMean;

      const leagueCurrent=(leaguePointHistory.current?.[pid]||[]).map(x=>({week:x.week,pts:num(x.pts)}));
      const leaguePrior=(leaguePointHistory.prior?.[pid]||[]).map(x=>({week:x.week,pts:num(x.pts)}));
      const leagueCurrentMean=weightedMean(leagueCurrent,x=>x.pts);
      const leaguePriorMean=weightedMean(leaguePrior.slice(-8),x=>x.pts);
      let leagueBase=null;
      if(leagueCurrent.length>=3) leagueBase=(leagueCurrentMean*0.72)+(leaguePriorMean!=null?leaguePriorMean*0.28:leagueCurrentMean*0.28);
      else if(leagueCurrent.length===2) leagueBase=(leagueCurrentMean*0.58)+(leaguePriorMean!=null?leaguePriorMean*0.42:leagueCurrentMean*0.42);
      else if(leagueCurrent.length===1) leagueBase=(leagueCurrentMean*0.38)+(leaguePriorMean!=null?leaguePriorMean*0.62:leagueCurrentMean*0.62);
      else if(leaguePriorMean!=null) leagueBase=leaguePriorMean;

      const sp=sleeperById[pid], sleeper=scoreSleeperProjection(sp?.stats,league.scoring_settings||{},slot);
      const offense=["QB","RB","WR","TE"].includes(slot);
      let source="custom";
      let base=rawBase;
      if(base==null || !offense) {
        if(leagueBase!=null){
          base=leagueBase;
          source="league_history";
        }else{
          base=typeof sleeper==="number" ? sleeper : null;
          source="sleeper";
        }
      } else {
        base*=positionScale[slot]||1;
      }
      const fallback=source!=="custom";
      let projection=base, reasons=[];
      if(source==="league_history")reasons.push("league-scored history baseline");
      if(source==="sleeper")reasons.push("Sleeper projection fallback");
      const learnedPosScale=source==="custom"?(positionScale[slot]||1):1;
      if(Math.abs(learnedPosScale-1)>=0.03) {
        reasons.push(`${round((learnedPosScale-1)*100)}% learned ${slot} baseline calibration`);
      }
      const game=gameByTeam[normTeam(info.team)];
      const opp=game?.opp || c.at(-1)?.opponent_team || sp?.opponent || null;
      const locked=!!game?.locked;
      const matchupActual=matchRow?.players_points && typeof matchRow.players_points[pid] === "number"
        ? matchRow.players_points[pid] : null;
      const statActual=played ? fantasyPoints(played,league.scoring_settings||{},slot) : null;
      const actual=locked
        ? round(matchupActual != null ? matchupActual : (statActual != null ? statActual : 0))
        : null;
      const signals={ roleRatio:1, matchupRatio:1, environmentRatio:1, schemeRatio:1, opportunityRatio:1, snapRatio:1 };
      if(projection!=null && source==="custom" && ["QB","RB","WR","TE"].includes(slot)){
        const recentUsage=weightedMean(c.slice(-3),r=>usage(r,slot));
        const priorUsage=weightedMean((c.length>3?c.slice(0,-3):p.slice(-5)),r=>usage(r,slot));
        const roleParts=[];
        if(recentUsage!=null && priorUsage>0){
          const ratio=clamp(recentUsage/priorUsage,0.72,1.28);
          signals.opportunityRatio=ratio;
          roleParts.push({ratio,weight:.72});
        }
        const snaps=snapByName[key]||[];
        const recentSnap=weightedMean(snaps.slice(-3),r=>r.pct);
        const priorSnap=weightedMean(snaps.length>3?snaps.slice(-6,-3):[],r=>r.pct);
        if(recentSnap!=null && priorSnap>10){
          const ratio=clamp(recentSnap/priorSnap,0.75,1.25);
          signals.snapRatio=ratio;
          roleParts.push({ratio,weight:.28});
        }
        if(roleParts.length){
          const den=roleParts.reduce((s,x)=>s+x.weight,0);
          const ratio=roleParts.reduce((s,x)=>s+x.ratio*x.weight,0)/den;
          signals.roleRatio=ratio;
          const mult=1+model.role*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% role/workload`);
        }

        const form=teamForm[normTeam(info.team)];
        if(form && form.games>=2){
          const delta=form.recentPassRate-form.seasonPassRate;
          const lean=slot==="RB"?-1:1;
          const ratio=clamp(1+lean*delta,0.86,1.14);
          signals.schemeRatio=ratio;
          const mult=1+model.scheme*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.018) reasons.push(`${round((mult-1)*100)}% recent scheme`);
        }

        if(opp && defense[normTeam(opp)]?.[slot]!=null && leagueAllowed[slot]){
          const ratio=clamp(defense[normTeam(opp)][slot]/leagueAllowed[slot],0.7,1.3);
          signals.matchupRatio=ratio;
          const mult=1+model.matchup*(ratio-1); projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% matchup`);
        }
        if(game?.implied!=null){
          const ratio=clamp(game.implied/impliedAvg,0.75,1.25);
          signals.environmentRatio=ratio;
          const mult=1+model.environment*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% team total`);
        }
      }
      const official=officialInjuryByName[key]||null;
      const sleeperInj=(info.inj||"").toLowerCase();
      const officialStatus=(official?.status||"").toLowerCase();
      const combinedStatus=`${sleeperInj} ${officialStatus}`.trim();
      // "Doubtful" is functionally unavailable for lineup optimization. If a
      // player is upgraded later, the hourly Sleeper refresh / live injury
      // report will put him back into the candidate pool automatically.
      const out=hardUnavailable(sleeperInj,officialStatus);
      if(out){
        projection=0;
        reasons.push(`UNAVAILABLE: ${official?.status||info.inj||"injury designation"}`);
      }else if(/question/.test(combinedStatus) && projection!=null){
        const dnp=/did not practice|dnp/.test((official?.practice||"").toLowerCase());
        const mult=dnp?0.82:0.93;
        projection*=mult;
        reasons.push(`${round((mult-1)*100)}% injury uncertainty`);
      }

      const customVals=hist.slice(-10).map(r=>fantasyPoints(r,league.scoring_settings||{},slot));
      const leagueVals=[...leaguePrior.slice(-8),...leagueCurrent].map(x=>x.pts);
      const rangeVals=source==="custom"?customVals:leagueVals;
      const range=projectionRange(projection,rangeVals,slot);
      const evidenceCurrent=source==="custom"?c.length:leagueCurrent.length;
      const evidencePrior=source==="custom"?p.length:leaguePrior.length;
      const confidenceScore=playerConfidenceScore({
        sample:evidenceCurrent,priorSample:evidencePrior,injury:info.inj,source,
        projection,sleeper,volatility:range.volatility,
      });
      return {
        pid,name:info.name,slot,eligibleSlots:info.fps||[],team:info.team,
        injury:official?.status||info.inj||null,injuryDetail:official?.injury||null,
        practiceStatus:official?.practice||null,availability:out?"UNAVAILABLE":"ACTIVE_CANDIDATE",
        opp:opp?normTeam(opp):null,
        rawBase:rawBase==null?null:round(Math.max(0,rawBase)),
        base:base==null?null:round(Math.max(0,base)),signals,
        projection:projection==null?null:round(Math.max(0,projection)),
        floor:range.floor,ceiling:range.ceiling,sigma:range.sigma,volatility:range.volatility,rangeSource:range.rangeSource,
        sample:evidenceCurrent,priorSample:evidencePrior,confidenceScore,confidence:confidenceGrade(confidenceScore),
        fallback,source,sleeper:typeof sleeper==="number"?round(sleeper):null,reasons,out,
        locked,actual,kickoffAt:game?.kickoffAt||null,likelyComplete:!!game?.likelyComplete,
      };
    };

    const rosterPlayers=(mine.players||[]).map(pid=>projectPid(pid,myMatch));
    const opponentPlayers=(oppRoster?.players||[]).map(pid=>projectPid(pid,oppMatch));

    const slots=(league.roster_positions||[]).filter(s=>s!=="BN" && s!=="IR" && s!=="TAXI");
    const current=currentStarters(myMatch,rosterPlayers,slots);
    const optimal=optimize(rosterPlayers,slots,current);
    const decision=lineupChanges(current,optimal);
    const changes=decision.calls.map(call=>{
      const probability=call.sit?probabilityBetter(call.start,call.sit):null;
      const edge=call.sit && call.start?.projection!=null && call.sit?.projection!=null
        ? round(call.start.projection-call.sit.projection)
        : null;
      const decisionScore=probability==null
        ? (call.start?.confidenceScore||50)
        : Math.round(probability*100);
      return {
        ...call,
        edge,
        beatProbability:probability==null?null:Math.round(probability*100),
        decisionScore,
        decisionConfidence:confidenceGrade(decisionScore),
      };
    });
    decision.calls=changes;
    const currentIds=new Set(current.map(x=>x.player?.pid).filter(Boolean));
    const lockedBench=rosterPlayers
      .filter(p=>p.locked && !currentIds.has(p.pid))
      .sort((a,b)=>(b.actual||0)-(a.actual||0));
    const lockedStarters=current
      .filter(x=>x.player?.locked)
      .map(x=>({slot:x.slot,player:x.player}));
    const currentTotal=current.reduce((s,x)=>s+playerValue(x.player),0);
    const opponentCurrent=currentStarters(oppMatch,opponentPlayers,slots);
    const opponentOptimal=optimize(opponentPlayers,slots,opponentCurrent);
    const opponentCurrentTotal=opponentCurrent.reduce((s,x)=>s+playerValue(x.player),0);
    const mineLocked=current.filter(x=>x.player?.locked).reduce((s,x)=>s+(x.player.actual||0),0);
    const oppLocked=opponentCurrent.filter(x=>x.player?.locked).reduce((s,x)=>s+(x.player.actual||0),0);
    const projectedMargin=round(optimal.total-opponentOptimal.total);
    const mySigma=lineupSigma(optimal.picked), opponentSigma=lineupSigma(opponentOptimal.picked);
    const diffSigma=Math.sqrt(mySigma*mySigma+opponentSigma*opponentSigma);
    const winProbability=diffSigma
      ? clamp(normalCdf(projectedMargin/diffSigma),.03,.97)
      : (projectedMargin>0?.97:projectedMargin<0?.03:.5);
    const posture=winProbability>=.65?"protect_floor":winProbability<=.35?"chase_ceiling":"neutral";
    const myRange=lineupRange(optimal.picked), opponentRange=lineupRange(opponentOptimal.picked);

    // Keep the last pre-kickoff projection for each player. Tuesday's learner
    // grades these against actual league-scored points. Locked players are
    // never overwritten after kickoff, which prevents hindsight from leaking
    // into the training record.
    const projectionKey=`projection_${chosen.id}_${week}`;
    const priorLog=await stateStore.get(projectionKey,{type:"json"}).catch(()=>null);
    const byPid={...(priorLog?.players||{})};
    for(const p of rosterPlayers){
      if(p.locked) continue;
      byPid[p.pid]={
        pid:p.pid,name:p.name,slot:p.slot,team:p.team,rawBase:p.rawBase,base:p.base,projection:p.projection,
        signals:p.signals,fallback:p.fallback,source:p.source,injury:p.injury,
        confidence:p.confidence,confidenceScore:p.confidenceScore,
        floor:p.floor,ceiling:p.ceiling,sigma:p.sigma,volatility:p.volatility,
        savedAt:Date.now(),kickoffAt:p.kickoffAt,
      };
    }
    await stateStore.setJSON(projectionKey,{
      leagueId:chosen.id,season,week,updatedAt:Date.now(),players:byPid,
    }).catch(()=>{});

    return new Response(JSON.stringify({
      league:{id:chosen.id,name:chosen.name,season,status:league.status},
      leagues,week,opponent,
      sourceNote:"QB/RB/WR/TE use nflverse production, workload and context. K/DEF/IDP use actual league-scored history when available. Sleeper is the last fallback.",
      model:{
        weights:model,positionScale,learnedAt:learnedModel?.at||null,samples:learnedModel?.samples||0,
        reasoningCalls:learnedReasoning?.totalCalls||0,drivers:learnedReasoning?.drivers||{}
      },
      currentTotal:round(currentTotal),
      optimalTotal:round(optimal.total),
      gain:round(optimal.total-currentTotal),
      matchup:{
        opponentCurrentTotal:round(opponentCurrentTotal),
        opponentBestTotal:round(opponentOptimal.total),
        projectedMargin,
        winProbability:Math.round(winProbability*100),
        posture,
        range:{mine:myRange,opponent:opponentRange},
        uncertainty:{mine:round(mySigma),opponent:round(opponentSigma)},
        lockedActual:{mine:round(mineLocked),opponent:round(oppLocked)},
      },
      calls:changes,decision,
      lockedBench,lockedStarters,
      current,optimal:optimal.picked,players:rosterPlayers,
    }), { headers:{"content-type":"application/json","cache-control":"no-store"} });
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:502,headers:{"content-type":"application/json"}});
  }
};

export { eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize, confidence, projectionRange, probabilityBetter, normalCdf, playerConfidenceScore, hardUnavailable, fantasyPoints, parseCsv, usage, weightedMean };
