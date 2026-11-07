// Optional real Sleeper smoke test. Fetches both owned leagues and verifies
// GM audit ownership and scoring coverage. No state writes or paid services.
import assert from "node:assert/strict";
import { getMyLeagues } from "../netlify/functions/leagues.mjs";
import { buildGmAudit } from "../netlify/functions/lib/gm-audit-core.mjs";

const OWNER="863128676391383040";
async function get(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error(r.status+" "+url);
 return r.json();
}
const leagues=await getMyLeagues();
assert.ok(leagues.length>=2,"Expected two current owned Sleeper leagues");
const nfl=await get("https://api.sleeper.app/v1/state/nfl");
const all=await get("https://api.sleeper.app/v1/players/nfl");
const db={};
for(const [id,p] of Object.entries(all||{})){
 if(!p||!(p.position||p.fantasy_positions))continue;
 db[id]={n:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(" "),
   p:p.position,fp:p.fantasy_positions||[],a:p.age||null,
   t:p.team||null,inj:p.injury_status||null};
}
for(const choice of leagues.filter(x=>Number(x.season)===Number(nfl.season)).slice(0,2)){
 const id=choice.id;
 const [league,rosters,users,picks]=await Promise.all([
   get("https://api.sleeper.app/v1/league/"+id),
   get("https://api.sleeper.app/v1/league/"+id+"/rosters"),
   get("https://api.sleeper.app/v1/league/"+id+"/users"),
   get("https://api.sleeper.app/v1/league/"+id+"/traded_picks").catch(()=>[])
 ]);
 const count=Math.min(18,Math.max(0,Number(nfl.week)-1));
 const weeks=await Promise.all(Array.from({length:count},(_,i)=>get(
   "https://api.sleeper.app/v1/league/"+id+"/matchups/"+(i+1)
 ).then(rows=>({week:i+1,rows})).catch(()=>({week:i+1,rows:[]}))));
 const audit=buildGmAudit({league,rosters,users,playersDB:db,tradedPicks:picks,
   weeks,transactions:[],ownerId:OWNER,now:Date.now(),scan:null,market:null});
 assert.equal(String(audit.me.rosterId),String(choice.rosterId));
 assert.equal(audit.tradeInventory.teams.length,rosters.length);
 assert.equal(audit.me.depth.players.length,rosters.find(r=>r.owner_id===OWNER)?.players?.length);
 const rostered=new Set(rosters.flatMap(r=>(r.players||[]).map(String)));
 for(const team of audit.tradeInventory.teams)
   for(const player of team.players)
     assert.ok(rostered.has(String(player.id)),"Unexpected unowned player in inventory");
 assert.equal(audit.freeAgents.verified,false,"No live market scan supplied");
 assert.equal(audit.tradeSimulations.length,0,"No trade proposals without verified market");
 console.log(JSON.stringify({
   name:league.name,id,season:league.season,
   mode:audit.league.mode,teamCount:audit.league.teamCount,
   myRosterId:audit.me.rosterId,myPlayerCount:audit.me.depth.players.length,
   record:String(audit.me.wins)+"-"+String(audit.me.losses),
   completedWeeks:audit.coverage.completedWeeks,
   pfRank:audit.me.pfRank,allPlayPct:audit.me.allPlay.allPlayPct,
   allPlayExpectedWins:audit.me.allPlay.expectedWins,
   scheduleLuckWins:audit.me.allPlay.luckWins,
   fullHistory:audit.coverage.completeHistory,
   picks:audit.me.picks.length
 }));
}
console.log("Live Sleeper GM audit smoke test passed for current owned leagues.");
