// Focused weekly decision engine.
// Offense is projected from actual nflverse weekly production and workload.
// Sleeper projection is kept only as a transparent fallback/comparison.

import { MY_USER_ID, getPlayersTrim, pInfo, slotPos, normName, normTeam } from "./lib/ocho.mjs";
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

function fantasyPoints(r, s={}) {
  const w=(key, fallback=0)=> typeof s[key] === "number" ? s[key] : fallback;
  let p=0;
  p += num(r.passing_yards) * w("pass_yd", 0.04);
  p += num(r.passing_tds) * w("pass_td", 4);
  p += num(r.passing_interceptions) * w("pass_int", -2);
  p += num(r.rushing_yards) * w("rush_yd", 0.1);
  p += num(r.rushing_tds) * w("rush_td", 6);
  p += num(r.receptions) * w("rec", 1);
  p += num(r.receiving_yards) * w("rec_yd", 0.1);
  p += num(r.receiving_tds) * w("rec_td", 6);
  p += num(r.fantasy_points) && !Object.keys(s).length ? num(r.fantasy_points) : 0;
  const lost = num(r.rushing_fumbles_lost)+num(r.receiving_fumbles_lost)+num(r.passing_fumbles_lost);
  p += lost * w("fum_lost", -2);
  return p;
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

function eligibility(slot, pos) {
  if (slot==="FLEX") return ["RB","WR","TE"].includes(pos);
  if (slot==="REC_FLEX") return ["WR","TE"].includes(pos);
  if (slot==="SUPER_FLEX") return ["QB","RB","WR","TE"].includes(pos);
  return slot===pos;
}

function optimize(players, slots) {
  const usable=players.filter(p=>p.projection!=null && !p.out).sort((a,b)=>b.projection-a.projection);
  let best=null;
  function walk(i, used, picked, total) {
    if (i===slots.length) {
      if (!best || total>best.total) best={total,picked:[...picked]};
      return;
    }
    const slot=slots[i];
    const candidates=usable.filter(p=>!used.has(p.pid) && eligibility(slot,p.slot));
    if (!candidates.length) { walk(i+1,used,[...picked,{slot,player:null}],total); return; }
    for (const p of candidates.slice(0,12)) {
      used.add(p.pid); picked.push({slot,player:p});
      walk(i+1,used,picked,total+p.projection);
      picked.pop(); used.delete(p.pid);
    }
  }
  walk(0,new Set(),[],0);
  return best || {total:0,picked:[]};
}

function currentStarters(matchup, players, slots) {
  const byId=Object.fromEntries(players.map(p=>[p.pid,p]));
  return (matchup?.starters||[]).map((pid,i)=>({slot:slots[i]||"?",player:byId[pid]||null}));
}

function calls(current, optimal) {
  const curIds=new Set(current.map(x=>x.player?.pid).filter(Boolean));
  const optIds=new Set(optimal.picked.map(x=>x.player?.pid).filter(Boolean));
  const incoming=optimal.picked.filter(x=>x.player && !curIds.has(x.player.pid));
  const outgoing=current.filter(x=>x.player && !optIds.has(x.player.pid));
  return incoming.map((x,i)=>{
    const out=outgoing[i] || null;
    return {
      start:x.player,
      sit:out?.player||null,
      slot:x.slot,
      gain:round((x.player?.projection||0)-(out?.player?.projection||0)),
    };
  }).sort((a,b)=>b.gain-a.gain);
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
      "attempts","passing_yards","passing_tds","passing_interceptions","passing_fumbles_lost",
      "carries","rushing_yards","rushing_tds","rushing_fumbles_lost",
      "targets","receptions","receiving_yards","receiving_tds","receiving_fumbles_lost"
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
      b.pts+=fantasyPoints(r,league.scoring_settings||{}); b.weeks.add(num(r.week));
    }
    const defense={};
    for(const [team,v] of Object.entries(allowed)){
      defense[team]={}; for(const [pos,b] of Object.entries(v)) defense[team][pos]=b.pts/Math.max(1,b.weeks.size);
    }
    const leagueAllowed={};
    for(const pos of ["QB","RB","WR","TE"]) leagueAllowed[pos]=avg(Object.values(defense).map(d=>d[pos]).filter(x=>x!=null));

    // NFL game context.
    const gameRows=parseCsv(gamesCsv,["season","week","game_type","home_team","away_team","spread_line","total_line"]);
    const gameByTeam={};
    for(const g of gameRows){
      if(num(g.season)!==season || num(g.week)!==week || (g.game_type && g.game_type!=="REG")) continue;
      const h=normTeam(g.home_team), a=normTeam(g.away_team), total=num(g.total_line), spread=num(g.spread_line);
      const hi=total ? total/2 + spread/2 : null, ai=total ? total/2 - spread/2 : null;
      gameByTeam[h]={opp:a,implied:hi}; gameByTeam[a]={opp:h,implied:ai};
    }
    const impliedAvg=avg(Object.values(gameByTeam).map(x=>x.implied).filter(x=>x!=null))||22;
    const sleeperById=Object.fromEntries((sleeperProj||[]).map(r=>[r.player_id,r]));

    const rosterPlayers=(mine.players||[]).map(pid=>{
      const info=pInfo(playersDB,pid), slot=slotPos(info), key=normName(info.name);
      const c=(cur[key]||[]).filter(r=>num(r.week)<week), p=(prior[key]||[]).slice(-8);
      const hist=[...p,...c];
      const currentMean=weightedMean(c,r=>fantasyPoints(r,league.scoring_settings||{}));
      const priorMean=weightedMean(p,r=>fantasyPoints(r,league.scoring_settings||{}));
      let base=null;
      if(c.length>=3) base=(currentMean*0.72)+(priorMean!=null?priorMean*0.28:currentMean*0.28);
      else if(c.length===2) base=(currentMean*0.58)+(priorMean!=null?priorMean*0.42:currentMean*0.42);
      else if(c.length===1) base=(currentMean*0.38)+(priorMean!=null?priorMean*0.62:currentMean*0.62);
      else if(priorMean!=null) base=priorMean;

      const sp=sleeperById[pid], sleeper=sp?.stats?.pts_ppr ?? null;
      let fallback=false;
      if(base==null || !["QB","RB","WR","TE"].includes(slot)) {
        base=typeof sleeper==="number" ? sleeper : null; fallback=true;
      }
      let projection=base, reasons=[];
      const game=gameByTeam[normTeam(info.team)];
      const opp=game?.opp || c.at(-1)?.opponent_team || sp?.opponent || null;
      if(projection!=null && !fallback && ["QB","RB","WR","TE"].includes(slot)){
        const recentUsage=weightedMean(c.slice(-3),r=>usage(r,slot));
        const priorUsage=weightedMean((c.length>3?c.slice(0,-3):p.slice(-5)),r=>usage(r,slot));
        if(recentUsage!=null && priorUsage>0){
          const ratio=clamp(recentUsage/priorUsage,0.72,1.28), mult=1+0.28*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% role/workload`);
        }
        if(opp && defense[normTeam(opp)]?.[slot]!=null && leagueAllowed[slot]){
          const ratio=clamp(defense[normTeam(opp)][slot]/leagueAllowed[slot],0.7,1.3);
          const mult=1+0.25*(ratio-1); projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% matchup`);
        }
        if(game?.implied!=null){
          const ratio=clamp(game.implied/impliedAvg,0.75,1.25), mult=1+0.35*(ratio-1);
          projection*=mult;
          if(Math.abs(mult-1)>=0.025) reasons.push(`${round((mult-1)*100)}% team total`);
        }
      }
      const inj=(info.inj||"").toLowerCase();
      const out=/out|ir|pup|sus/.test(inj);
      if(out) projection=0;
      else if(/doubt/.test(inj) && projection!=null){ projection*=0.45; reasons.push("-55% injury status"); }
      else if(/question/.test(inj) && projection!=null){ projection*=0.93; reasons.push("-7% injury uncertainty"); }

      const vals=hist.slice(-8).map(r=>fantasyPoints(r,league.scoring_settings||{}));
      const sigma=sd(vals) ?? (projection!=null?projection*0.5:null);
      return {
        pid,name:info.name,slot,team:info.team,injury:info.inj||null,opp:opp?normTeam(opp):null,
        projection:projection==null?null:round(Math.max(0,projection)),
        floor:projection==null?null:round(Math.max(0,projection-(sigma||0)*0.75)),
        ceiling:projection==null?null:round(projection+(sigma||0)*0.9),
        sample:c.length,priorSample:p.length,confidence:confidence(c.length,info.inj,fallback),
        fallback,sleeper:typeof sleeper==="number"?round(sleeper):null,reasons,out,
      };
    });

    const slots=(league.roster_positions||[]).filter(s=>s!=="BN" && s!=="IR" && s!=="TAXI");
    const current=currentStarters(myMatch,rosterPlayers,slots);
    const optimal=optimize(rosterPlayers,slots);
    const changes=calls(current,optimal);

    return new Response(JSON.stringify({
      league:{id:chosen.id,name:chosen.name,season,status:league.status},
      leagues,week,opponent,
      sourceNote:"QB/RB/WR/TE use actual nflverse weekly production and workload plus matchup/game context. Sleeper is comparison/fallback only. K/DEF/IDP currently use fallback.",
      currentTotal:round(current.reduce((s,x)=>s+(x.player?.projection||0),0)),
      optimalTotal:round(optimal.total),
      gain:round(optimal.total-current.reduce((s,x)=>s+(x.player?.projection||0),0)),
      calls:changes,
      current,optimal:optimal.picked,players:rosterPlayers,
    }), { headers:{"content-type":"application/json","cache-control":"no-store"} });
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:502,headers:{"content-type":"application/json"}});
  }
};
