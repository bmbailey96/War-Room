import assert from "node:assert/strict";
import {
  eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize, confidence,
  projectionRange, probabilityBetter, normalCdf, playerConfidenceScore, lineupCallDrivers, hardUnavailable,
  matchupExposureFor, lateSwapFlexMoves, buildLateSwapContingencies, classifyLineupCall,
  buildStrategicTiebreaks
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

const { deterministicRosterFallback,waiverMoveActionable } = await import("../netlify/functions/roster-actions-background.mjs");
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
  buildDepthSecondaries,buildSleeperSecondaries,buildDefenderCoverage,inferWrCoverage,receiverRanks,buildTeamPassRush,
  buildSleeperLineUnits,buildSleeperMiddleUnits,inferTeCoverageUnit,
  buildRbDefenseSplits,rbUsageSplit,combineRbMicroEdge,protectionEdge,
  buildSleeperFrontSeven,frontSevenAttritionEdge,runBlockingEdge
} = await import("../netlify/functions/lib/matchup-v2.mjs");

const depthCsv = [
  "dt,team,player_name,pos_grp,pos_name,pos_abb,pos_slot,pos_rank",
  "2026-09-18T12:00:00Z,NYJ,Shutdown Corner,DB,Cornerback,CB,1,1",
  "2026-09-18T12:00:00Z,NYJ,Other Corner,DB,Cornerback,CB,2,2",
  "2026-09-18T12:00:00Z,NYJ,Nickel Guy,DB,Nickel Corner,NB,3,1",
].join("\n");
const currentDefCsv = [
  "season,week,game_type,player_name,team,def_targets,def_completions_allowed,def_yards_allowed,def_receiving_td_allowed,def_passer_rating_allowed,def_pressures",
  "2026,1,REG,Shutdown Corner,NYJ,8,3,28,0,42,0",
  "2026,1,REG,Other Corner,NYJ,8,7,95,1,135,0",
  "2026,1,REG,Nickel Guy,NYJ,8,5,55,0,78,0",
].join("\n");
const priorDefCsv = [
  "season,week,game_type,player_name,team,def_targets,def_completions_allowed,def_yards_allowed,def_receiving_td_allowed,def_passer_rating_allowed,def_pressures",
  "2025,17,REG,Shutdown Corner,NYJ,10,5,50,0,55,0",
  "2025,17,REG,Other Corner,NYJ,10,8,120,1,125,0",
  "2025,17,REG,Nickel Guy,NYJ,10,7,75,1,105,0",
].join("\n");

const secs=buildDepthSecondaries(depthCsv,2);
const sleeperSecs=buildSleeperSecondaries({
  "cb1":{n:"Shutdown Corner",p:"CB",fp:["DB"],t:"NYJ",dp:"RCB",do:1},
  "cb2":{n:"Other Corner",p:"CB",fp:["DB"],t:"NYJ",dp:"LCB",do:1},
  "nb1":{n:"Nickel Guy",p:"CB",fp:["DB"],t:"NYJ",dp:"SLOT",do:1},
});
assert.equal(sleeperSecs.NYJ.length,3);
assert.equal(sleeperSecs.NYJ.find(x=>x.name==="Nickel Guy").role,"slot");
assert.equal(sleeperSecs.NYJ.find(x=>x.name==="Shutdown Corner").side,"right");

const cov=buildDefenderCoverage(currentDefCsv,priorDefCsv,2);
const wr1Match=inferWrCoverage({
  opponent:"NYJ",receiverRank:1,receiverRole:"outside",receiverSide:"left",
  secondaries:sleeperSecs,coverage:cov
});
assert.equal(wr1Match.defender,"Shutdown Corner");
assert.ok(wr1Match.edgePct<0);
assert.ok(wr1Match.assignmentConfidence>=60);
assert.ok(wr1Match.defenderYpt<6);

const slotMatch=inferWrCoverage({
  opponent:"NYJ",receiverRank:3,receiverRole:"slot",
  secondaries:sleeperSecs,coverage:cov
});
assert.equal(slotMatch.defender,"Nickel Guy");
assert.equal(slotMatch.assignment,"likely slot matchup");
assert.ok(slotMatch.assignmentConfidence>=70);

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
  "season,week,game_type,team,player_name,def_pressures",
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
  "season,week,game_type,team,player_name,def_pressures",
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


const lineUnits=buildSleeperLineUnits({
  ot1:{n:"Left Tackle",p:"OL",t:"BUF",dp:"LT",do:1},
  og1:{n:"Left Guard",p:"OL",t:"BUF",dp:"LG",do:1},
  c1:{n:"Center",p:"OL",t:"BUF",dp:"C",do:1},
  rg1:{n:"Right Guard",p:"OL",t:"BUF",dp:"RG",do:1},
  rt1:{n:"Right Tackle",p:"OL",t:"BUF",dp:"RT",do:1},
  ot2:{n:"Backup Tackle",p:"OL",t:"BUF",dp:"LT",do:2},
});
assert.equal(lineUnits.BUF.filter(x=>x.rank===1).length,5);
const protection=protectionEdge({
  offense:"BUF",lineUnits,
  unavailableNames:new Set(["left tackle"]),
  passRush:{ratio:1.22}
});
assert.equal(protection.missingStarters,1);
assert.ok(protection.edgePct<0);
assert.equal(protection.confidence,"MEDIUM");

const middleUnits=buildSleeperMiddleUnits({
  lb1:{n:"Cover Linebacker",p:"LB",fp:["LB"],t:"NYJ",dp:"MLB",do:1},
  s1:{n:"Range Safety",p:"DB",fp:["DB"],t:"NYJ",dp:"FS",do:1},
  s2:{n:"Strong Safety",p:"DB",fp:["DB"],t:"NYJ",dp:"SS",do:1},
  cb1:{n:"Outside Corner",p:"CB",fp:["DB"],t:"NYJ",dp:"RCB",do:1},
});
assert.equal(middleUnits.NYJ.length,3);
const teUnit=inferTeCoverageUnit({
  opponent:"NYJ",middleUnits,
  coverage:{
    "cover linebacker":{score:-.85,reliability:.75},
    "range safety":{score:-.4,reliability:.65},
    "strong safety":{score:.15,reliability:.55},
  },
  unavailableNames:new Set()
});
assert.ok(teUnit.edgePct>0);
assert.equal(teUnit.assignment,"middle coverage unit");
assert.ok(teUnit.defenders.includes("Cover Linebacker"));

