import assert from "node:assert/strict";
import {
  eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize, confidence,
  projectionRange, probabilityBetter, normalCdf, playerConfidenceScore, hardUnavailable
} from "../netlify/functions/lineup.mjs";

const flexPlayer={slot:"WR",eligibleSlots:["WR"]};
assert.equal(eligibility("FLEX",flexPlayer),true);
assert.equal(eligibility("RB",flexPlayer),false);

const idp={slot:"DL",eligibleSlots:["DL","LB"]};
assert.equal(eligibility("DL",idp),true);
assert.equal(eligibility("LB",idp),true);

const superFlex={slot:"QB",eligibleSlots:["QB"]};
assert.equal(eligibility("SUPER_FLEX",superFlex),true);

const kickoff=easternKickoffMs("2026-09-17","20:15");
assert.equal(new Date(kickoff).toISOString(),"2026-09-18T00:15:00.000Z");

assert.equal(playerValue({locked:true,actual:23.4,projection:11.2}),23.4);
assert.equal(playerValue({locked:false,actual:null,projection:11.2}),11.2);

assert.equal(
  scoreSleeperProjection({pass_td:2,pass_yd:250,pass_int:1},{pass_td:6,pass_yd:0.04,pass_int:-2}),
  20
);
assert.equal(
  scoreSleeperProjection({rec:8,rec_yd:100,rec_td:1},{rec:0.5,rec_yd:0.1,rec_td:6}),
  20
);
assert.equal(
  scoreSleeperProjection(
    {rec:8,rec_yd:100,rec_td:1},
    {rec:0.5,rec_yd:0.1,rec_td:6,bonus_rec_te:0.5,bonus_rec_yd_100:2},
    "TE"
  ),
  26
);

console.log("War Room V2 logic checks passed");


const idpPool=[
  {pid:"A",slot:"DL",eligibleSlots:["DL","LB"],projection:15,out:false,locked:false},
  {pid:"B",slot:"DL",eligibleSlots:["DL"],projection:14,out:false,locked:false},
  {pid:"C",slot:"LB",eligibleSlots:["LB"],projection:5,out:false,locked:false},
];
const solved=optimize(idpPool,["DL","LB"],[]);
assert.equal(solved.total,29);
assert.deepEqual(solved.picked.map(x=>x.player?.pid),["B","A"]);

console.log("Exact assignment optimizer check passed");


assert.equal(confidence(5, null, false), "HIGH");
assert.equal(confidence(3, "Questionable", false), "MEDIUM");
assert.equal(confidence(8, null, true), "LOW");

console.log("Injury confidence regression check passed");


const stableRange=projectionRange(20,[18,19,20,21,22,20,19,21],"WR");
const volatileRange=projectionRange(20,[2,8,12,25,31,6,28,18],"WR");
assert.ok(stableRange.floor <= 20 && stableRange.ceiling >= 20);
assert.ok(volatileRange.sigma > stableRange.sigma);
assert.equal(stableRange.rangeSource,"empirical");

assert.ok(Math.abs(normalCdf(0)-0.5)<0.001);
const better=probabilityBetter(
  {projection:16,sigma:4},
  {projection:12,sigma:4}
);
assert.ok(better>0.65 && better<0.85);

const strongConfidence=playerConfidenceScore({
  sample:6,priorSample:6,source:"custom",projection:15,sleeper:15.5,volatility:.25
});
const fallbackConfidence=playerConfidenceScore({
  sample:0,priorSample:0,source:"sleeper",projection:15,sleeper:15,volatility:.55
});
assert.ok(strongConfidence>fallbackConfidence);

console.log("Decision uncertainty checks passed");

const skewedRange=projectionRange(10,[0,20,20,20,20],"WR");
assert.ok(skewedRange.floor<=10 && skewedRange.ceiling>=10);


assert.equal(hardUnavailable("", "Doubtful"), true);
assert.equal(hardUnavailable("Out", ""), true);
assert.equal(hardUnavailable("Questionable", "Limited Participation"), false);
assert.equal(hardUnavailable("", "Full Participation"), false);

console.log("Hard availability checks passed");


import {
  detectLeagueMode,buildPickLedger,pickLabel,validateActions
} from "../netlify/functions/lib/roster-v2.mjs";

assert.equal(detectLeagueMode({settings:{type:2,draft_rounds:3,pick_trading:1}}),"DYNASTY");
assert.equal(detectLeagueMode({settings:{type:0,draft_rounds:0,pick_trading:0}}),"REDRAFT");

const mockRosters=[
  {roster_id:1,owner_id:"me",settings:{wins:2,losses:0,fpts:250},players:["p1"]},
  {roster_id:2,owner_id:"them",settings:{wins:0,losses:2,fpts:180},players:["p2"]},
];
const ledger=buildPickLedger({
  league:{season:"2026",status:"in_season",settings:{type:2,draft_rounds:2,pick_trading:1}},
  rosters:mockRosters,
  users:[
    {user_id:"me",display_name:"Mine",metadata:{team_name:"Mine"}},
    {user_id:"them",display_name:"Theirs",metadata:{team_name:"Theirs"}},
  ],
  tradedPicks:[{season:"2027",round:1,roster_id:2,owner_id:1}],
});
assert.ok(ledger[1].some(p=>p.season===2027&&p.round===1&&p.originRosterId===2));
assert.ok(!ledger[2].some(p=>p.season===2027&&p.round===1&&p.originRosterId===2));

