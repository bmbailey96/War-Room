import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual shipped page script with controlled network timing.
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/load\(false\);\s*$/, '');
const nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',style:{},className:'',disabled:false});return nodes.get(id)};
let requests=[],timers=new Map(),timerId=0;
const document={hidden:false,getElementById:node,addEventListener(){},createElement(){return {textContent:'',get innerHTML(){return this.textContent.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')}}}};
const ctx=vm.createContext({document,AbortController,Date,URL,console,
  fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId},clearTimeout:id=>timers.delete(id)});
vm.runInContext(script,ctx);
const run=code=>vm.runInContext(code,ctx);
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
const respond=async(req,data,status=200)=>{req.resolve({ok:status>=200&&status<300,status,json:async()=>data});await tick()};
const base=id=>({league:{id,name:id},leagues:[{id:'A',name:'A'},{id:'B',name:'B'}],week:8,opponent:'Opponent',matchup:{winProbability:0},calls:[],actionableCalls:[],optimal:[],players:[],model:{}});

run(`base={actionableCalls:[{start:{name:'Stale starter'},sit:{name:'Bench'},edge:3}],flexMoves:[{moveToFlex:'Stale flex',flexSlot:'FLEX'}]};liveState={phase:'LIVE',actionableCalls:[],flexMoves:[],mine:{optimal:[]}};renderActionQueue()`);
assert.doesNotMatch(node('actionqueue').innerHTML,/Stale starter|Stale flex/);
assert.match(node('actionqueue').innerHTML,/Hold current lineup/);
run(`renderLive({phase:'LIVE',at:'2026-10-28T12:00:00Z',winProbability:0,actionableCalls:[],mine:{optimal:[]},expected:{}})`);
assert.match(node('opponent').textContent,/Win chance 0%/);
assert.equal(node('headline').textContent,'Hold your remaining lineup.');
run(`renderAnalysis({analysis:{summary:'Stale override',calls:[{start:'Stale starter',verdict:'OVERRIDE'}],watch:['Check injury']}})`);
assert.equal(node('headline').textContent,'Hold your remaining lineup.');
assert.doesNotMatch(node('calls').innerHTML,/Stale starter/);
assert.doesNotMatch(node('actionqueue').innerHTML,/Stale starter/);
run(`renderMoves({error:'Network failure'})`);
assert.match(node('moves').innerHTML,/scan unavailable/);
assert.doesNotMatch(node('moves').innerHTML,/No urgent roster move/);

// Old lineup response arriving after the newly selected league must do nothing.
run(`league='A';load()`);const old=requests.shift();
run(`league='B';load()`);const fresh=requests.shift();
assert.equal(old.options.signal.aborted,true);
await respond(fresh,base('B'));
const children=requests.splice(0);
await respond(old,base('A'));
assert.equal(run('league'),'B');assert.match(node('week').innerHTML,/>B</);
assert.match(node('opponent').textContent,/Win chance 0%/);
assert.equal(requests.length,0,'stale load must not launch child requests');

// Old news/roster responses and previously queued polls cannot leak into A.
run(`league='A';load()`);const next=requests.shift();
await respond(children.find(r=>r.url.includes('lineup-analysis')),{analysis:{summary:'B news',watch:['B watch']}});
await respond(children.find(r=>r.url.includes('roster-actions')),{status:'building'});
assert.doesNotMatch(node('headline').textContent,/B news/);
assert.equal(timers.size,0,'old roster response must not schedule polling');
await respond(next,base('A'));requests=[];
const pendingLive=[...timers.values()][0];
run(`league='B';load()`);const fail=requests.shift();
pendingLive.fn();assert.equal(requests.length,0,'stale live timer must not fetch');
await respond(fail,{error:'Sleeper unavailable'},502);
assert.match(node('board-status').textContent,/Connection failed/);
assert.equal(node('current').textContent,'—');
assert.equal(node('refresh').disabled,false);
assert.equal(run('base'),null);
assert.doesNotMatch(node('lineup').innerHTML,/<table/);

// Live in-flight response cannot overwrite a newly loaded league or its busy flag.
run(`league='A';load()`);await respond(requests.shift(),base('A'));requests=[];
const livePromise=run('loadLive()');const liveReq=requests.shift();
run(`league='B';load()`);const newReq=requests.shift();
await respond(liveReq,{phase:'LIVE',at:Date.now(),actionableCalls:[{start:{name:'Old live call'}}],mine:{optimal:[]}});
await livePromise;
assert.doesNotMatch(node('headline').textContent,/Old live call/);
await respond(newReq,base('B'));
console.log('UI checks passed: stale league responses, canceled polls, live authority, zero odds, and honest error states.');

run(`liveState=null;analysisState=null;base={optimal:[{player:{pid:'1',name:'Recommended starter'}}]};renderMoves({reasoningAvailable:false,actions:[{type:'ADD_DROP',stash:true,headline:'Stash a tight end',drop:{pid:'1',name:'Recommended starter'},add:{name:'Bench TE'}}]})`);
assert.match(node('moves').innerHTML,/LINEUP CONFLICT/);
assert.match(node('moves').innerHTML,/REVIEW FIRST/);
assert.doesNotMatch(node('actionqueue').innerHTML,/Stash a tight end/);
run(`renderLive({phase:'LIVE',at:Date.now(),actionableCalls:[],mine:{optimal:[{player:{name:'Other player'}}]},expected:{}})`);
assert.doesNotMatch(node('moves').innerHTML,/LINEUP CONFLICT/);
assert.match(node('actionqueue').innerHTML,/Stash a tight end/);
console.log('Roster/lineup conflict checks passed.');

run(`liveState=null;renderAnalysis({reasoningMode:'public_news',reasoningAvailable:false,analysis:{summary:'Keep the lineup',calls:[],watch:['Watch injury status']},news:{available:true,checkedAt:Date.now(),sources:[{name:'CBS',ok:true}],items:[{title:'Player <script> news',url:'https://example.com/story',source:'CBS',publishedAt:Date.now(),players:['Player One']},{title:'Unsafe link',url:'javascript:alert(1)',players:[]}]}})`);
assert.equal(node('brain').textContent,'PUBLIC NEWS ON');
assert.match(node('watch').innerHTML,/https:\/\/example.com\/story/);
assert.match(node('watch').innerHTML,/&lt;script&gt;/);
assert.doesNotMatch(node('watch').innerHTML,/javascript:|interpretation is offline/);
assert.match(node('watch').innerHTML,/Watch injury status/);
run(`renderAnalysis({reasoningMode:'public_news',reasoningAvailable:false,analysis:{calls:[],watch:[]},news:{available:false,checkedAt:Date.now(),sources:[{name:'CBS',ok:false}],items:[]}})`);
assert.equal(node('brain').textContent,'NEWS FEEDS UNAVAILABLE');
assert.match(node('watch').innerHTML,/No current reports available/);
console.log('Public-news display and unsafe-link checks passed.');