const rbCurrent=[
  {position:"RB",opponent_team:"NE",week:"1",carries:"20",rushing_yards:"110",targets:"7",receptions:"6",receiving_yards:"50"},
  {position:"RB",opponent_team:"NE",week:"2",carries:"18",rushing_yards:"99",targets:"8",receptions:"6",receiving_yards:"55"},
  {position:"RB",opponent_team:"NYJ",week:"1",carries:"20",rushing_yards:"62",targets:"3",receptions:"2",receiving_yards:"12"},
  {position:"RB",opponent_team:"NYJ",week:"2",carries:"18",rushing_yards:"58",targets:"4",receptions:"3",receiving_yards:"18"},
];
const rbPrior=[
  {position:"RB",opponent_team:"NE",week:"17",carries:"22",rushing_yards:"112",targets:"6",receptions:"5",receiving_yards:"40"},
  {position:"RB",opponent_team:"NYJ",week:"17",carries:"22",rushing_yards:"70",targets:"4",receptions:"3",receiving_yards:"20"},
];
const rbSplits=buildRbDefenseSplits(rbCurrent,rbPrior,3);
assert.ok(rbSplits.NE.groundEdgePct>0);
assert.ok(rbSplits.NYJ.groundEdgePct<0);
const receivingBack=rbUsageSplit([
  {carries:"8",targets:"7"},{carries:"9",targets:"8"},{carries:"7",targets:"8"}
]);
assert.ok(receivingBack.receivingShare>.5);
const rbMicro=combineRbMicroEdge(rbSplits.NE,receivingBack,1.1);
assert.ok(Number.isFinite(rbMicro.edgePct));
assert.ok(Math.abs(rbMicro.edgePct)<=2);

console.log("Position-specific TE/RB/protection matchup checks passed");


const frontUnits=buildSleeperFrontSeven({
  dl1:{n:"Nose Tackle",p:"DL",fp:["DL"],t:"NYJ",dp:"NT",do:1},
  dl2:{n:"End One",p:"DL",fp:["DL"],t:"NYJ",dp:"DE",do:1},
  dl3:{n:"End Two",p:"DL",fp:["DL"],t:"NYJ",dp:"DE",do:1},
  lb1:{n:"Mike Backer",p:"LB",fp:["LB"],t:"NYJ",dp:"MLB",do:1},
  lb2:{n:"Will Backer",p:"LB",fp:["LB"],t:"NYJ",dp:"WLB",do:1},
  lb3:{n:"Sam Backer",p:"LB",fp:["LB"],t:"NYJ",dp:"SLB",do:1},
});
assert.equal(frontUnits.NYJ.filter(x=>x.rank===1).length,6);
const depletedFront=frontSevenAttritionEdge({
  opponent:"NYJ",frontUnits,
  unavailableNames:new Set(["nose tackle","mike backer"])
});
assert.equal(depletedFront.missingStarters,2);
assert.ok(depletedFront.edgePct>0);
assert.equal(depletedFront.confidence,"MEDIUM");

const runBlockDrag=runBlockingEdge({
  offense:"BUF",lineUnits,
  unavailableNames:new Set(["left tackle","right guard"])
});
assert.equal(runBlockDrag.missingStarters,2);
assert.ok(runBlockDrag.edgePct<0);
assert.equal(runBlockDrag.confidence,"MEDIUM");

console.log("Current front-seven and run-blocking personnel checks passed");


const {
  microEdge,microReliability,microWeightFromStat,fitMicroWeights
} = await import("../netlify/functions/learn.mjs");

const structuralWeights={role:.28,matchup:.25,environment:.35,scheme:.22};

const goodCoverageSamples=Array.from({length:12},(_,i)=>{
  const positive=i<9;
  return {
    base:10,
    actual:positive?12:8,
    signals:{
      coverageMatchup:{
        edgePct:positive?2:-2,
        applied:true
      }
    }
  };
});
const goodCoverage=microReliability(goodCoverageSamples,"coverage",structuralWeights);
assert.equal(goodCoverage.n,12);
assert.ok(goodCoverage.hitRate>.9);
assert.ok(microWeightFromStat(goodCoverage)>1);

const badCoverageSamples=goodCoverageSamples.map(s=>({
  ...s,
  signals:{
    coverageMatchup:{
      edgePct:-s.signals.coverageMatchup.edgePct,
      applied:true
    }
  }
}));
const badCoverage=microReliability(badCoverageSamples,"coverage",structuralWeights);
assert.ok(badCoverage.hitRate<.1);
assert.ok(microWeightFromStat(badCoverage)<1);

assert.equal(
  microWeightFromStat({n:4,hit:4,hitRate:1}),
  1
);

const personnelSample={
  signals:{
    frontSeven:{edgePct:1.2,applied:true},
    runBlocking:{edgePct:-.6,applied:true},
    protection:{edgePct:-.4,applied:true}
  }
};
assert.ok(Math.abs(microEdge(personnelSample,"personnel")-.002)<.0001);

const fittedMicro=fitMicroWeights(goodCoverageSamples,structuralWeights);
assert.ok(fittedMicro.weights.coverage>1);
assert.equal(fittedMicro.weights.teCoverage,1);
assert.equal(fittedMicro.weights.rbSplit,1);
assert.equal(fittedMicro.weights.passRush,1);
assert.equal(fittedMicro.weights.personnel,1);

console.log("Micro-edge self-calibration checks passed");


const meanStarter={
  pid:"R1",name:"Mean Starter",slot:"WR",eligibleSlots:["WR"],
  projection:15,floor:8.5,ceiling:19,sigma:4.5,out:false,locked:false
};
const floorBench={
  pid:"R2",name:"Safe Bench",slot:"WR",eligibleSlots:["WR"],
  projection:14.6,floor:10.2,ceiling:18,sigma:3.2,out:false,locked:false
};
const ceilingBench={
  pid:"R3",name:"Boom Bench",slot:"WR",eligibleSlots:["WR"],
  projection:14.5,floor:6.5,ceiling:22,sigma:5.2,out:false,locked:false
};
const farLowerBench={
  pid:"R4",name:"Too Low Mean",slot:"WR",eligibleSlots:["WR"],
  projection:13.8,floor:12,ceiling:24,sigma:4,out:false,locked:false
};

