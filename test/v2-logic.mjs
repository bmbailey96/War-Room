import assert from "node:assert/strict";
import {
  eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize, confidence,
  projectionRange, probabilityBetter, normalCdf, playerConfidenceScore, hardUnavailable,
  matchupExposureFor, lateSwapFlexMoves, buildLateSwapContingencies, classifyLineupCall
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


const { ownerHistory } = await import("../netlify/functions/lib/ocho.mjs");
const knownOwner=ownerHistory("863467130702671872");
assert.ok((knownOwner.trades_count||0)>0);
assert.deepEqual(ownerHistory("missing-owner"),{});

console.log("Manager trade-history access checks passed");


const rosterRefreshModule = await import("../netlify/functions/roster-refresh.mjs");
assert.equal(typeof rosterRefreshModule.default,"function");
assert.ok(rosterRefreshModule.config?.schedule);

console.log("Scheduled core-only roster refresh import check passed");


const stashFallback = deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:true,faabRemainingPct:100,
  waivers:[{
    add:"Breakout Backup",drop:"Dead Bench",weeklyDelta:0,depthDelta:2.4,
    breakoutScore:4.2,stash:true,trending:250,addRoleRatio:1.18,addSource:"blended_form"
  }],
  trades:[]
});
assert.ok(stashFallback.actions[0].headline.startsWith("Stash "));
assert.equal(stashFallback.actions[0].stash,true);
assert.ok(stashFallback.actions[0].faabPct<=12);

console.log("Bench stash fallback checks passed");


const {
  buildDepthSecondaries,buildDefenderCoverage,inferWrCoverage,receiverRanks,buildTeamPassRush
} = await import("../netlify/functions/lib/matchup-v2.mjs");

const depthCsv = [
  "dt,team,player_name,pos_grp,pos_name,pos_abb,pos_slot,pos_rank",
  "2026-09-18T12:00:00Z,NYJ,Shutdown Corner,DB,Cornerback,CB,1,1",
  "2026-09-18T12:00:00Z,NYJ,Other Corner,DB,Cornerback,CB,2,2",
  "2026-09-18T12:00:00Z,NYJ,Nickel Guy,DB,Nickel Corner,NB,3,1",
].join("\n");
const currentDefCsv = [
  "season,week,game_type,pfr_player_name,targets,completions,yards,touchdowns,passer_rating",
  "2026,1,REG,Shutdown Corner,8,3,28,0,42",
  "2026,1,REG,Other Corner,8,7,95,1,135",
  "2026,1,REG,Nickel Guy,8,5,55,0,78",
].join("\n");
const priorDefCsv = [
  "season,week,game_type,pfr_player_name,targets,completions,yards,touchdowns,passer_rating",
  "2025,17,REG,Shutdown Corner,10,5,50,0,55",
  "2025,17,REG,Other Corner,10,8,120,1,125",
  "2025,17,REG,Nickel Guy,10,7,75,1,105",
].join("\n");

const secs=buildDepthSecondaries(depthCsv,2);
const cov=buildDefenderCoverage(currentDefCsv,priorDefCsv,2);
const wr1Match=inferWrCoverage({opponent:"NYJ",receiverRank:1,secondaries:secs,coverage:cov});
assert.equal(wr1Match.defender,"Shutdown Corner");
assert.ok(wr1Match.edgePct<0);
assert.ok(wr1Match.assignmentConfidence<60);

const slotMatch=inferWrCoverage({opponent:"NYJ",receiverRank:3,secondaries:secs,coverage:cov});
assert.equal(slotMatch.defender,"Nickel Guy");
assert.equal(slotMatch.assignment,"likely slot matchup");

const nextCorner=inferWrCoverage({
  opponent:"NYJ",receiverRank:1,secondaries:secs,coverage:cov,
  unavailableNames:new Set(["shutdown corner"])
});
assert.equal(nextCorner.defender,"Other Corner");
assert.ok(nextCorner.edgePct>0);
assert.equal(nextCorner.unavailableStartingCorners,1);

const ranks=receiverRanks([
  {player_display_name:"Alpha WR",position:"WR",team:"GB",week:"1",target_share:"0.31",wopr:"0.55",targets:"10"},
  {player_display_name:"Beta WR",position:"WR",team:"GB",week:"1",target_share:"0.19",wopr:"0.33",targets:"6"},
],[],2);
assert.equal(ranks["GB|alpha wr"],1);
assert.equal(ranks["GB|beta wr"],2);

console.log("WR-CB micro-matchup checks passed");


const pressureCurrent = [
  "season,week,game_type,team,pfr_player_name,pressures",
  "2026,1,REG,NE,Rusher One,10",
  "2026,1,REG,NE,Rusher Two,8",
  "2026,2,REG,NE,Rusher One,9",
  "2026,2,REG,NE,Rusher Two,7",
  "2026,1,REG,NYJ,Rusher A,3",
  "2026,1,REG,NYJ,Rusher B,2",
  "2026,2,REG,NYJ,Rusher A,4",
  "2026,2,REG,NYJ,Rusher B,2",
].join("\n");
const pressurePrior = [
  "season,week,game_type,team,pfr_player_name,pressures",
  "2025,17,REG,NE,Rusher One,8",
  "2025,17,REG,NYJ,Rusher A,4",
].join("\n");
const rush=buildTeamPassRush(pressureCurrent,pressurePrior,3);
assert.ok(rush.NE.edgePct<0);
assert.ok(rush.NYJ.edgePct>0);
assert.ok(Math.abs(rush.NE.edgePct)<=1.5);

