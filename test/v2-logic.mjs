import assert from "node:assert/strict";
import {
  eligibility, easternKickoffMs, scoreSleeperProjection, playerValue
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