let strategic=buildStrategicTiebreaks(
  [{slot:"WR",player:meanStarter}],
  [meanStarter,floorBench,ceilingBench,farLowerBench],
  "protect_floor"
);
assert.equal(strategic.length,1);
assert.equal(strategic[0].start.name,"Safe Bench");
assert.equal(strategic[0].callStrength,"FLOOR LEAN");
assert.equal(strategic[0].actionable,false);
assert.ok(strategic[0].riskEdge>=1);

strategic=buildStrategicTiebreaks(
  [{slot:"WR",player:meanStarter}],
  [meanStarter,floorBench,ceilingBench,farLowerBench],
  "chase_ceiling"
);
assert.equal(strategic.length,1);
assert.equal(strategic[0].start.name,"Boom Bench");
assert.equal(strategic[0].callStrength,"CEILING LEAN");
assert.equal(strategic[0].actionable,false);
assert.ok(strategic[0].riskEdge>=1.5);

assert.equal(
  buildStrategicTiebreaks(
    [{slot:"WR",player:meanStarter}],
    [meanStarter,floorBench],
    "neutral"
  ).length,
  0
);
assert.ok(
  !buildStrategicTiebreaks(
    [{slot:"WR",player:meanStarter}],
    [meanStarter,farLowerBench],
    "protect_floor"
  ).some(x=>x.start.pid==="R4")
);

console.log("Risk-aware floor/ceiling tiebreak checks passed");


const {
  specialistRosterDecision
} = await import("../netlify/functions/roster-actions-background.mjs");

const rosterWithDef=[
  {pid:"D1",name:"Current DEF",pos:"DEF",next3:6,weeks:{3:6,4:6,5:6}},
  {pid:"R1",name:"Useful RB",pos:"RB",next3:9,weeks:{3:9,4:9,5:9}},
];
const addDef={pid:"D2",name:"49ers DEF",pos:"DEF",next3:8,weeks:{3:8,4:8,5:8}};
const usefulRb=rosterWithDef[1];
const currentDef=rosterWithDef[0];

let fit=specialistRosterDecision({
  mode:"REDRAFT",add:addDef,drop:usefulRb,roster:rosterWithDef,
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],week:3,marginalDrop:3
});
assert.equal(fit.allowed,false);
assert.equal(fit.mode,"BLOCK_DUPLICATE_DEF");

fit=specialistRosterDecision({
  mode:"REDRAFT",add:addDef,drop:currentDef,roster:rosterWithDef,
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],week:3,marginalDrop:0
});
assert.equal(fit.allowed,true);
assert.equal(fit.mode,"STREAM_SWAP");

fit=specialistRosterDecision({
  mode:"REDRAFT",
  add:{pid:"K2",name:"New Kicker",pos:"K",next3:9,weeks:{3:9,4:9,5:9}},
  drop:usefulRb,
  roster:[...rosterWithDef,{pid:"K1",name:"Current Kicker",pos:"K",next3:8,weeks:{3:8,4:8,5:8}}],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],week:3,marginalDrop:0
});
assert.equal(fit.allowed,false);
assert.equal(fit.mode,"BLOCK_DUPLICATE_K");

fit=specialistRosterDecision({
  mode:"REDRAFT",
  add:{pid:"D2",name:"Bye Cover DEF",pos:"DEF",next3:8,weeks:{4:8,5:8}},
  drop:{pid:"W5",name:"Replacement WR",pos:"WR",next3:4,weeks:{3:4,4:4,5:4}},
  roster:[
    {pid:"D1",name:"Current DEF",pos:"DEF",next3:6,weeks:{3:6,5:6}},
    {pid:"W5",name:"Replacement WR",pos:"WR",next3:4,weeks:{3:4,4:4,5:4}}
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],week:3,marginalDrop:.2
});
assert.equal(fit.allowed,true);
assert.equal(fit.mode,"BYE_HOLD");

assert.equal(waiverMoveActionable({weeklyDelta:.2}, "REDRAFT"),false);
assert.equal(waiverMoveActionable({weeklyDelta:.8}, "REDRAFT"),true);
assert.equal(waiverMoveActionable({
  weeklyDelta:.4,specialistMode:"STREAM_SWAP",streamWeekEdge:1.2,streamNext3Edge:.4
}, "REDRAFT"),true);
assert.equal(waiverMoveActionable({weeklyDelta:.2,stash:true,depthDelta:1.8}, "REDRAFT"),false);
assert.equal(waiverMoveActionable({
  weeklyDelta:.2,stash:true,depthDelta:1.8,addRoleRatio:1.12
}, "REDRAFT"),true);

console.log("Redraft specialist roster-construction and no-churn checks passed");


const { positionalDepthDecision } = await import("../netlify/functions/roster-actions-background.mjs");