console.log("QB pass-rush micro-edge checks passed");


assert.equal(matchupExposureFor("WR",.22),1);
assert.ok(matchupExposureFor("WR",.33)>1);
assert.equal(matchupExposureFor("WR",.05),.45);
assert.equal(matchupExposureFor("RB",.45),1);
assert.ok(matchupExposureFor("RB",.60)>1);
assert.ok(matchupExposureFor("TE",.10)<1);

console.log("Opportunity-scaled matchup exposure checks passed");


const qLate={
  pid:"Q1",name:"Questionable Alpha",slot:"WR",eligibleSlots:["WR"],
  projection:16,injury:"Questionable",kickoffAt:"2026-09-20T20:20:00.000Z",locked:false,out:false
};
const latePivot={
  pid:"B1",name:"Late Pivot",slot:"WR",eligibleSlots:["WR"],
  projection:11,injury:null,kickoffAt:"2026-09-20T20:25:00.000Z",locked:false,out:false
};
const earlyPivot={
  pid:"B2",name:"Early Pivot",slot:"WR",eligibleSlots:["WR"],
  projection:12,injury:null,kickoffAt:"2026-09-20T17:00:00.000Z",locked:false,out:false
};

let cont=buildLateSwapContingencies(
  [{slot:"WR",player:qLate}],
  [qLate,latePivot],
  ["WR"]
);
assert.equal(cont[0].fallback,"Late Pivot");
assert.equal(cont[0].waitSafe,true);
assert.equal(cont[0].urgency,"SAFE_TO_WAIT");

cont=buildLateSwapContingencies(
  [{slot:"WR",player:qLate}],
  [qLate,earlyPivot],
  ["WR"]
);
assert.equal(cont[0].fallback,"Early Pivot");
assert.equal(cont[0].waitSafe,false);
assert.equal(cont[0].urgency,"DECISION_DEADLINE");
assert.equal(cont[0].deadlineAt,earlyPivot.kickoffAt);

const flexEarly={
  pid:"F1",name:"Early WR",slot:"WR",eligibleSlots:["WR"],
  projection:13,kickoffAt:"2026-09-20T17:00:00.000Z",locked:false,out:false
};
const wrLate={
  pid:"F2",name:"Late WR",slot:"WR",eligibleSlots:["WR"],
  projection:14,kickoffAt:"2026-09-20T23:20:00.000Z",locked:false,out:false
};
const flexMoves=lateSwapFlexMoves([
  {slot:"WR",player:wrLate},
  {slot:"FLEX",player:flexEarly},
]);
assert.equal(flexMoves.length,1);
assert.equal(flexMoves[0].moveToFlex,"Late WR");
assert.equal(flexMoves[0].moveToPosition,"Early WR");
assert.ok(flexMoves[0].gainMinutes>300);

const noLockedFlex=lateSwapFlexMoves([
  {slot:"WR",player:{...wrLate,locked:true}},
  {slot:"FLEX",player:flexEarly},
]);
assert.equal(noLockedFlex.length,0);

console.log("Late-swap and flex-preservation checks passed");


const tinyLean=classifyLineupCall({
  start:{name:"A"},sit:{name:"B"},edge:.3,beatProbability:52,directLegal:true
});
assert.equal(tinyLean.actionable,false);
assert.equal(tinyLean.strength,"LEAN");

const realMove=classifyLineupCall({
  start:{name:"A"},sit:{name:"B"},edge:1.1,beatProbability:57,directLegal:true
});
assert.equal(realMove.actionable,true);
assert.equal(realMove.strength,"MOVE");

const strongMove=classifyLineupCall({
  start:{name:"A"},sit:{name:"B"},edge:2.1,beatProbability:65,directLegal:true
});
assert.equal(strongMove.strength,"STRONG");

const forcedMove=classifyLineupCall({
  start:{name:"Healthy"},sit:{name:"Unavailable",out:true},edge:.1,beatProbability:51,directLegal:true
});
assert.equal(forcedMove.actionable,true);
assert.equal(forcedMove.strength,"FORCED");

console.log("Actionable-vs-lean lineup threshold checks passed");


const { fitMicroScale } = await import("../netlify/functions/learn.mjs");

const badCoverageSamples=Array.from({length:12},(_,i)=>({
  week:i+1,slot:"WR",base:10,actual:10,
  signals:{
    roleRatio:1,matchupRatio:1,environmentRatio:1,schemeRatio:1,
    coverageMatchup:{rawMultiplier:1.05}
  }
}));
const badCoverageFit=fitMicroScale(badCoverageSamples,"coverage",{
  role:.28,matchup:.25,environment:.35,scheme:.22,coverage:1,passRush:1
});
assert.ok(badCoverageFit.scale<1);
assert.ok(badCoverageFit.scale>.5);
assert.equal(badCoverageFit.n,12);

const tooFewMicro=fitMicroScale(badCoverageSamples.slice(0,4),"coverage",{
  role:.28,matchup:.25,environment:.35,scheme:.22,coverage:1,passRush:1
});
assert.equal(tooFewMicro.scale,1);
assert.equal(tooFewMicro.alpha,0);

console.log("Micro-matchup self-calibration checks passed");
