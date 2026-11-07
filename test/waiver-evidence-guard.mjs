import assert from "node:assert/strict";
import {waiverEvidenceGuard} from "../netlify/functions/lib/waiver-evidence-guard.mjs";

const qb={pos:"QB",name:"Brock Purdy",injury:null};
const stash={type:"ADD_DROP",faabPct:4};
const breakout={pos:"RB",name:"Mike Washington Jr.",recentCarrySequence:[5,7,25],
  recentCarries:12.3,baselineCarries:5.7,roleRatio:1.3};
const smallRole={pos:"RB",name:"Steady Bench Back",recentCarrySequence:[4,5,5],
  recentCarries:4.7,baselineCarries:4.4};
const rbAdd={pos:"RB",name:"Rachaad White"};
const evidence=waiverEvidenceGuard({mode:"REDRAFT",action:stash,add:rbAdd,drop:breakout,
  weeklyDelta:0,activeSlots:["QB","RB","RB","WR","WR","TE","FLEX"],roster:[qb]});
assert.equal(evidence.block,true);
assert.match(evidence.reasons[0],/25 in latest recorded game/);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:stash,add:rbAdd,drop:smallRole,
  weeklyDelta:0,activeSlots:["QB","RB"],roster:[qb]}).block,false);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:stash,add:rbAdd,drop:breakout,
  weeklyDelta:3,activeSlots:["QB","RB"],roster:[qb]}).block,false);
assert.equal(waiverEvidenceGuard({mode:"DYNASTY",action:stash,add:rbAdd,drop:breakout,
  weeklyDelta:0,activeSlots:["QB","RB"],roster:[qb]}).block,false);

const stroud={pos:"QB",name:"C.J. Stroud"};
const highBid=waiverEvidenceGuard({mode:"REDRAFT",action:{faabPct:12},add:stroud,
  drop:{pos:"WR"},weeklyDelta:0,activeSlots:["QB","RB","WR"],roster:[qb]});
assert.equal(highBid.block,true);
assert.match(highBid.reasons[0],/12% FAAB/);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:{faabPct:2},add:stroud,
  drop:{pos:"WR"},weeklyDelta:0,activeSlots:["QB","RB","WR"],roster:[qb]}).block,false);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:{faabPct:12},add:stroud,
  drop:{pos:"WR"},weeklyDelta:0,activeSlots:["QB","RB","WR"],roster:[]}).block,false);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:{faabPct:12},add:stroud,
  drop:{pos:"WR"},weeklyDelta:0,activeSlots:["QB","SUPER_FLEX","WR"],roster:[qb]}).block,false);
assert.equal(waiverEvidenceGuard({mode:"REDRAFT",action:stash,add:rbAdd,drop:smallRole,
  weeklyDelta:null,activeSlots:["QB","RB"],roster:[qb]}).block,true);
console.log("Waiver evidence guard passed: 25-carry breakout, expensive bench QB, mode and benefit exceptions.");
