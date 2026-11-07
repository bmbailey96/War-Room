import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../gm-audit-ui.js",import.meta.url),"utf8");
const ctx=vm.createContext({Date});
vm.runInContext(source,ctx);
const {renderAudit}=ctx.WarRoomGmAudit;
assert.match(renderAudit(null),/still loading/);
assert.match(renderAudit({error:"Sleeper unavailable"}),/Sleeper unavailable/);

const sample={
  at:Date.parse("2026-11-07T00:00:00Z"),cache:{fresh:false,warning:"Old roster"},
  diagnosis:"Score ranks, not vibes",stance:"Be selective",
  league:{mode:"DYNASTY"},coverage:{completedWeeks:8,missingMatchupWeeks:[],pickLedgerVerified:true},
  me:{standing:2,wins:6,losses:2,pfRank:3,pointsPerGame:150,
    allPlayRank:2,allPlay:{allPlayPct:63,expectedWins:5.2,luckWins:0.8,comparableToRecord:true},
    potentialRank:2,potentialGap:90,
    depth:{total:{QB:2,RB:4,WR:6,TE:4,K:1,DEF:1},active:{QB:2,RB:3,WR:6,TE:3,K:1,DEF:1}},
    needs:[{pos:"RB",level:"thin"}],
    picks:[{season:2027,round:1,originalTeam:"Other Team",traded:true}]},
  teams:[
    {isMe:true,name:"My <script>alert(1)</script>",wins:6,losses:2,pointsFor:1199,pfRank:3,allPlay:{allPlayPct:63},tradeCount:2},
    {isMe:false,name:"Partner",wins:7,losses:1,pointsFor:1270,pfRank:1,allPlay:{allPlayPct:66},tradeCount:1}
  ],
  tradePartners:[{name:"Partner",offerPositions:["TE"],targetPositions:["RB"],completedTradesThisSeason:1,
    targetExamples:[{name:"Veteran WR",pos:"WR",recentAvg:20.5,observedWeeks:3}]}],
  tradeSimulations:[{partner:"Partner",send:[{name:"Tucker Kraft"}],get:{name:"Veteran WR"},
    myWeeklyModelDelta:2,theirWeeklyModelDelta:0.6,dynastyModelValueDelta:1,caveat:"Simulated, not guaranteed"}],
  freeAgents:{verified:true,checkedAt:Date.parse("2026-11-07T00:00:00Z"),
    candidates:[{name:"New Guy",pos:"RB",transactionType:"ADD_DROP",drop:"Spare K",potentialWeeklyGain:2,
      context:"Double-check lock"}]},
  limitations:["Don't trust tiny sample"]
};
const html=renderAudit(sample);
assert.match(html,/WHO IS REALLY SCORING/);
assert.match(html,/VERIFIED UNROSTERED/);
assert.match(html,/MODELLED TRADE PACKAGES/);
assert.match(html,/Tucker Kraft/);
assert.match(html,/Other Team/);
assert.match(html,/STALE DATA/);
assert.match(html,/My &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(html,/<script>/);
assert.doesNotMatch(html,/undefined/);
const noMarket=renderAudit({...sample,freeAgents:{verified:false,reason:"No fresh data",candidates:[]},tradeSimulations:[]});
assert.match(noMarket,/No fresh roster-action scan/);
assert.doesNotMatch(noMarket,/New Guy|Tucker Kraft/);
console.log("GM audit UI checks passed: mobile data, trade disclaimers, stale scans and escaped owner names.");