let depthFit=positionalDepthDecision({
  mode:"REDRAFT",
  add:{name:"Extra WR",pos:"WR"},
  drop:{name:"Third RB",pos:"RB"},
  roster:[
    {name:"RB1",pos:"RB"},{name:"RB2",pos:"RB"},{name:"Third RB",pos:"RB"},
    {name:"WR1",pos:"WR"},{name:"WR2",pos:"WR"},{name:"WR3",pos:"WR"},
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  weeklyDelta:1.1
});
assert.equal(depthFit.allowed,false);

depthFit=positionalDepthDecision({
  mode:"REDRAFT",
  add:{name:"Massive WR Upgrade",pos:"WR"},
  drop:{name:"Third RB",pos:"RB"},
  roster:[
    {name:"RB1",pos:"RB"},{name:"RB2",pos:"RB"},{name:"Third RB",pos:"RB"},
    {name:"WR1",pos:"WR"},{name:"WR2",pos:"WR"},{name:"WR3",pos:"WR"},
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  weeklyDelta:3.2
});
assert.equal(depthFit.allowed,true);

depthFit=positionalDepthDecision({
  mode:"REDRAFT",
  add:{name:"RB Upgrade",pos:"RB"},
  drop:{name:"Third RB",pos:"RB"},
  roster:[
    {name:"RB1",pos:"RB"},{name:"RB2",pos:"RB"},{name:"Third RB",pos:"RB"},
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  weeklyDelta:.8
});
assert.equal(depthFit.allowed,true);

const gameDayRosterRefresh = await import("../netlify/functions/roster-gameday-refresh.mjs");
assert.equal(typeof gameDayRosterRefresh.default,"function");
assert.ok(gameDayRosterRefresh.config?.schedule);

console.log("Redraft positional-depth and game-day refresh checks passed");


const {
  buildTeamGameLocks,specialistScheduleEdge
} = await import("../netlify/functions/roster-actions-background.mjs");

const gamesCsvForLocks=[
  "season,week,game_type,home_team,away_team,gameday,gametime",
  "2026,3,REG,SF,LAR,2026-09-20,13:00",
].join("\n");
let locks=buildTeamGameLocks(
  gamesCsvForLocks,2026,3,Date.parse("2026-09-21T00:00:00Z")
);
assert.equal(locks.SF.locked,true);
assert.equal(locks.LAR.locked,true);
assert.ok(locks.SF.kickoffAt);

locks=buildTeamGameLocks(
  gamesCsvForLocks,2026,3,Date.parse("2026-09-20T12:00:00Z")
);
assert.equal(locks.SF.locked,false);

const streamEdge=specialistScheduleEdge(
  {weeks:{3:10,4:5,5:7}},
  {weeks:{3:6,4:8,5:6}},
  3
);
assert.equal(streamEdge.thisWeekEdge,4);
assert.ok(streamEdge.next3Edge>0);

assert.equal(
  waiverMoveActionable({
    specialistMode:"STREAM_SWAP",
    streamWeekEdge:1.2,streamNext3Edge:-.2,weeklyDelta:.1
  },"REDRAFT"),
  true
);
assert.equal(
  waiverMoveActionable({
    specialistMode:"STREAM_SWAP",
    streamWeekEdge:.4,streamNext3Edge:.4,weeklyDelta:.4
  },"REDRAFT"),
  false
);

console.log("Game-day free-agent lock and defense-stream timing checks passed");


const liveModule = await import("../netlify/functions/live-state.mjs");
const { liveProgress, liveExpectedFinal } = liveModule;

const liveKickoff=Date.parse("2026-09-20T17:00:00Z");
assert.equal(liveProgress(new Date(liveKickoff).toISOString(),liveKickoff-1000),0);
assert.ok(Math.abs(liveProgress(new Date(liveKickoff).toISOString(),liveKickoff+2*60*60*1000)-.5)<.01);
assert.equal(liveProgress(new Date(liveKickoff).toISOString(),liveKickoff+5*60*60*1000),1);

assert.equal(liveExpectedFinal({projection:20,actual:0,progress:0,slot:"WR"}),20);
const hotHalf=liveExpectedFinal({projection:20,actual:15,progress:.5,slot:"WR"});
assert.ok(hotHalf>20 && hotHalf<26);
const hotDstHalf=liveExpectedFinal({projection:8,actual:14,progress:.5,slot:"DEF"});
assert.ok(hotDstHalf>8 && hotDstHalf<hotHalf);
assert.equal(liveExpectedFinal({projection:20,actual:11.4,progress:1,slot:"WR"}),11.4);
assert.equal(typeof liveModule.default,"function");

console.log("Sunday live pace-model checks passed");


const { computeTrendVelocity } = await import("../netlify/functions/roster-actions-background.mjs");
assert.deepEqual(computeTrendVelocity(300,200,.5),{delta:100,perHour:200});
assert.deepEqual(computeTrendVelocity(180,200,.5),{delta:0,perHour:0});
assert.deepEqual(computeTrendVelocity(120,100,null),{delta:0,perHour:0});
assert.deepEqual(computeTrendVelocity(110,100,2),{delta:10,perHour:5});

console.log("Waiver trend-velocity checks passed");


const { buildWaiverPlan } = await import("../netlify/functions/roster-actions-background.mjs");
const claimPlan=buildWaiverPlan([
  {add:"Best Add",drop:"Bench A",score:10,weeklyDelta:2},
  {add:"Best Add",drop:"Bench B",score:9,weeklyDelta:1.8},
  {add:"Second Add",drop:"Bench A",score:8,weeklyDelta:1.4},
  {add:"Third Add",drop:"Bench C",score:7,weeklyDelta:1.1},
],3);
assert.equal(claimPlan.length,3);
assert.equal(claimPlan[0].add,"Best Add");
assert.equal(claimPlan[0].claimRole,"PRIMARY");
assert.equal(claimPlan[0].claimRank,1);
assert.equal(claimPlan[1].add,"Second Add");
assert.equal(claimPlan[1].claimRole,"BACKUP");
assert.equal(claimPlan[2].add,"Third Add");

const crispFallback=deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:false,
  waivers:claimPlan,
  trades:[{
    target:"Trade Target",partner:"Other Team",confidence:"MEDIUM",
    why:"Fair consolidation",send:[{type:"player",name:"Bench A"}],
    weeklyDelta:1.5,partnerWeeklyDelta:.2
  }]
});
assert.equal(crispFallback.actions.filter(x=>x.type==="ADD_DROP").length,2);
assert.equal(crispFallback.actions.some(x=>x.type==="TRADE_FOR"),true);
assert.equal(crispFallback.actions[0].claimRole,"PRIMARY");

console.log("Ranked waiver-plan checks passed");


const {
  ROSTER_ACTIONS_CACHE_VERSION,rosterActionsCacheKey,rosterActionsLockKey,
  rosterActionsFreshnessMs,rosterFreshnessLabel
} = await import("../netlify/functions/lib/roster-cache.mjs");
assert.equal(ROSTER_ACTIONS_CACHE_VERSION,"v8");
assert.equal(rosterActionsCacheKey("123"),"roster_actions_v8_123");
assert.equal(rosterActionsLockKey("123"),"roster_actions_refresh_v8_123");
const sundayNoon=Date.parse("2026-09-20T18:00:00Z");
const wednesdayNoon=Date.parse("2026-09-23T18:00:00Z");
assert.equal(rosterActionsFreshnessMs(sundayNoon),6*60*1000);
assert.equal(rosterFreshnessLabel(sundayNoon),"SUNDAY_PULSE");
assert.equal(rosterActionsFreshnessMs(wednesdayNoon),4*60*60*1000);

let dynastySpecialist=specialistRosterDecision({
  mode:"DYNASTY",
  add:{pid:"K2",name:"Second Kicker",pos:"K",next3:9,weeks:{2:9,3:9,4:9}},
  drop:{pid:"T1",name:"Young TE",pos:"TE",next3:6},
  roster:[
    {pid:"K1",name:"Current Kicker",pos:"K",next3:8,weeks:{2:8,3:8,4:8}},
    {pid:"T1",name:"Young TE",pos:"TE",next3:6}
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  week:2,marginalDrop:2
});
assert.equal(dynastySpecialist.allowed,false);
assert.equal(dynastySpecialist.mode,"BLOCK_DUPLICATE_K");

dynastySpecialist=specialistRosterDecision({
  mode:"DYNASTY",
  add:{pid:"D2",name:"Second DEF",pos:"DEF",next3:8,weeks:{2:8,3:8,4:8}},
  drop:{pid:"T1",name:"Young TE",pos:"TE",next3:6},
  roster:[
    {pid:"D1",name:"Current DEF",pos:"DEF",next3:6,weeks:{2:6,3:6,4:6}},
    {pid:"T1",name:"Young TE",pos:"TE",next3:6}
  ],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  week:2,marginalDrop:2
});
assert.equal(dynastySpecialist.allowed,false);
assert.equal(dynastySpecialist.mode,"BLOCK_DUPLICATE_DEF");

dynastySpecialist=specialistRosterDecision({
  mode:"DYNASTY",
  add:{pid:"K2",name:"Upgrade Kicker",pos:"K",next3:9,weeks:{2:9,3:9,4:9}},
  drop:{pid:"K1",name:"Current Kicker",pos:"K",next3:8,weeks:{2:8,3:8,4:8}},
  roster:[{pid:"K1",name:"Current Kicker",pos:"K",next3:8,weeks:{2:8,3:8,4:8}}],
  activeSlots:["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"],
  week:2,marginalDrop:0
});
assert.equal(dynastySpecialist.allowed,true);
assert.equal(dynastySpecialist.mode,"STREAM_SWAP");

console.log("Versioned roster-cache and dynasty specialist checks passed");


const {
  currentOfficialInjuries,redraftTradeEfficient,dynastyTradeEfficient,roleMarketTiming
} = await import("../netlify/functions/roster-actions-background.mjs");

const officialInjuryCsv=[
  "full_name,week,report_status,practice_status,report_primary_injury",
  "Brock Bowers,2,Doubtful,Limited Participation,Knee",
  "Healthy Player,2,,Full Participation,"
].join("\n");
const injuryMap=currentOfficialInjuries(officialInjuryCsv,2);
assert.equal(injuryMap["brock bowers"].status,"Doubtful");
assert.equal(injuryMap["brock bowers"].practice,"Limited Participation");

let tradeFit=redraftTradeEfficient({
  sendHorizon:100,receiveHorizon:94,weeklyDelta:3,partnerWeeklyDelta:.5
});
assert.equal(tradeFit.allowed,true);

tradeFit=redraftTradeEfficient({
  sendHorizon:120,receiveHorizon:75,weeklyDelta:4,partnerWeeklyDelta:1
});
assert.equal(tradeFit.allowed,false);

tradeFit=redraftTradeEfficient({
  sendHorizon:70,receiveHorizon:100,weeklyDelta:4,partnerWeeklyDelta:-3
});
assert.equal(tradeFit.allowed,false);

let dynastyFit=dynastyTradeEfficient({
  sendValue:84,receiveValue:78,weeklyDelta:4.6,partnerWeeklyDelta:-1.3
});
assert.equal(dynastyFit.allowed,true);

dynastyFit=dynastyTradeEfficient({
  sendValue:111,receiveValue:89,weeklyDelta:4.2,partnerWeeklyDelta:-3
});
assert.equal(dynastyFit.allowed,false);
assert.equal(dynastyFit.reason,"too much dynasty value for the weekly gain");

console.log("Trade horizon, injury, and efficiency checks passed");

const buyLowTiming=roleMarketTiming({
  currentGames:3,recentPts:8,baselinePts:12,roleRatio:1.18,
  tdDependency:.10,mirageRisk:0
});
assert.equal(buyLowTiming.code,"BUY_LOW");
assert.ok(buyLowTiming.score>0);

const sellHighTiming=roleMarketTiming({
  currentGames:3,recentPts:18,baselinePts:10,roleRatio:.98,
  tdDependency:.58,mirageRisk:.62
});
assert.equal(sellHighTiming.code,"SELL_HIGH");
assert.ok(sellHighTiming.score>0);

const earnedBreakoutTiming=roleMarketTiming({
  currentGames:3,recentPts:16,baselinePts:10,roleRatio:1.18,
  tdDependency:.42,mirageRisk:.08
});
assert.equal(earnedBreakoutTiming.code,"NEUTRAL");

const tooEarlyTiming=roleMarketTiming({
  currentGames:1,recentPts:5,baselinePts:12,roleRatio:1.25,
  tdDependency:0,mirageRisk:0
});
assert.equal(tooEarlyTiming.code,"NEUTRAL");

console.log("Role-versus-box-score trade timing checks passed");


const {
  buildOpportunityProfiles,buildVacatedOpportunity,vacatedOpportunityEdge,
  receiverArchetype,buildWrArchetypeDefense,receiverArchetypeEdge
} = await import("../netlify/functions/lib/opportunity-v2.mjs");

assert.equal(receiverArchetype(5),"underneath");
assert.equal(receiverArchetype(10),"intermediate");
assert.equal(receiverArchetype(16),"vertical");

const opportunityRows=[
  {player_display_name:"Alpha WR",position:"WR",team:"GB",week:"1",targets:"10",target_share:"0.25",receiving_air_yards:"150"},
  {player_display_name:"Alpha WR",position:"WR",team:"GB",week:"2",targets:"9",target_share:"0.24",receiving_air_yards:"135"},
  {player_display_name:"Bravo WR",position:"WR",team:"GB",week:"1",targets:"11",target_share:"0.30",receiving_air_yards:"110"},
  {player_display_name:"Bravo WR",position:"WR",team:"GB",week:"2",targets:"10",target_share:"0.29",receiving_air_yards:"100"},
  {player_display_name:"Lead RB",position:"RB",team:"DAL",week:"1",carries:"18",targets:"4",target_share:"0.10"},
  {player_display_name:"Lead RB",position:"RB",team:"DAL",week:"2",carries:"16",targets:"3",target_share:"0.08"},
  {player_display_name:"Backup RB",position:"RB",team:"DAL",week:"1",carries:"8",targets:"3",target_share:"0.08"},
  {player_display_name:"Backup RB",position:"RB",team:"DAL",week:"2",carries:"9",targets:"3",target_share:"0.08"},
];
const profiles=buildOpportunityProfiles(opportunityRows,[],3);
assert.ok(profiles["alpha wr"].targetShare>.2);
assert.ok(profiles["alpha wr"].aDot>13);

const vacated=buildVacatedOpportunity(
  profiles,new Set(["bravo wr","lead rb"])
);
const alphaVac=vacatedOpportunityEdge(profiles["alpha wr"],vacated.GB);
assert.ok(alphaVac.edgePct>0);
assert.ok(alphaVac.names.includes("Bravo WR"));

const backupVac=vacatedOpportunityEdge(profiles["backup rb"],vacated.DAL);
assert.ok(backupVac.edgePct>0);
assert.ok(backupVac.vacatedCarryPct>0);
assert.equal(vacatedOpportunityEdge(profiles["alpha wr"],{
  activeTargetShare:.5,vacatedTargetShare:0,
  activeRbCarryShare:0,vacatedRbCarryShare:0,
  vacatedNames:[]
}),null);

const archetypeRows=[
  {player_display_name:"Vertical One",position:"WR",team:"BUF",opponent_team:"NYJ",week:"1",targets:"20",receptions:"14",receiving_yards:"360",receiving_tds:"3",receiving_air_yards:"360"},
  {player_display_name:"Vertical Two",position:"WR",team:"MIA",opponent_team:"LAR",week:"1",targets:"20",receptions:"8",receiving_yards:"120",receiving_tds:"0",receiving_air_yards:"340"},
  {player_display_name:"Short One",position:"WR",team:"BUF",opponent_team:"NYJ",week:"1",targets:"20",receptions:"14",receiving_yards:"100",receiving_tds:"0",receiving_air_yards:"100"},
  {player_display_name:"Short Two",position:"WR",team:"MIA",opponent_team:"LAR",week:"1",targets:"20",receptions:"18",receiving_yards:"180",receiving_tds:"1",receiving_air_yards:"100"},
];
const archetypeDefense=buildWrArchetypeDefense(archetypeRows,[],2);
const verticalProfile={
  pos:"WR",aDot:17,effectiveTargets:30
};
const verticalEdge=receiverArchetypeEdge(
  verticalProfile,"NYJ",archetypeDefense,1
);
assert.ok(verticalEdge.edgePct>0);
assert.equal(verticalEdge.archetype,"vertical");
assert.ok(Math.abs(verticalEdge.edgePct)<=2.4);

console.log("Vacated-opportunity and WR-archetype checks passed");


const crispDrivers=lineupCallDrivers(
  {reasons:[
    "+5% role/workload",
    "+3% team total",
    "+2% vacated opportunity",
    "-1% coverage drag vs Corner"
  ]},
  {reasons:[
    "+2% role/workload",
    "+3% team total",
    "-2% recent scheme",
    "-1% injury uncertainty"
  ]},
  3
);
assert.deepEqual(crispDrivers.map(x=>x.label),["ROLE","SCHEME","VACATED WORK"]);
assert.equal(crispDrivers[0].edgePct,3);
assert.equal(crispDrivers[1].edgePct,2);
assert.equal(crispDrivers.some(x=>x.label==="TEAM TOTAL"),false);

console.log("Crisp lineup-driver differential checks passed");


const { injuryOpportunityForecast } = await import("../netlify/functions/roster-actions-background.mjs");

const injuryBoosted=injuryOpportunityForecast(
  {
    name:"Backup WR",pos:"WR",next3:10,weeks:{3:10,4:10,5:10},
    forecastSource:"blended_form"
  },
  {
    name:"Backup WR",key:"backup wr",team:"GB",pos:"WR",
    targetShare:.24,carryShare:null,aDot:11,effectiveTargets:30
  },
  {
    activeTargetShare:.45,vacatedTargetShare:.30,
    activeRbCarryShare:0,vacatedRbCarryShare:0,
    vacatedNames:["Alpha WR"],activeNames:["Backup WR"]
  },
  3
);
assert.equal(injuryBoosted.injuryOpportunity.applied,true);
assert.ok(injuryBoosted.next3>10);
assert.ok(injuryBoosted.weeks[3]>injuryBoosted.next3);
assert.ok(injuryBoosted.forecastSource.includes("vacated"));

const lowSampleBoost=injuryOpportunityForecast(
  {name:"Unknown WR",pos:"WR",next3:8,weeks:{3:8},forecastSource:"provider"},
  {
    name:"Unknown WR",key:"unknown wr",team:"GB",pos:"WR",
    targetShare:.08,carryShare:null,aDot:10,effectiveTargets:1
  },
  {
    activeTargetShare:.45,vacatedTargetShare:.30,
    activeRbCarryShare:0,vacatedRbCarryShare:0,
    vacatedNames:["Alpha WR"],activeNames:["Unknown WR"]
  },
  3
);
assert.equal(lowSampleBoost.injuryOpportunity.applied,false);
assert.equal(lowSampleBoost.next3,8);

console.log("Injury-created waiver opportunity checks passed");


const { touchdownFantasyPoints } = await import("../netlify/functions/roster-actions-background.mjs");

assert.equal(
  touchdownFantasyPoints(
    {passing_tds:2,rushing_tds:1,receiving_tds:0},
    {pass_td:6,rush_td:6,rec_td:6}
  ),
  18
);

const lowTdForm=blendedRosterForecast(10,{
  currentGames:3,recentPts:18,baselinePts:10,roleRatio:1,
  tdDependency:.12
});
const tdMirageForm=blendedRosterForecast(10,{
  currentGames:3,recentPts:18,baselinePts:10,roleRatio:1,
  tdDependency:.70
});
assert.ok(tdMirageForm.forecast<lowTdForm.forecast);
assert.ok(tdMirageForm.mirageRisk>.4);
assert.equal(tdMirageForm.source,"blended_form_regressed");

const tdRoleBacked=blendedRosterForecast(10,{
  currentGames:3,recentPts:18,baselinePts:10,roleRatio:1.22,
  tdDependency:.70
});
assert.ok(tdRoleBacked.forecast>tdMirageForm.forecast);
assert.ok(tdRoleBacked.mirageRisk<tdMirageForm.mirageRisk);

console.log("Touchdown-dependency regression checks passed");


const { reserveEligibility } = await import("../netlify/functions/roster-actions-background.mjs");

assert.equal(reserveEligibility("IR",{}),true);
assert.equal(reserveEligibility("PUP",{}),true);
assert.equal(reserveEligibility("Out",{reserve_allow_out:1}),true);
assert.equal(reserveEligibility("Out",{reserve_allow_out:0}),false);
assert.equal(reserveEligibility("Doubtful",{reserve_allow_doubtful:1}),true);
assert.equal(reserveEligibility("Doubtful",{reserve_allow_doubtful:0}),false);
assert.equal(reserveEligibility("Suspended",{reserve_allow_sus:1}),true);
assert.equal(reserveEligibility("Suspended",{reserve_allow_sus:0}),false);
assert.equal(reserveEligibility("Questionable",{reserve_allow_out:1}),false);

console.log("League-specific IR eligibility checks passed");


const {
  postGameWaiverForecast,waiverSignalAgreement,buildIrFirstPlan
} = await import("../netlify/functions/roster-actions-background.mjs");

assert.equal(postGameWaiverForecast({
  gameLocked:true,next3:20,weeks:{3:20,4:11,5:13,6:15}
},3),13);
assert.equal(postGameWaiverForecast({
  gameLocked:false,next3:12,weeks:{4:20,5:20}
},3),12);

let agreement=waiverSignalAgreement({
  waiverOnly:true,fastTrending:80,trendVelocity:25,
  weeklyDelta:0,depthDelta:0,roleRatio:1,mirageRisk:0
});
assert.equal(agreement.market,true);
assert.equal(agreement.count,1);
assert.equal(agreement.actionable,false);

agreement=waiverSignalAgreement({
  waiverOnly:true,fastTrending:80,trendVelocity:25,
  weeklyDelta:1.4,depthDelta:1.8,roleRatio:1,mirageRisk:0
});
assert.equal(agreement.count,2);
assert.equal(agreement.actionable,true);

agreement=waiverSignalAgreement({
  waiverOnly:true,fastTrending:80,weeklyDelta:1.4,
  roleRatio:1,mirageRisk:.7
});
assert.equal(agreement.actionable,false);

const sundayClaim=deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:true,faabRemainingPct:100,
  waivers:[{
    add:"Sunday Breakout",drop:"Bench End",waiverOnly:true,
    weeklyDelta:1.4,depthDelta:1.8,fastTrending:80,trendVelocity:25,
    signalCount:2,signalAgreement:waiverSignalAgreement({
      waiverOnly:true,fastTrending:80,trendVelocity:25,weeklyDelta:1.4,depthDelta:1.8
    }),
    trending:300,stash:false
  }],
  trades:[]
});
assert.ok(sundayClaim.actions[0].headline.startsWith("Claim Sunday Breakout"));
assert.equal(sundayClaim.actions[0].window,"NEXT WAIVER RUN");
assert.equal(sundayClaim.actions[0].waiverOnly,true);
assert.ok(sundayClaim.actions[0].faabPct<=8);

