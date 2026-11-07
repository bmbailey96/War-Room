import assert from "node:assert/strict";
import { buildGmAudit,scoreAllPlay } from "../netlify/functions/lib/gm-audit-core.mjs";
import auditEndpoint from "../netlify/functions/gm-audit.mjs";

const now=Date.parse("2026-11-07T02:00:00Z");
const MY_OWNER="me";
const db={};
const put=(id,pos,inj=null,age=26)=>{
  db[id]={n:id,p:pos,fp:[pos],t:"NFL",inj,a:age};
};
for(const id of ["My QB","My RB 1","My RB 2","My WR 1","My WR 2",
  "My TE 1","My TE 2","My TE 3","My TE 4","Partner RB 1",
  "Partner RB 2","Partner RB 3","Partner RB 4",
  "Partner QB","Partner WR","Partner TE","Free RB",
  "C RB","C WR","C QB","C TE","D RB","D WR","D QB","D TE"]) {
  const pos=/QB/.test(id)?"QB":/RB/.test(id)?"RB":/WR/.test(id)?"WR":"TE";
  put(id,pos);
}
const players=["My QB","My RB 1","My RB 2","My WR 1","My WR 2","My TE 1","My TE 2","My TE 3","My TE 4"];
const rosters=[
  {roster_id:1,owner_id:MY_OWNER,players,settings:{wins:1,losses:1,fpts:200,ppts:245,fpts_against:240}},
  {roster_id:2,owner_id:"partner",players:["Partner QB","Partner RB 1","Partner RB 2","Partner RB 3","Partner RB 4","Partner WR","Partner TE"],
    settings:{wins:1,losses:1,fpts:240,ppts:260,fpts_against:205}},
  {roster_id:3,owner_id:"C",players:["C QB","C RB","C WR","C TE"],
    settings:{wins:1,losses:1,fpts:190,ppts:210,fpts_against:210}},
  {roster_id:4,owner_id:"D",players:["D QB","D RB","D WR","D TE"],
    settings:{wins:1,losses:1,fpts:210,ppts:220,fpts_against:195}},
];
const users=[
  {user_id:MY_OWNER,display_name:"My team"},
  {user_id:"partner",display_name:"Good Partner"},
  {user_id:"C",display_name:"C team"},
  {user_id:"D",display_name:"D team"}
];
const league={league_id:"LEAGUE",name:"The Ocho",season:"2026",status:"in_season",
  settings:{type:2,pick_trading:1,draft_rounds:3,playoff_teams:2},
  roster_positions:["QB","RB","RB","WR","WR","TE","FLEX","BN"],
  scoring_settings:{rec:1}};
const weeks=[
 {week:1,rows:[
   {roster_id:1,points:120,players_points:{"My RB 1":20,"My TE 1":12}},
   {roster_id:2,points:110,players_points:{"Partner RB 1":28}},
   {roster_id:3,points:100,players_points:{"C RB":10}},
   {roster_id:4,points:90,players_points:{"D RB":8}},
 ]},
 {week:2,rows:[
   {roster_id:1,points:80,players_points:{"My RB 1":12,"My TE 1":15}},
   {roster_id:2,points:130,players_points:{"Partner RB 1":30}},
   {roster_id:3,points:90,players_points:{"C RB":9}},
   {roster_id:4,points:110,players_points:{"D RB":13}},
 ]},
];
const transactions=[{week:1,rows:[{transaction_id:"X",type:"trade",status:"complete",consenter_ids:[1,2],adds:{"My TE 1":1,"Partner RB 1":2},drops:{}}]}];
const tradedPicks=[{season:"2027",round:1,roster_id:3,owner_id:1,previous_owner_id:3}];
const scan={at:now-5*60000,actions:[
  {type:"ADD_DROP",headline:"Add Free RB",add:{name:"Free RB",pid:"Free RB"},drop:{name:"My TE 4"},weeklyDelta:1.5,immediateFreeAgent:true},
  {type:"ADD_DROP",headline:"Add Already Owned",add:{name:"Partner RB 1",pid:"Partner RB 1"},weeklyDelta:3,immediateFreeAgent:true}
],context:{deterministicTrades:[
  {partner:"Good Partner",target:"Partner RB 1",send:[{type:"player",name:"My TE 3"}],weeklyDelta:2,partnerWeeklyDelta:0.5,marketDelta:3},
  {partner:"Good Partner",target:"Partner RB 1",send:[{type:"pick",name:"2027 1st"}],weeklyDelta:2,partnerWeeklyDelta:1},
  {partner:"Good Partner",target:"C RB",send:[{type:"player",name:"My TE 2"}],weeklyDelta:4,partnerWeeklyDelta:1},
  {partner:"Good Partner",target:"Partner RB 2",send:[{type:"player",name:"Not Mine"}],weeklyDelta:3,partnerWeeklyDelta:1}
]}};

