import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../decision-brief.js", import.meta.url), "utf8");
const context = vm.createContext({Date});
vm.runInContext(code, context);
const {build,packet,conflicts} = context.WarRoomDecisionBrief;
const now=Date.parse("2026-11-06T22:00:00Z");
const lineup = {
  league:{name:"Fun League"},week:9,opponent:"Other team",
  currentTotal:131.1,optimalTotal:135.4,gain:4.3,
  model:{samples:41,reasoningCalls:0},
  current:[{slot:"TE",player:{pid:"1",name:"Brock Bowers",projection:17}}],
  optimal:[{slot:"TE",player:{pid:"1",name:"Brock Bowers"}},{slot:"FLEX",player:{pid:"2",name:"Isaiah Likely"}}],
  players:[
    {pid:"1",name:"Brock Bowers",slot:"TE",projection:17,sleeper:18},
    {pid:"2",name:"Isaiah Likely",slot:"TE",projection:12,sleeper:10},
    {pid:"3",name:"Tyler Bass",slot:"K",projection:8,sleeper:8},
    {pid:"4",name:"Tyler Loop",slot:"K",projection:7,sleeper:7},
    {pid:"5",name:"Chase Brown",slot:"RB",projection:15,sleeper:16},
    {pid:"6",name:"Alvin Kamara",slot:"RB",projection:10,sleeper:9},
    {pid:"7",name:"RJ Harvey",slot:"RB",out:true,projection:0,sleeper:0},
  ],
  actionableCalls:[{start:{pid:"2",name:"Isaiah Likely"},sit:{pid:"9",name:"Denzel Boston"},edge:4.3}],
  unfilledSlots:[],flexMoves:[],contingencies:[],
};
const market={
  at:now-10*60000,freshness:{targetMinutes:30},league:{mode:"REDRAFT",name:"Fun League"},
  context:{teamState:{label:"FRINGE TEAM",summary:"Fix starting depth."}},
  actions:[
    {type:"ADD_DROP",headline:"Drop Brock Bowers for Breakout TE",drop:{pid:"1",name:"Brock Bowers"},add:{name:"Breakout TE"},weeklyDelta:4,immediateFreeAgent:true},
    {type:"WAIVER",headline:"Add useful RB",drop:{pid:"4",name:"Tyler Loop"},add:{name:"Useful RB"},weeklyDelta:2,waiverOnly:true},
  ],
};
const result=build(lineup,market,{now});
assert.equal(result.mode,"REDRAFT");
assert.match(result.rightNow.map(x=>x.title).join("|"),/Start Isaiah Likely over Denzel Boston/);
assert.doesNotMatch(result.rightNow.map(x=>x.title).join("|"),/Drop Brock Bowers/);
assert.match(result.rightNow.map(x=>x.title).join("|"),/Add useful RB/);
assert.match(result.longGame.map(x=>x.title).join("|"),/spare kicker/);
assert.match(result.longGame.map(x=>x.title).join("|"),/Running-back cover/);
assert.match(result.quality.join("|"),/Zero graded reasoning calls/);
assert.equal(conflicts(market.actions[0],lineup),true);

const stale=build(lineup,{...market,at:now-9*3600000},{now});
assert.doesNotMatch(stale.rightNow.map(x=>x.title).join("|"),/Add useful RB/);
assert.match(stale.investigate.map(x=>x.title).join("|"),/Refresh the pickup/);

const locked=build({...lineup,actionableCalls:[{start:{name:"Locked",locked:true},sit:{name:"Somebody"},edge:20}]},null,{now});
assert.doesNotMatch(locked.rightNow.map(x=>x.title).join("|"),/Start Locked/);
assert.match(locked.rightNow.map(x=>x.title).join("|"),/No clear immediate move/);

const nearTie=build({...lineup,actionableCalls:[{start:{name:"A"},sit:{name:"B"},edge:0.2}]},null,{now});
assert.doesNotMatch(nearTie.rightNow.map(x=>x.title).join("|"),/Start A/);

const dynasty=build({
  ...lineup,league:{name:"The Ocho"},actionableCalls:[],players:[
    {slot:"TE",name:"Sam LaPorta"},
    {slot:"TE",name:"Tucker Kraft"},
    {slot:"TE",name:"Harold Fannin Jr."},
    {slot:"QB",name:"Josh Allen",projection:19,sleeper:25}
  ]
},{...market,league:{mode:"DYNASTY",name:"The Ocho"},actions:[]},{now});
assert.match(dynasty.longGame.map(x=>x.title).join("|"),/tight-end trade market/);
assert.doesNotMatch(dynasty.longGame.map(x=>x.title).join("|"),/spare kicker/);
assert.match(dynasty.quality.join("|"),/Josh Allen 19.0\/25.0/);

const packetText=packet(lineup,market,{now});
assert.match(packetText,/ALL ROSTERED PLAYERS/);
assert.match(packetText,/ACTUAL ROSTER ACTION CANDIDATES/);
assert.match(packetText,/Public headlines NOT incorporated/);
assert.ok(packetText.length<24001);
console.log("Decision-brief logic checks passed: stale market, verified lineup, roster conflicts, dynasty/redraft and evidence packet.");