const lockedIrClaim=buildIrFirstPlan({
  irPlayer:{name:"Injured Starter"},
  irAdd:{name:"Sunday Breakout"},
  irWaiver:{
    add:"Sunday Breakout",drop:"Bench End",waiverOnly:true,
    claimRank:1,claimRole:"PRIMARY",depthDelta:2
  },
  irWeeklyDelta:0
});
assert.equal(lockedIrClaim.window,"NEXT WAIVER RUN");
assert.equal(lockedIrClaim.waiverOnly,true);
assert.match(lockedIrClaim.headline,/claim Sunday Breakout next waiver/i);

const openFaIrAdd=buildIrFirstPlan({
  irPlayer:{name:"Injured Starter"},
  irAdd:{name:"Emerging WR"},
  irWaiver:{
    add:"Emerging WR",drop:"Bench End",immediateFreeAgent:true,
    claimRank:1,claimRole:"PRIMARY",depthDelta:2
  },
  irWeeklyDelta:0
});
assert.equal(openFaIrAdd.window,"NOW");
assert.equal(openFaIrAdd.immediateFreeAgent,true);
assert.match(openFaIrAdd.headline,/add Emerging WR/i);

const sundayPulse=await import("../netlify/functions/roster-sunday-pulse.mjs");
const sundayLatePulse=await import("../netlify/functions/roster-sunday-late-pulse.mjs");
const lineupPulse=await import("../netlify/functions/lineup-sunday-pulse.mjs");
const lineupLatePulse=await import("../netlify/functions/lineup-sunday-late-pulse.mjs");
assert.equal(typeof sundayPulse.default,"function");
assert.equal(typeof sundayLatePulse.default,"function");
assert.equal(typeof lineupPulse.default,"function");
assert.equal(typeof lineupLatePulse.default,"function");
assert.ok(sundayPulse.config?.schedule.includes("*/10"));
assert.ok(lineupPulse.config?.schedule.includes("*/15"));

