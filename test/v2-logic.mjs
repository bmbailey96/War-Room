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
