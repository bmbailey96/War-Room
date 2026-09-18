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
const DEFAULT_MODEL = { role: 0.28, matchup: 0.25, environment: 0.35, learned: false };

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
  if (p.locked && p.actual != null) {
    // Once the game is truly complete, actual points are the only truth.
    // While it is merely locked/in progress, keep at least the pregame
    // expectation in the matchup forecast so a 1Q score of 0.0 does not get
    // mistaken for the player's final outcome.
    if (p.completed) return p.actual;
    return Math.max(p.actual, p.projection || 0);
  }
  return p.projection || 0;
}

async function exactLeagueHistory(stateStore, leagueId, week) {
  if (week <= 1) return {};
  const cacheKey=`exact_points_${leagueId}_through_${week-1}`;
  const cached=await stateStore.get(cacheKey,{type:"json"}).catch(()=>null);
  if(cached && Date.now()-cached.at < 12*60*60*1000) return cached.byPid||{};

  const first=Math.max(1,week-6);
  const weeks=[];
  for(let w=first;w<week;w++) weeks.push(w);
  const responses=await Promise.all(
    weeks.map(w=>j(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`).catch(()=>[]))
  );
  const byPid={};
  responses.forEach((rows,i)=>{
    const w=weeks[i];
    for(const row of rows||[]){
      for(const [pid,pts] of Object.entries(row.players_points||{})){
        if(typeof pts!=="number") continue;
        (byPid[pid]=byPid[pid]||[]).push({week:w,points:pts});
      }
    }
  });
  for(const rows of Object.values(byPid)) rows.sort((a,b)=>a.week-b.week);
  await stateStore.setJSON(cacheKey,{at:Date.now(),leagueId,throughWeek:week-1,byPid}).catch(()=>{});
  return byPid;
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
  if (pos==="RB") return num(r.carries) + num(r.targets)*1.25;
  if (pos==="WR" || pos==="TE") return num(r.targets)*1.25 + num(r.carries);
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

function eligibility(slot, player) {
  if (!player) return false;
  const eligible = new Set([player.slot, ...(player.eligibleSlots || [])].filter(Boolean));
  if (slot==="FLEX") return ["RB","WR","TE"].some(p=>eligible.has(p));
  if (slot==="REC_FLEX") return ["WR","TE"].some(p=>eligible.has(p));
  if (slot==="SUPER_FLEX") return ["QB","RB","WR","TE"].some(p=>eligible.has(p));
  return eligible.has(slot);
}

function optimize(players, slots, current=[]) {
  // Locked starters are fixed in their exact occupied slots. Locked bench
  // players are unavailable. For everything else, solve the lineup exactly
  // with a slot-bitmask DP instead of a greedy fill. This handles odd
  // multi-position eligibility without sacrificing a scarce TE/WR/DL slot.
  const assigned=slots.map((slot,index)=>({slot,index,player:null}));
  const used=new Set();
  for(let i=0;i<assigned.length;i++){
    const p=current[i]?.player;
    if(p?.locked){
      assigned[i].player=p;
      used.add(p.pid);
    }
  }

  const open=assigned.filter(x=>!x.player);
  const pool=players.filter(p=>p.projection!=null && !p.out && !p.locked && !used.has(p.pid));
  const fullMask=(1<<open.length)-1;
  let dp=new Map([[0,{score:0,picks:Array(open.length).fill(null)}]]);

  for(const p of pool){
    const next=new Map(dp);
    for(const [mask,state] of dp){
      for(let i=0;i<open.length;i++){
        const bit=1<<i;
        if(mask&bit) continue;
        if(!eligibility(open[i].slot,p)) continue;
        const newMask=mask|bit;
        const score=state.score+(p.projection||0);
        const prev=next.get(newMask);
        if(!prev || score>prev.score){
          const picks=state.picks.slice();
          picks[i]=p;
          next.set(newMask,{score,picks});
        }
      }
    }
    dp=next;
  }

  let best=dp.get(fullMask)||null;
  if(!best){
    // A malformed/incomplete roster can leave a slot unfillable. Prefer the
    // state with the most filled slots, then the highest point total.
    let bestCount=-1;
    for(const [mask,state] of dp){
      let count=0,x=mask;
      while(x){count+=x&1;x>>=1;}
      if(count>bestCount || (count===bestCount && (!best || state.score>best.score))){
        bestCount=count; best=state;
      }
    }
  }

  for(let i=0;i<open.length;i++) open[i].player=best?.picks?.[i]||null;
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

function confidence(sample, injury, fallback) {
  if (fallback) return "LOW";
  if ((inj||"").toLowerCase().includes("question")) return "MEDIUM";
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
    const [learnedModel,learnedReasoning,exactHistory]=await Promise.all([
      stateStore.get(`model_${chosen.id}`,{type:"json"}).catch(()=>null),
      stateStore.get(`reasoning_${chosen.id}`,{type:"json"}).catch(()=>null),
      exactLeagueHistory(stateStore,chosen.id,week),
    ]);
    const model={...DEFAULT_MODEL,...(learnedModel?.weights||{})};
    const positionScale=learnedModel?.positionScale||{};
    const [matchups,currentCsv,priorCsv,gamesCsv,sleeperProj] = await Promise.all([
      j(`https://api.sleeper.app/v1/league/${chosen.id}/matchups/${week}`).catch(()=>[]),
      text(`${NV}/stats_player/stats_player_week_${season}.csv`),
      text(`${NV}/stats_player/stats_player_week_${season-1}.csv`),
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

    // League-wide defense allowed by position, current season only.
    const allowed={};
    for(const r of currentRows){
      const pos=r.position, def=normTeam(r.opponent_team);
      if(!def || !["QB","RB","WR","TE"].includes(pos)) continue;
      const d=(allowed[def]=allowed[def]||{}), b=(d[pos]=d[pos]||{pts:0,weeks:new Set()});
      b.pts+=fantasyPoints(r,league.scoring_settings||{},pos); b.weeks.add(num(r.week));
    }
    const defense={};
    for(const [team,v] of Object.entries(allowed)){
      defense[team]={}; for(const [pos,b] of Object.entries(v)) defense[team][pos]=b.pts/Math.max(1,b.weeks.size);
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
      const exactRows=exactHistory[pid]||[];
      const exactMean=weightedMean(exactRows,r=>r.points);
      const nflverseMean=weightedMean(c,r=>fantasyPoints(r,league.scoring_settings||{},slot));
      const currentMean=exactMean!=null?exactMean:nflverseMean;
      const currentSamples=exactRows.length||c.length;
      const priorMean=weightedMean(p,r=>fantasyPoints(r,league.scoring_settings||{},slot));
      let rawBase=null;
      if(currentSamples>=3) rawBase=(currentMean*0.72)+(priorMean!=null?priorMean*0.28:currentMean*0.28);
      else if(currentSamples===2) rawBase=(currentMean*0.58)+(priorMean!=null?priorMean*0.42:currentMean*0.42);
      else if(currentSamples===1) rawBase=(currentMean*0.38)+(priorMean!=null?priorMean*0.62:currentMean*0.62);
      else if(priorMean!=null) rawBase=priorMean;

      const sp=sleeperById[pid], sleeper=scoreSleeperProjection(sp?.stats,league.scoring_settings||{},slot);
      let fallback=false;
      let base=rawBase;
      if(base==null || !["QB","RB","WR","TE"].includes(slot)) {
        base=typeof sleeper==="number" ? sleeper : null; fallback=true;
      } else {
        base*=positionScale[slot]||1;
      }
      let projection=base, reasons=[];
      const learnedPosScale=!fallback?(positionScale[slot]||1):1;
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
      const completed=!!played || !!game?.likelyComplete;
      const signals={ roleRatio:1, matchupRatio:1, environmentRatio:1 };
      if(projection!=null && !fallback && ["QB","RB","WR","TE"].includes(slot)){
        const recentUsage=weightedMean(c.slice(-3),r=>usage(r,slot));
        const priorUsage=weightedMean((c.length>3?c.slice(0,-3):p.slice(-5)),r=>usage(r,slot));
        if(recentUsage!=null && priorUsage>0){
          const ratio=clamp(recentUsage/priorUsage,0.72,1.28);
          signals.roleRatio=ratio;
          const mult=1+model.role*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% role/workload`);
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
      const inj=(info.inj||"").toLowerCase();
      const out=/out|ir|pup|sus/.test(inj);
      if(out) projection=0;
      else if(/doubt/.test(inj) && projection!=null){ projection*=0.45; reasons.push("-55% injury status"); }
      else if(/question/.test(inj) && projection!=null){ projection*=0.93; reasons.push("-7% injury uncertainty"); }

      const vals=hist.slice(-8).map(r=>fantasyPoints(r,league.scoring_settings||{},slot));
      const sigma=sd(vals) ?? (projection!=null?projection*0.5:null);
      return {
        pid,name:info.name,slot,eligibleSlots:info.fps||[],team:info.team,injury:info.inj||null,opp:opp?normTeam(opp):null,
        rawBase:rawBase==null?null:round(Math.max(0,rawBase)),
        base:base==null?null:round(Math.max(0,base)),signals,
        projection:projection==null?null:round(Math.max(0,projection)),
        floor:projection==null?null:round(Math.max(0,projection-(sigma||0)*0.75)),
        ceiling:projection==null?null:round(projection+(sigma||0)*0.9),
        sample:currentSamples,priorSample:p.length,confidence:confidence(currentSamples,info.inj,fallback),
        fallback,sleeper:typeof sleeper==="number"?round(sleeper):null,reasons,out,
        exactHistory:exactRows.length,
        locked,actual,completed,kickoffAt:game?.kickoffAt||null,likelyComplete:!!game?.likelyComplete,
      };
    };

    const rosterPlayers=(mine.players||[]).map(pid=>projectPid(pid,myMatch));
    const opponentPlayers=(oppRoster?.players||[]).map(pid=>projectPid(pid,oppMatch));

    const slots=(league.roster_positions||[]).filter(s=>s!=="BN" && s!=="IR" && s!=="TAXI");
    const current=currentStarters(myMatch,rosterPlayers,slots);
    const optimal=optimize(rosterPlayers,slots,current);
    const decision=lineupChanges(current,optimal);
    const changes=decision.calls;
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
    const posture=projectedMargin>=8?"protect_floor":projectedMargin<=-8?"chase_ceiling":"neutral";

    // Read path only. Pregame training snapshots are frozen exclusively by
    // lineup-refresh.mjs so opening or refreshing the website cannot alter
    // what Tuesday's learner thinks the model believed before kickoff.

    return new Response(JSON.stringify({
      league:{id:chosen.id,name:chosen.name,season,status:league.status},
      leagues,week,opponent,
      sourceNote:"QB/RB/WR/TE use exact completed-week points from this Sleeper league for the scoring baseline, then independent nflverse workload/matchup data and game context to project forward. Sleeper future projections are comparison/fallback only. K/DEF/IDP currently use fallback.",
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
        posture,
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

export { eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize };
