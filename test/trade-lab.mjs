import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../trade-lab.js",import.meta.url),"utf8");
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("../trade-fit.js",import.meta.url),"utf8"),ctx);
vm.runInContext(src,ctx);
const {evaluate,startingBaseline,keyPlayer,keyPick,assetsForTeam}=ctx.WarRoomTradeLab;
const p=(id,pos,mean=10,value=20)=>({
  id,name:id,pos,fantasyPositions:[pos],recentMean:mean,observedWeeks:3,
  marketValue:value,injury:null,onReserve:false
});
const rosterA=[
  p("QB A","QB",19,40),p("RB A","RB",15,30),p("RB A2","RB",12,20),
  p("WR A","WR",18,40),p("WR A2","WR",11,10),p("TE A","TE",8,10),
  p("TE A2","TE",6,8)
];
const rosterB=[
  p("QB B","QB",16,22),p("RB B","RB",22,40),p("RB B2","RB",11,20),p("RB B3","RB",9,7),
  p("WR B","WR",12,20),p("WR B2","WR",10,12),p("TE B","TE",12,14),
  p("TE B2","TE",4,5)
];
const state={
  league:{id:"league123",mode:"DYNASTY",activeSlots:["QB","RB","RB","WR","WR","TE"]},
  tradeInventory:{at:100000,marketSourceDate:"2026-11-06",teams:[
    {rosterId:"1",name:"Me",isMe:true,players:rosterA,
      picks:[{key:"2027|1|1",season:2027,round:1,originalTeam:"Me",marketValue:23}]},
    {rosterId:"2",name:"Other",isMe:false,players:rosterB,
      picks:[{key:"2027|1|2",season:2027,round:1,originalTeam:"Other",marketValue:33}]},
  ]}
};
const before=startingBaseline(rosterA,state.league.activeSlots);
assert.equal(before.score,83);
assert.equal(assetsForTeam(state.tradeInventory.teams[0]).length,8);
const offer=evaluate(state,"1","2",[keyPlayer(rosterA[6])],[keyPlayer(rosterB[1])]);
assert.equal(offer.ok,true);
assert.ok(offer.twoSidedFit);
assert.ok(offer.twoSidedFit.partner.context.inferredDirection);
assert.match(offer.twoSidedFit.why.join(" "),/wants and negotiating priorities are unknown/);
assert.equal(offer.receive[0].name,"RB B");
assert.equal(offer.market.sentValue,8);
assert.equal(offer.market.receivedValue,40);
assert.equal(offer.market.netValue,32);
assert.equal(offer.historicalBaseline.myDelta,10);
assert.equal(offer.historicalBaseline.theirDelta,-13);
assert.match(offer.classification,/NOT A TRADE RECOMMENDATION/);
assert.equal(evaluate(state,"1","2",["P:RB B"],["P:RB A"]).ok,false);
assert.equal(evaluate(state,"1","1",["P:RB A"],["P:RB A"]).ok,false);
const pickOffer=evaluate(state,"1","2",[keyPick(state.tradeInventory.teams[0].picks[0])],[keyPlayer(rosterB[1])]);
assert.ok(pickOffer.risks.some(x=>/Pick valuation/.test(x)));
const mismatched={
 ...state,tradeInventory:{...state.tradeInventory,teams:[
   {...state.tradeInventory.teams[0],players:[...rosterA.slice(0,6),{...rosterA[6],marketValue:null}]},
   state.tradeInventory.teams[1]
 ]}
};
const unpriced=evaluate(mismatched,"1","2",["P:TE A2"],["P:RB B"]);
assert.equal(unpriced.market.priced,false);
assert.equal(unpriced.market.netValue,null);
const sparse={...rosterA[0],recentMean:null};
const short=startingBaseline([sparse,...rosterA.slice(1)],state.league.activeSlots);
assert.equal(short.score,null);
assert.match(short.reason,/Not enough players/);
const flex=startingBaseline([
 p("QB","QB",20),p("RB","RB",12),p("WR","WR",18),p("TE","TE",10)
],["QB","RB","WR","FLEX"]);
assert.equal(flex.score,60);
console.log("Trade lab engine checks passed: ownership, prices, missing values, roster deltas, picks, and flex optimization.");
