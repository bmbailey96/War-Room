import assert from "node:assert/strict";
import { gradeCapturedProjections } from "../netlify/functions/lib/gm-calibration.mjs";

const before=1_000, kickoff=2_000, after=3_000;
const complete=[
  {week:1,rows:[{roster_id:1,players_points:{"1":10}}]},
  {week:2,rows:[{roster_id:1,players_points:{"1":20}}]},
  {week:3,rows:[{roster_id:1,players_points:{"1":30}}]},
  {week:4,rows:[{roster_id:1,players_points:{"1":40}}]},
];
const pred=(week,projection,savedAt=before)=>({week,season:2026,
  players:{"1":{name:"Player",slot:"RB",source:"custom",projection,savedAt,kickoffAt:kickoff}}});
const logs={1:pred(1,12),2:pred(2,18),3:pred(3,35),4:pred(4,35,after)};
const g=gradeCapturedProjections(complete,logs,{"1":{p:"RB",fp:["RB"]}});
assert.equal(g.evaluatedSamples,3);
assert.equal(g.savedForecastsMatchedToScores,4);
assert.equal(g.excludedAfterKickoffOrMissingTimestamp,1);
assert.equal(g.overall.n,3);
assert.equal(g.overall.modelMae,3);
assert.equal(g.overall.naiveCompared,1);
assert.equal(g.overall.naiveMae,15);
assert.equal(g.overall.modelMaeCompared,5);
assert.equal(g.qbRbWrTeNonSleeper.n,3);
assert.equal(g.verdict,"INSUFFICIENT_BASELINE_COMPARISON");
assert.match(g.note,/pre-kickoff/);
assert.ok(g.recentModelMisses.some(x=>x.name==="Player"));

const empty=gradeCapturedProjections(complete,{1:{players:{"1":{projection:12}}}});
assert.equal(empty.evaluatedSamples,0);
assert.equal(empty.verdict,"NO_VERIFIED_PREGAME_SAMPLES");

const row=(week,score)=>({week,rows:[{roster_id:1,players_points:Object.fromEntries(
  Array.from({length:20},(_,i)=>[String(i+1),score]))}]});
const many=[row(1,10),row(2,20),row(3,30)];
const numerous=Object.fromEntries(many.map(x=>[x.week,{
  week:x.week,
  players:Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),{
    slot:"RB",source:"custom",projection:x.week*10,savedAt:before,kickoffAt:kickoff
  }]))
}]));
const larger=gradeCapturedProjections(many,numerous);
assert.equal(larger.overall.n,60);
assert.equal(larger.overall.naiveCompared,20);
assert.equal(larger.overall.modelMaeCompared,0);
assert.equal(larger.overall.naiveMae,15);
assert.equal(larger.verdict,"MODEL_BEATS_NAIVE");
console.log("Forecast grade checks passed: pregame-only records, strict naive baseline, missing data and sample gates.");