const args={league,rosters,users,playersDB:db,tradedPicks,weeks,transactions,ownerId:MY_OWNER,now,scan};
const audit=buildGmAudit(args);
assert.equal(typeof auditEndpoint,"function");
assert.equal(audit.me.name,"My team");
assert.equal(audit.league.mode,"DYNASTY");
assert.equal(audit.coverage.completedWeeks,2);
assert.equal(audit.me.allPlay.expectedWins,1);
assert.equal(audit.me.allPlay.allPlayPct,50);
assert.equal(audit.me.allPlay.luckWins,0);
assert.equal(audit.me.pfRank,3);
assert.equal(audit.me.potentialRank,2);
assert.equal(audit.me.potentialGap,45);
assert.equal(audit.teams.find(t=>t.name==="Good Partner").tradeCount,1);
assert.equal(audit.tradeInventory.teams.find(t=>t.name==="Good Partner").tradeHistory.positionsAcquired.RB,1);
assert.ok(audit.tradeSimulations[0].twoSidedFit.why.some(x=>/historical acquisition evidence/.test(x)));
assert.ok(audit.tradePartners.some(p=>
  p.name==="Good Partner"&&p.offerPositions.includes("TE")&&p.targetPositions.includes("RB")));
const partner=audit.tradePartners.find(p=>p.name==="Good Partner");
assert.equal(partner.targetExamples[0].name,"Partner RB 1");
assert.equal(partner.targetExamples[0].recentAvg,29);
assert.match(partner.caveat,/No fair offer/);
assert.equal(audit.tradeSimulations.length,1);
assert.ok(audit.tradeSimulations[0].twoSidedFit);
assert.ok(audit.tradeSimulations[0].twoSidedFit.status);
assert.match(audit.tradeSimulations[0].twoSidedFit.why.join(" "),/wants and negotiating priorities are unknown/);
assert.equal(audit.tradeSimulations[0].get.name,"Partner RB 1");
assert.equal(audit.tradeSimulations[0].send[0].name,"My TE 3");
assert.match(audit.tradeSimulations[0].caveat,/not guaranteed/);
assert.equal(audit.freeAgents.candidates.length,1);
assert.equal(audit.freeAgents.candidates[0].name,"Free RB");
assert.ok(audit.me.picks.some(p=>p.season===2027&&p.round===1&&p.originalTeam==="C team"&&p.traded===true));
assert.equal(audit.me.picks.length,10); // own 2027-29 picks, plus acquired first
assert.ok(audit.limitations.some(x=>/not a prediction/.test(x)));
const incomplete=buildGmAudit({...args,weeks:[weeks[0],{week:2,rows:weeks[1].rows.slice(0,3)}]});
assert.equal(incomplete.coverage.completedWeeks,1);
assert.equal(incomplete.me.allPlay.comparableToRecord,false);
assert.equal(incomplete.me.allPlay.luckWins,null);
const redraft=buildGmAudit({...args,league:{...league,settings:{type:0,pick_trading:0,draft_rounds:0}},scan:{...scan,at:now-7*3600000}});
assert.equal(redraft.league.mode,"REDRAFT");
assert.equal(redraft.me.picks.length,0);
assert.equal(redraft.freeAgents.verified,false);
assert.equal(redraft.tradeSimulations.length,0);
const out=buildGmAudit({...args,playersDB:{...db,"My RB 2":{...db["My RB 2"],inj:"Out"}}});
assert.equal(out.me.depth.active.RB,1);
assert.ok(out.me.needs.some(x=>x.pos==="RB"&&x.level==="urgent"));
assert.equal(scoreAllPlay(weeks,1).weekly.length,2);
console.log("GM audit checks passed: all-play, incomplete coverage, trades, picks, free agents, injuries and league modes.");