console.log("Sunday pulse freshness and next-waiver scouting checks passed");


const { diagnoseTeamState } = await import("../netlify/functions/lib/team-state.mjs");

const scheduleVariance=diagnoseTeamState([
  {rosterId:1,wins:0,losses:2,pointsFor:220,pointsAgainst:300,benchLeakage:10,injured:[]},
  {rosterId:2,wins:2,losses:0,pointsFor:210,pointsAgainst:180,benchLeakage:14,injured:[]},
  {rosterId:3,wins:1,losses:1,pointsFor:200,pointsAgainst:200,benchLeakage:12,injured:[]},
  {rosterId:4,wins:1,losses:1,pointsFor:190,pointsAgainst:190,benchLeakage:10,injured:[]},
],{rosterId:1,wins:0,losses:2,pointsFor:220,pointsAgainst:300,benchLeakage:10,injured:[]});
assert.equal(scheduleVariance.code,"SCHEDULE_VARIANCE");
assert.ok(scheduleVariance.aggression<1);
assert.equal(scheduleVariance.tradePosture,"hold_value");

const lineupLeak=diagnoseTeamState([
  {rosterId:1,wins:0,losses:2,pointsFor:180,pointsAgainst:220,benchLeakage:80,injured:[]},
  {rosterId:2,wins:2,losses:0,pointsFor:230,pointsAgainst:180,benchLeakage:10,injured:[]},
  {rosterId:3,wins:1,losses:1,pointsFor:210,pointsAgainst:200,benchLeakage:10,injured:[]},
  {rosterId:4,wins:1,losses:1,pointsFor:200,pointsAgainst:190,benchLeakage:10,injured:[]},
],{rosterId:1,wins:0,losses:2,pointsFor:180,pointsAgainst:220,benchLeakage:80,injured:[]});
assert.equal(lineupLeak.code,"LINEUP_LEAK");
assert.equal(lineupLeak.tradePosture,"fix_lineup");

