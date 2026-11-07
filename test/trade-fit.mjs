import assert from "node:assert/strict";
import "../trade-fit.js";

const {assess,depth}=globalThis.WarRoomTradeFit;
const p=(id,pos,age=25)=>({id,name:id,pos,age,observedWeeks:3,recentMean:12,onReserve:false,injury:null});
const slots=["QB","RB","RB","WR","WR","TE","FLEX"];
const me=[
  p("meQB","QB"),p("meRB1","RB"),p("meRB2","RB"),
  p("meWR1","WR"),p("meWR2","WR"),p("meWR3","WR"),p("meWR4","WR"),
  p("meTE1","TE"),p("meTE2","TE")
];
const them=[
  p("theirQB","QB"),p("theirRB1","RB"),p("theirRB2","RB"),p("theirRB3","RB"),p("theirRB4","RB"),
  p("theirWR1","WR"),p("theirWR2","WR"),
  p("theirTE1","TE"),p("theirTE2","TE")
];
const audit={
  league:{mode:"REDRAFT",activeSlots:slots,playoffTeams:4,teamCount:10},
  teams:[{rosterId:2,name:"Me",standing:3,pfRank:2,tradeCount:0},
    {rosterId:4,name:"Fourth and noob",standing:9,pfRank:8,tradeCount:0}]
};
const meTeam={rosterId:2,name:"Me",players:me};
const partner={rosterId:4,name:"Fourth and noob",players:them,tradeHistory:{positionsAcquired:{RB:2},completedTrades:1}};
const send=[{type:"player",id:"P:meWR4",player:me.find(x=>x.id==="meWR4")}];
const receive=[{type:"player",id:"P:theirRB4",player:them.find(x=>x.id==="theirRB4")}];
const good=assess({audit,me:meTeam,partner,send,receive});
assert.equal(good.status,"TWO-SIDED ROSTER FIT");
assert.equal(good.hasMutualDepthFit,true);
assert.ok(good.mine.reasons.some(x=>/RB coverage improves/.test(x)));
assert.ok(good.partner.reasons.some(x=>/WR coverage improves/.test(x)));
assert.equal(good.risks.length,0);
assert.match(good.why.join(" "),/wants and negotiating priorities are unknown/);
assert.match(good.why.join(" "),/historical acquisition evidence/);
assert.match(good.why.join(" "),/No completed trades observed/);
assert.equal(good.partner.context.inferredDirection.includes("trade preference"),true);

// One-sided trade: their WR position is already deep, while losing RB
// exposes their required second starter.
const injuredPartner={...partner,players:them.filter(x=>x.id!=="theirRB3"&&x.id!=="theirRB4")
  .concat(p("extraWR","WR"),p("extraWR2","WR"),them.find(x=>x.id==="theirRB4"))};
const harmful=assess({audit,me:meTeam,partner:injuredPartner,send,receive});
assert.equal(harmful.hasMutualDepthFit,false);
assert.ok(harmful.partner.risks.some(x=>/RB coverage deteriorates/.test(x)));
assert.equal(harmful.status,"CREATES A DEPTH PROBLEM");

// A one-QB league with one healthy QB is not "urgent QB depth".
assert.equal(depth(me,slots).needs.some(x=>x.position==="QB"),false);
const missing={...meTeam,players:me.filter(x=>x.pos!=="QB")};
assert.ok(depth(missing.players,slots).needs.some(x=>x.position==="QB"&&x.level==="urgent"));

// A dynasty pick is a possible future-capital incentive, not a known owner desire.
const dyn=assess({audit:{...audit,league:{...audit.league,mode:"DYNASTY"}},
  me:meTeam,partner,send,receive:[{type:"pick",id:"K:2027|1|4",pick:{season:2027,round:1}}]});
assert.equal(dyn.hasMutualDepthFit,false);
assert.match(dyn.mine.notes.join(" "),/manager's preference for picks is unverified/);

// Out and IR cannot be counted as live replacement depth.
const out=depth([...them,p("outRB","RB")].map(x=>x.id==="outRB"?{...x,injury:"Out"}:x),slots);
assert.equal(out.count.RB,4);
console.log("Two-sided trade fit tests passed: both needs, opponent risk, non-negotiating managers, dynasty picks and injuries.");