const validActions=validateActions([
  {type:"ADD_DROP",add:{name:"Free Guy"},drop:{name:"My Bench"}},
  {type:"ADD",add:{name:"Rostered Guy"}},
  {type:"TRADE_FOR",partner:"Rival",send:[{type:"player",name:"My Bench"}],receive:[{type:"player",name:"Target"}]},
  {type:"TRADE_FOR",partner:"Rival",send:[{type:"pick",name:"2027 1st (Mine)"}],receive:[{type:"pick",name:"2027 2nd (Rival)"}]},
  {type:"TRADE_FOR",partner:"Rival",send:[{type:"pick",name:"FAKE PICK"}],receive:[{type:"player",name:"Target"}]},
],{
  myNames:new Set(["my bench"]),
  freeNames:new Set(["free guy"]),
  teamPlayers:{Rival:new Set(["target"])},
  teamPicks:{Rival:new Set(["2027 2nd (Rival)"])},
  myPicks:new Set(["2027 1st (Mine)"]),
  dynasty:true,
});
assert.equal(validActions.length,3);
assert.ok(validActions.some(a=>a.type==="ADD_DROP"));
assert.equal(validActions.filter(a=>a.type==="TRADE_FOR").length,2);

const redraftActions=validateActions([
  {type:"TRADE_FOR",partner:"Rival",send:[{type:"pick",name:"2027 1st"}],receive:[{type:"player",name:"Target"}]},
],{
  myNames:new Set(),freeNames:new Set(),
  teamPlayers:{Rival:new Set(["target"])},teamPicks:{Rival:new Set()},
  myPicks:new Set(),dynasty:false,
});
assert.equal(redraftActions.length,0);

console.log("Roster action validation checks passed");


const rosterActionsModule = await import("../netlify/functions/roster-actions.mjs");
assert.equal(typeof rosterActionsModule.default,"function");

console.log("Roster actions endpoint import check passed");


const rosterBackgroundModule = await import("../netlify/functions/roster-actions-background.mjs");
assert.equal(typeof rosterBackgroundModule.default,"function");

const { pickTierFactor } = await import("../netlify/functions/lib/market-v2.mjs");
assert.ok(pickTierFactor("early")>pickTierFactor("mid"));
assert.ok(pickTierFactor("late")<pickTierFactor("mid"));

console.log("Roster background and dynasty market checks passed");


const { deterministicAnalysis } = await import("../netlify/functions/lineup-analysis.mjs");
const offlineLineup = deterministicAnalysis({
  calls:[{
    slot:"FLEX",edge:2.4,beatProbability:64,decisionConfidence:"MEDIUM",
    start:{name:"Healthy Starter",confidence:"MEDIUM",injury:null},
    sit:{name:"Bench Option"}
  }],
  players:[
    {name:"Questionable Player",injury:"Questionable",practiceStatus:"Limited Participation"},
    {name:"Healthy Starter",injury:null}
  ]
});
assert.equal(offlineLineup.calls[0].start,"Healthy Starter");
assert.equal(offlineLineup.calls[0].drivers[0],"projection_only");
assert.ok(offlineLineup.watch[0].includes("Questionable Player"));

const { deterministicRosterFallback } = await import("../netlify/functions/roster-actions-background.mjs");
const priorityFallback = deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:false,
  waivers:[{add:"Free Agent",drop:"Bench Guy",weeklyDelta:1.8,marketDelta:null,trending:250}],
  trades:[]
});
assert.equal(priorityFallback.actions[0].type,"ADD_DROP");
assert.equal(priorityFallback.actions[0].faabPct,null);

const faabFallback = deterministicRosterFallback({
  mode:"DYNASTY",usesFaab:true,faabRemainingPct:7,
  waivers:[{add:"Young Flyer",drop:"Old Bench",weeklyDelta:.4,marketDelta:12,trending:100}],
  trades:[]
});
assert.ok(faabFallback.actions[0].faabPct<=7);

console.log("Anthropic-offline fallback checks passed");


const { blendedRosterForecast } = await import("../netlify/functions/roster-actions-background.mjs");

const oneGameSpike = blendedRosterForecast(10,{
  currentGames:1,recentPts:24,baselinePts:9,roleRatio:1.1
});
assert.ok(oneGameSpike.forecast>10);
assert.ok(oneGameSpike.forecast<16);
assert.equal(oneGameSpike.source,"blended_form");

const establishedBreakout = blendedRosterForecast(10,{
  currentGames:4,recentPts:16,baselinePts:10,roleRatio:1.2
});
assert.ok(establishedBreakout.forecast>oneGameSpike.forecast);

const noForm = blendedRosterForecast(11,null);
assert.equal(noForm.forecast,11);
assert.equal(noForm.source,"provider");

console.log("Roster blended-form forecast checks passed");