const rosterWeak=diagnoseTeamState([
  {rosterId:1,wins:0,losses:2,pointsFor:160,pointsAgainst:220,benchLeakage:10,injured:[]},
  {rosterId:2,wins:2,losses:0,pointsFor:240,pointsAgainst:180,benchLeakage:16,injured:[]},
  {rosterId:3,wins:1,losses:1,pointsFor:220,pointsAgainst:200,benchLeakage:14,injured:[]},
  {rosterId:4,wins:1,losses:1,pointsFor:205,pointsAgainst:190,benchLeakage:12,injured:[]},
],{rosterId:1,wins:0,losses:2,pointsFor:160,pointsAgainst:220,benchLeakage:10,injured:[]});
assert.equal(rosterWeak.code,"ROSTER_UPGRADE");
assert.ok(rosterWeak.aggression>1);
assert.equal(rosterWeak.tradePosture,"consolidate");

const aggressiveFaab=deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:true,faabRemainingPct:100,
  teamState:rosterWeak,
  waivers:[{add:"Upgrade",drop:"Bench",weeklyDelta:2,depthDelta:2,trending:0}],
  trades:[]
});
const patientFaab=deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:true,faabRemainingPct:100,
  teamState:scheduleVariance,
  waivers:[{add:"Upgrade",drop:"Bench",weeklyDelta:2,depthDelta:2,trending:0}],
  trades:[]
});
assert.ok(aggressiveFaab.actions[0].faabPct>patientFaab.actions[0].faabPct);

