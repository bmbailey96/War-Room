import assert from "node:assert/strict";
import {buildReviewRequest,makePrompt,validateReview} from "../netlify/functions/lib/gm-review-core.mjs";
import reviewEndpoint from "../netlify/functions/gm-review.mjs";
const data={
  at:Date.now(),league:{id:"1386018360738713600",name:"The Ocho",week:9,mode:"DYNASTY",teamCount:8,playoffTeams:6},
  me:{name:"My Team",wins:4,losses:4,standing:5,pfRank:4,potentialRank:2,
    allPlay:{allPlayPct:52,comparableToRecord:true},
    depth:{active:{QB:1,RB:3,WR:7,TE:4},players:[{id:"8",name:"Ja'Marr Chase",pos:"WR",age:26}]},
    needs:[],picks:[{season:2027,round:1,originalTeam:"Mine"}]},
  teams:[{isMe:true,name:"Me"},{isMe:false,name:"Partner",standing:2,pfRank:2,
    allPlay:{allPlayPct:60},needs:[],availableDepth:{RB:5},tradeCount:2}],
  coverage:{pickLedgerVerified:true,completeHistory:true},
  validation:{verdict:"INSUFFICIENT_BASELINE_COMPARISON",overall:{modelMae:10},evaluatedSamples:13},
  freeAgents:{verified:true,candidates:[{name:"Free RB",pos:"RB",drop:"Spare K",potentialWeeklyGain:1.5}]},
  tradeSimulations:[{partner:"Partner",send:[{name:"Tucker Kraft"}],get:{name:"Partner RB"},
    myWeeklyModelDelta:2,theirWeeklyModelDelta:-1,dynastyModelValueDelta:4}],
  tradeInventory:{at:Date.now(),teams:[{isMe:true,rosterId:4}]},
  limitations:["We have no independently verified injury reporting."],
  diagnosis:"Roster quality is reasonable",
};
const packet=buildReviewRequest(data);
assert.equal(packet.choices.length,3);
assert.deepEqual(packet.choices.map(x=>x.id),["HOLD","WAIVER:0","TRADE:0"]);
assert.match(makePrompt(packet),/Do NOT echo/);
assert.match(makePrompt(packet),/NO web search/);
const ai=validateReview(JSON.stringify({
  stance:"FRINGE",summary:"RB depth needs insurance",
  choiceId:"WAIVER:0",reason:"Spare kicker is not useful",
  countercase:"Maybe there is no meaningful gain",
  whatToVerify:"Confirm ownership and injury status",
  evidenceKeys:["pointsFor","positionalDepth","invented_field"]
}),packet);
assert.equal(ai.choiceId,"WAIVER:0");
assert.match(ai.title,/Free RB/);
assert.equal(ai.evidence.length,2);
assert.equal(ai.choiceType,"WAIVER");
assert.match(ai.disclaimer,/No official player news/);
assert.throws(()=>validateReview('{"choiceId":"WAIVER:12"}',packet),/not in the verified/);
assert.throws(()=>validateReview('Definitely buy player',packet),/valid JSON/);
assert.throws(()=>buildReviewRequest({}),/Complete GM audit/);
assert.throws(()=>buildReviewRequest({...data,cache:{fresh:false}}),/Stale audit/);

const r=await reviewEndpoint(new Request("https://example.netlify.app/.netlify/functions/gm-review",{method:"GET"}));
assert.equal(r.status,405);
const oldKey=process.env.WARROOM_GM_OWNER_CODE;
const oldProvider=process.env.ANTHROPIC_API_KEY;
delete process.env.WARROOM_GM_OWNER_CODE;
delete process.env.ANTHROPIC_API_KEY;
const disabled=await reviewEndpoint(new Request("https://example.netlify.app/.netlify/functions/gm-review",{
 method:"POST",body:JSON.stringify({leagueId:data.league.id,accessCode:"abcdefgh"})
}));
assert.equal(disabled.status,503);
assert.match((await disabled.json()).error,/disabled/);
if(oldKey!=null)process.env.WARROOM_GM_OWNER_CODE=oldKey;
if(oldProvider!=null)process.env.ANTHROPIC_API_KEY=oldProvider;
console.log("Owner-gated AI GM tests passed: whitelist, evidence, invalid output, off-by-default provider and no paid auto-call.");
