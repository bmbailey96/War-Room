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
  buildDepthSecondaries,buildSleeperSecondaries,buildDefenderCoverage,inferWrCoverage,receiverRanks,buildTeamPassRush,
  buildSleeperLineUnits,buildSleeperMiddleUnits,inferTeCoverageUnit,
  buildRbDefenseSplits,rbUsageSplit,combineRbMicroEdge,protectionEdge
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
