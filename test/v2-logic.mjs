import assert from "node:assert/strict";
import {
  eligibility, easternKickoffMs, scoreSleeperProjection, playerValue, optimize
} from "../netlify/functions/lineup.mjs";
import {
  mergeProjectionSnapshot, mergeReasoningSnapshot
} from "../netlify/functions/lib/freeze-v2.mjs";
import { isReasoningWindow } from "../netlify/functions/lineup-refresh.mjs";

const flexPlayer={slot:"WR",eligibleSlots:["WR"]};
assert.equal(eligibility("FLEX",flexPlayer),true);
assert.equal(eligibility("RB",flexPlayer),false);

const idp={slot:"DL",eligibleSlots:["DL","LB"]};
assert.equal(eligibility("DL",idp),true);
assert.equal(eligibility("LB",idp),true);

const superFlex={slot:"QB",eligibleSlots:["QB"]};
assert.equal(eligibility("SUPER_FLEX",superFlex),true);

const exactLineup=optimize([
  {pid:"multi",slot:"WR",eligibleSlots:["WR","TE"],projection:20,locked:false,out:false},
  {pid:"wr",slot:"WR",eligibleSlots:["WR"],projection:19,locked:false,out:false},
  {pid:"te",slot:"TE",eligibleSlots:["TE"],projection:1,locked:false,out:false},
],["WR","TE"],[]);
assert.equal(exactLineup.total,39);
assert.equal(exactLineup.picked.find(x=>x.slot==="WR").player.pid,"wr");
assert.equal(exactLineup.picked.find(x=>x.slot==="TE").player.pid,"multi");

const lockedLineup=optimize([
  {pid:"locked",slot:"TE",eligibleSlots:["TE"],projection:6,actual:17.2,completed:true,locked:true,out:false},
  {pid:"bench",slot:"TE",eligibleSlots:["TE"],projection:20,locked:false,out:false},
],[ "TE" ],[{slot:"TE",player:{pid:"locked",slot:"TE",eligibleSlots:["TE"],projection:6,actual:17.2,completed:true,locked:true,out:false}}]);
assert.equal(lockedLineup.picked[0].player.pid,"locked");
assert.equal(lockedLineup.total,17.2);

const kickoff=easternKickoffMs("2026-09-17","20:15");
assert.equal(new Date(kickoff).toISOString(),"2026-09-18T00:15:00.000Z");

assert.equal(playerValue({locked:true,completed:true,actual:23.4,projection:11.2}),23.4);
assert.equal(playerValue({locked:true,completed:false,actual:3.4,projection:11.2}),11.2);
assert.equal(playerValue({locked:true,completed:false,actual:23.4,projection:11.2}),23.4);
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

const freezeData={
  league:{id:"L1",season:2026},
  week:2,
  players:[
    {pid:"1",name:"Open Player",slot:"WR",team:"A",projection:12,base:11,rawBase:10,signals:{roleRatio:1.1},locked:false},
    {pid:"2",name:"Locked Player",slot:"TE",team:"B",projection:15,base:14,rawBase:13,signals:{},locked:true},
    {pid:"3",name:"Another Open",slot:"RB",team:"C",projection:9,base:8,rawBase:8,signals:{},locked:false},
  ],
};
const priorProjection={
  players:{
    "2":{pid:"2",name:"Locked Player",projection:8,savedAt:100},
  },
};
const frozen=mergeProjectionSnapshot(freezeData,priorProjection,200);
assert.equal(frozen.players["1"].projection,12);
assert.equal(frozen.players["2"].projection,8);
assert.equal(frozen.players["2"].savedAt,100);
assert.equal(frozen.players["3"].savedAt,200);

const firstReason=mergeReasoningSnapshot(freezeData,{
  calls:[
    {start:"Open Player",sit:"Another Open",slot:"FLEX",drivers:["role"]},
    {start:"Open Player",sit:"Locked Player",slot:"FLEX",drivers:["injury"]},
  ],
},null,300);
assert.equal(Object.keys(firstReason.calls).length,1);
const key=Object.keys(firstReason.calls)[0];
assert.equal(firstReason.calls[key].startPid,"1");
assert.equal(firstReason.calls[key].sitPid,"3");

const flipped=mergeReasoningSnapshot(freezeData,{
  calls:[{start:"Another Open",sit:"Open Player",slot:"FLEX",drivers:["matchup"]}],
},firstReason,400);
assert.equal(Object.keys(flipped.calls).length,1);
assert.equal(flipped.calls[key].startPid,"3");
assert.deepEqual(flipped.calls[key].drivers,["matchup"]);

const now=Date.parse("2026-09-19T12:00:00Z");
assert.equal(isReasoningWindow({players:[{locked:false,kickoffAt:"2026-09-19T15:00:00Z"}]},now),true);
assert.equal(isReasoningWindow({players:[{locked:false,kickoffAt:"2026-09-20T12:00:00Z"}]},now),false);
assert.equal(isReasoningWindow({players:[{locked:true,kickoffAt:"2026-09-19T13:00:00Z"}]},now),false);

console.log("War Room V2 logic checks passed");
