// Lightweight live free-agent scanner.
// This deliberately avoids the full trade/projection pipeline so the open page
// can poll frequently without rebuilding the entire roster board.

import { getPlayersTrim,pInfo,slotPos,normTeam,json } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { acquisitionPolicy } from "./lib/roster-v2.mjs";
import {
  normalizeSleeperWeekStats,liveUsageCounts,liveGameProgress,liveRoleEmergence
} from "./lib/live-market.mjs";
import { buildTeamGameLocks } from "./roster-actions-background.mjs";

async function text(url){
  const r=await fetch(url,{redirect:"follow"});
  if(!r.ok)return null;
  return r.text();
}

export function buildPulseAlerts({
  rosters=[],db={},liveStatsRaw={},gameLocks={},acquisition={canAddStartedPlayers:false}
}={}){
  const rostered=new Set();
  for(const r of rosters||[])for(const pid of r.players||[])rostered.add(String(pid));

  const liveStatsById=normalizeSleeperWeekStats(liveStatsRaw);
  const teamTotals={};
  for(const [pid,stats] of Object.entries(liveStatsById)){
    const info=pInfo(db,pid),team=normTeam(info.team);
    if(!team)continue;
    const counts=liveUsageCounts(stats);
    const t=teamTotals[team]||(teamTotals[team]={targets:0,rbCarries:0,routes:0});
    t.targets+=Number(counts.targets||0);
    if(slotPos(info)==="RB")t.rbCarries+=Number(counts.carries||0);
    t.routes=Math.max(t.routes,Number(counts.teamRoutes||0));
  }

  const alerts=[];
  for(const [pid,stats] of Object.entries(liveStatsById)){
    if(rostered.has(String(pid)))continue;
    const info=pInfo(db,pid),pos=slotPos(info),team=normTeam(info.team);
    if(!team||!["RB","WR","TE"].includes(pos))continue;
    const game=gameLocks[team]||null;
    const progress=liveGameProgress(game?.kickoffAt,Date.now());
    if(progress<=0)continue;
    const totals=teamTotals[team]||{};
    const liveRole=liveRoleEmergence({
      pos,stats,progress,
      teamTargets:totals.targets||0,
      teamRbCarries:totals.rbCarries||0,
      teamRoutes:totals.routes||0
    });
    if(!liveRole?.strong)continue;
    const started=!!game?.locked;
    alerts.push({
      pid:String(pid),name:info.name,pos,team,
      score:Number(liveRole.score||0),
      immediateFreeAgent:started&&!!acquisition.canAddStartedPlayers,
      waiverOnly:started&&!acquisition.canAddStartedPlayers,
      liveRole
    });
  }

  alerts.sort((a,b)=>b.score-a.score||
    Number(b.liveRole?.liveTargetShare||b.liveRole?.liveCarryShare||0)-
    Number(a.liveRole?.liveTargetShare||a.liveRole?.liveCarryShare||0));
  return alerts.slice(0,10);
}

export default async req=>{
  try{
    const url=new URL(req.url);
    let leagueId=url.searchParams.get("league");
    if(!leagueId){
      const leagues=await getMyLeagues();
      leagueId=leagues[0]?.id||null;
    }
    if(!leagueId)return new Response(JSON.stringify({error:"no league"}),{status:404});

    const [league,rosters,state,db,gamesCsv]=await Promise.all([
      json(`https://api.sleeper.app/v1/league/${leagueId}`),
      json(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
      json("https://api.sleeper.app/v1/state/nfl"),
      getPlayersTrim(),
      text("https://github.com/nflverse/nfldata/raw/master/data/games.csv")
    ]);
    const season=Number(state?.season)||Number(league?.season);
    const week=Math.max(1,Number(state?.week)||1);
    const liveStatsRaw=await json(
      `https://api.sleeper.app/v1/stats/nfl/regular/${season}/${week}`
    ).catch(()=>({}));
    const acquisition=acquisitionPolicy(league);
    const gameLocks=buildTeamGameLocks(gamesCsv,season,week,Date.now());
    const alerts=buildPulseAlerts({rosters,db,liveStatsRaw,gameLocks,acquisition});
    // Only change the signature when the actionable alert set changes.
    // Target/carry counters move constantly and should not trigger a full rebuild.
    const signature=alerts.map(a=>
      [a.pid,a.immediateFreeAgent?"NOW":a.waiverOnly?"WAIVER":"OPEN"].join(":")
    ).sort().join("|");

    return new Response(JSON.stringify({
      at:Date.now(),league:{id:leagueId,name:league?.name||"",season,week},
      acquisition,alerts,signature
    }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{
      status:502,headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }
};