const noPanicTrade=deterministicRosterFallback({
  mode:"REDRAFT",usesFaab:false,teamState:scheduleVariance,
  waivers:[],
  trades:[{
    target:"Marginal Target",partner:"Rival",weeklyDelta:1.1,partnerWeeklyDelta:.2,
    why:"Small improvement",send:[{type:"player",name:"Bench"}]
  }]
});
assert.equal(noPanicTrade.actions[0].type,"HOLD");

console.log("Team-state diagnosis and anti-panic behavior checks passed");


const { acquisitionPolicy } = await import("../netlify/functions/lib/roster-v2.mjs");
const {
  normalizeSleeperWeekStats,liveRoleEmergence
} = await import("../netlify/functions/lib/live-market.mjs");

const ochoPolicy=acquisitionPolicy({name:"The Ocho"});
assert.equal(ochoPolicy.mode,"OPEN_FA");
assert.equal(ochoPolicy.canAddStartedPlayers,true);
const funPolicy=acquisitionPolicy({name:"Teenypetes"});
assert.equal(funPolicy.mode,"WAIVERS");
assert.equal(funPolicy.canAddStartedPlayers,false);

const liveWr=liveRoleEmergence({
  pos:"WR",progress:.5,baselineTargets:5,
  stats:{rec_tgt:6,off_snp:32,tm_off_snp:45}
});
assert.equal(liveWr.strong,true);
assert.ok(liveWr.targetPace>=12);
assert.ok(liveWr.snapShare>=70);

const touchdownOnly=liveRoleEmergence({
  pos:"WR",progress:.5,baselineTargets:5,
  stats:{rec_td:2,rec_yd:82}
});
assert.equal(touchdownOnly,null);

const liveRb=liveRoleEmergence({
  pos:"RB",progress:.55,baselineCarries:7,baselineTargets:2,
  stats:{rush_att:8,rec_tgt:3,off_snp:30,tm_off_snp:43}
});
assert.equal(liveRb.strong,true);
assert.ok(liveRb.touchPace>=19);

const normalized=normalizeSleeperWeekStats({
  "wr1":{rec_tgt:5},
  "rb1":{stats:{rush_att:9}}
});
assert.equal(normalized.wr1.rec_tgt,5);
assert.equal(normalized.rb1.rush_att,9);

const liveAgreement=waiverSignalAgreement({
  liveRole:liveWr,depthDelta:2,weeklyDelta:0,marketDelta:0,
  fastTrending:0,trendVelocity:0,mirageRisk:0
});
assert.equal(liveAgreement.liveRole,true);
assert.equal(liveAgreement.actionable,true);

assert.equal(waiverMoveActionable({
  immediateFreeAgent:true,liveRole:liveWr,depthDelta:2,weeklyDelta:0,
  marketDelta:0,fastTrending:0,trendVelocity:0,mirageRisk:0,stash:true
},"DYNASTY"),true);

const immediateAdd=deterministicRosterFallback({
  mode:"DYNASTY",usesFaab:false,
  waivers:[{
    add:"Emerging WR",drop:"Bench WR",weeklyDelta:0,depthDelta:2,
    marketDelta:0,liveRole:liveWr,immediateFreeAgent:true,stash:true,
    signalAgreement:liveAgreement
  }],
  trades:[]
});
assert.equal(immediateAdd.actions[0].window,"NOW");
assert.match(immediateAdd.actions[0].headline,/Add Emerging WR now/);

const { buildAllPlayMetrics } = await import("../netlify/functions/lib/team-state.mjs");
const allPlay=buildAllPlayMetrics([
  [
    {roster_id:1,points:100},{roster_id:2,points:130},
    {roster_id:3,points:110},{roster_id:4,points:90}
  ],
  [
    {roster_id:1,points:120},{roster_id:2,points:130},
    {roster_id:3,points:110},{roster_id:4,points:100}
  ]
],1,0);
assert.equal(allPlay.expectedWins,1);
assert.equal(allPlay.allPlayWinPct,50);
assert.equal(allPlay.luckWins,-1);

const allPlayScheduleLoss=diagnoseTeamState([
  {rosterId:1,wins:0,losses:2,pointsFor:220,pointsAgainst:180,benchLeakage:20,injured:[]},
  {rosterId:2,wins:2,losses:0,pointsFor:210,pointsAgainst:260,benchLeakage:12,injured:[]},
  {rosterId:3,wins:1,losses:1,pointsFor:200,pointsAgainst:240,benchLeakage:10,injured:[]},
  {rosterId:4,wins:1,losses:1,pointsFor:190,pointsAgainst:220,benchLeakage:10,injured:[]},
],{rosterId:1,wins:0,losses:2,pointsFor:220,pointsAgainst:180,benchLeakage:20,injured:[]},{allPlay});
assert.equal(allPlayScheduleLoss.code,"SCHEDULE_VARIANCE");
assert.equal(allPlayScheduleLoss.pointsAgainstRank,4);
assert.equal(allPlayScheduleLoss.allPlayExpectedWins,1);

console.log("Open-FA live breakout and all-play diagnosis checks passed");
