import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const content=fs.readFileSync(new URL("../gm-review-ui.js",import.meta.url),"utf8");
const node={innerHTML:"",listeners:{},addEventListener(type,callback){this.listeners[type]=callback}};
const document={getElementById(id){return id==="gm-review"?node:null}};
const ctx=vm.createContext({document,Date,navigator:{clipboard:{writeText:async()=>{}}}});
vm.runInContext(content,ctx);
const ui=ctx.WarRoomGmReviewUI;
const data={
  league:{id:"1234",name:"The Ocho",mode:"DYNASTY"},at:12345,
  me:{name:"Mine",depth:{players:[]}},teams:[],
  tradeInventory:{teams:[
    {isMe:true,name:"Mine",rosterId:1,players:[{id:"1",name:"Player A",pos:"RB",recentMean:10,marketValue:23}],
      picks:[{season:2027,round:1,originalTeam:"Mine",marketValue:34}]}
  ]},tradeSimulations:[],tradePartners:[],limitations:["No verified injury report"],
  freeAgents:{verified:false}
};
ui.install();
ui.setData(data);
assert.match(node.innerHTML,/RUN INDEPENDENT REVIEW/);
assert.match(node.innerHTML,/COPY REVIEW PROMPT FOR CHATGPT/);
assert.equal(typeof node.listeners.click,"function");
const text=ui.makeResearchPrompt(data);
assert.match(text,/Player A/);
assert.match(text,/No verified injury report/);
assert.match(text,/current.*league/i);
assert.doesNotMatch(text,/ANTHROPIC_API_KEY|WARROOM_GM_OWNER_CODE/);
ui.setData(null);
assert.match(node.innerHTML,/Load a current league GM Audit/);
assert.throws(()=>ui.makeResearchPrompt(null),/Current league audit/);
console.log("Independent GM review UI checks passed: copy prompt, safe no-key state and league reset.");