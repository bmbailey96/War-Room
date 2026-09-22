// Weekly learning for the focused v2 lineup engine.
// Grades the last pre-kickoff projection saved for each player against the
// points Sleeper actually credited in that league, then learns how much to
// trust workload, matchup and game-environment signals separately.
//
// It also grades the live-news reasoning layer by driver. This is not model
// fine-tuning. It is an explicit, inspectable feedback loop stored per league.

import { store, MY_USER_ID, normName, getPlayersTrim } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { fantasyPoints } from "./lineup.mjs";
import { getDynastyMarket } from "./lib/market-v2.mjs";

const DEFAULT = { role:0.28, matchup:0.25, environment:0.35, scheme:0.22 };
const MICRO_KEYS=["coverage","teCoverage","rbSplit","passRush","personnel","routeProfile","vacated"];
const DRIVER_KEYS = ["injury","role","depth_chart","scheme","weather","matchup","projection_only","other"];

async function j(url) {
  try { const r=await fetch(url); return r.ok ? r.json() : null; }
  catch(e){ return null; }
}
function standardProjection(s,w){
  let p=s.base;
  p*=1+w.role*((s.signals?.roleRatio||1)-1);
  p*=1+w.matchup*((s.signals?.matchupRatio||1)-1);
  p*=1+w.environment*((s.signals?.environmentRatio||1)-1);
  p*=1+w.scheme*((s.signals?.schemeRatio||1)-1);
  return p;
}
const mae=(samples,w)=> {
  if(!samples.length) return null;
  let total=0;
  for(const s of samples) total+=Math.abs(standardProjection(s,w)-s.actual);
  return total/samples.length;
};
const round2=x=>Math.round(x*100)/100;

function fitPositionScales(samples){
  const scales={}, detail={};
  for(const pos of ["QB","RB","WR","TE"]){
    const rows=samples.filter(s=>s.slot===pos && (s.rawBase??s.base)>0);
    if(rows.length<4){
      scales[pos]=1; detail[pos]={n:rows.length,raw:1,scale:1};
      continue;
    }
    const err=scale=>rows.reduce((sum,s)=>{
      const b=s.rawBase??s.base;
      return sum+Math.abs(b*scale-s.actual);
    },0)/rows.length;
    let raw=1,best=err(1);
    for(let x=.75;x<=1.2501;x+=.01){
      const e=err(x);
      if(e<best){best=e;raw=round2(x);}
    }
    const alpha=Math.min(.65,rows.length/30);
    const scale=round2(1+(raw-1)*alpha);
    scales[pos]=scale;
    detail[pos]={n:rows.length,raw,scale,alpha:round2(alpha)};
  }
  return {scales,detail};
}

function fit(samples) {
  let best={...DEFAULT}, bestErr=mae(samples,DEFAULT) ?? Infinity;
  // Bounded grid. Negative weights are deliberately disallowed. If a signal
  // proves useless it can fall to zero rather than learning nonsense from a
  // tiny sample and inverting the football meaning of the feature.
  for(let role=0;role<=0.6001;role+=0.05){
    for(let matchup=0;matchup<=0.6001;matchup+=0.05){
      for(let environment=0;environment<=0.7001;environment+=0.05){
        for(let scheme=0;scheme<=0.5001;scheme+=0.10){
          const w={role:round2(role),matchup:round2(matchup),environment:round2(environment),scheme:round2(scheme)};
          const err=mae(samples,w);
          if(err<bestErr){best=w;bestErr=err;}
        }
      }
    }
  }
  // Do not let one week yank the engine around. At 20 samples only 25% of
  // the fitted move is admitted; trust grows toward 75% after ~60 samples.
  const alpha=Math.min(0.75, samples.length/80);
  const weights={};
  for(const k of Object.keys(DEFAULT)) weights[k]=round2(DEFAULT[k]*(1-alpha)+best[k]*alpha);
  return {weights,rawFit:best,alpha:round2(alpha),mae:round2(mae(samples,weights)),defaultMae:round2(mae(samples,DEFAULT))};
}

function microEdge(s,key){
  const signals=s.signals||{};
  const usable=o=>o && o.applied!==false && Number.isFinite(Number(o.edgePct));
  if(key==="coverage") return usable(signals.coverageMatchup)?Number(signals.coverageMatchup.edgePct)/100:null;
  if(key==="teCoverage") return usable(signals.teCoverage)?Number(signals.teCoverage.edgePct)/100:null;
  if(key==="rbSplit") return usable(signals.rbMatchup)?Number(signals.rbMatchup.edgePct)/100:null;
  if(key==="passRush") return usable(signals.passRush)?Number(signals.passRush.edgePct)/100:null;
  if(key==="routeProfile") return usable(signals.routeProfile)?Number(signals.routeProfile.edgePct)/100:null;
  if(key==="vacated") return usable(signals.vacatedOpportunity)?Number(signals.vacatedOpportunity.edgePct)/100:null;
  if(key==="personnel"){
    const parts=[signals.frontSeven,signals.runBlocking,signals.protection]
      .filter(usable)
      .map(x=>Number(x.edgePct)/100);
    return parts.length?parts.reduce((a,b)=>a+b,0):null;
  }
  return null;
}

function microReliability(samples,key,standardWeights){
  let n=0,hit=0;
  for(const s of samples){
    const edge=microEdge(s,key);
    if(edge==null || Math.abs(edge)<.004)continue;
    const residual=s.actual-standardProjection(s,standardWeights);
    if(Math.abs(residual)<.75)continue;
    n++;
    if((edge>0&&residual>0)||(edge<0&&residual<0))hit++;
  }
  return {n,hit,hitRate:n?round2(hit/n):null};
}

function microWeightFromStat(stat){
  if(!stat || stat.n<6 || stat.hitRate==null)return 1;
  const raw=Math.max(.55,Math.min(1.25,1+(stat.hitRate-.5)*1.8));
  const alpha=Math.min(.7,stat.n/40);
  return round2(1+(raw-1)*alpha);
}

function fitMicroWeights(samples,standardWeights){
  const reliability={},weights={};
  for(const key of MICRO_KEYS){
    const stat=microReliability(samples,key,standardWeights);
    reliability[key]=stat;
    weights[key]=microWeightFromStat(stat);
  }
  return {weights,reliability};
}

function signalReliability(samples,key){
  let n=0, hit=0;
  const ratioKey={role:"roleRatio",matchup:"matchupRatio",environment:"environmentRatio",scheme:"schemeRatio"}[key];
  for(const s of samples){
    const ratio=s.signals?.[ratioKey] ?? 1;
    if(Math.abs(ratio-1)<0.03) continue;
    const residual=s.actual-s.base;
    if(Math.abs(residual)<1) continue;
    n++;
    if((ratio>1 && residual>0)||(ratio<1 && residual<0)) hit++;
  }
  return {n,hit,hitRate:n?round2(hit/n):null};
}

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const rosterGradeKey=(historyAt,index,horizon)=>`${historyAt}|${index}|${horizon}`;

export function rosterOutcomeScore({
  mode="REDRAFT",horizon=1,
  addPoints=0,dropPoints=0,addReplacement=0,dropReplacement=0,
  initialAddMarket=null,initialDropMarket=null,currentAddMarket=null,currentDropMarket=null
}={}){
  const h=Math.max(1,Number(horizon||1));
  const addVor=Number(addPoints||0)-Number(addReplacement||0)*h;
  const dropVor=Number(dropPoints||0)-Number(dropReplacement||0)*h;
  const productionEdge=addVor-dropVor;
  const productionNorm=clamp(productionEdge/(3*h),-1,1);

  let marketEdgeChange=null,marketNorm=0;
  if(
    mode==="DYNASTY" &&
    [initialAddMarket,initialDropMarket,currentAddMarket,currentDropMarket]
      .every(v=>Number.isFinite(Number(v)))
  ){
    const initialEdge=Number(initialAddMarket)-Number(initialDropMarket);
    const currentEdge=Number(currentAddMarket)-Number(currentDropMarket);
    marketEdgeChange=currentEdge-initialEdge;
    marketNorm=clamp(marketEdgeChange/12,-1,1);
  }

  const bothReplaceable=addVor<=1*h&&dropVor<=1*h;
  const tinyDifference=Math.abs(productionEdge)<1*h&&(marketEdgeChange==null||Math.abs(marketEdgeChange)<3);
  const churnPenalty=bothReplaceable&&tinyDifference?.22:0;
  const raw=mode==="DYNASTY"&&marketEdgeChange!=null
    ? productionNorm*.55+marketNorm*.45-churnPenalty
    : productionNorm-churnPenalty;
  const score=Math.round(clamp(raw,-1,1)*100)/100;
  return {
    score,hit:score>.10,
    productionEdge:Math.round(productionEdge*10)/10,
    addVor:Math.round(addVor*10)/10,dropVor:Math.round(dropVor*10)/10,
    marketEdgeChange:marketEdgeChange==null?null:Math.round(marketEdgeChange*10)/10,
    unnecessaryChurn:bothReplaceable&&tinyDifference
  };
}

export function aggregateRosterLearning(grades=[]){
  const byDecision=new Map();
  for(const g of grades||[]){
    if(!g?.decisionId||!Number.isFinite(Number(g.score)))continue;
    const x=byDecision.get(g.decisionId)||{};
    x[g.horizon]=g;
    byDecision.set(g.decisionId,x);
  }

  const decisions=[];
  for(const [decisionId,x] of byDecision){
    const primary=x[3]||x[1]||x[6];
    if(!primary)continue;
    let score=Number(primary.score);
    if(x[3]&&x[6])score=Number(x[3].score)*.65+Number(x[6].score)*.35;
    else if(!x[3]&&x[1])score*=.6;
    const tags=[...new Set(primary.archetypes||["GENERAL"])];
    decisions.push({decisionId,score,hit:score>.10,tags,horizons:Object.keys(x).map(Number)});
  }

  const archetypes={};
  for(const d of decisions){
    for(const tag of d.tags){
      const a=archetypes[tag]||(archetypes[tag]={n:0,hits:0,sumScore:0});
      a.n++;a.sumScore+=d.score;if(d.hit)a.hits++;
    }
  }
  for(const a of Object.values(archetypes)){
    a.hitRate=a.n?Math.round(a.hits/a.n*100)/100:null;
    a.avgScore=a.n?Math.round(a.sumScore/a.n*100)/100:0;
    delete a.sumScore;
  }
  return {samples:decisions.length,archetypes,decisions};
}

function playerIndex(db={}){
  const out={};
  for(const [pid,p] of Object.entries(db||{})){
    const key=normName(p?.n||"");
    if(key&&!out[key])out[key]=pid;
  }
  return out;
}
function actualPoints(name,pos,weeks,statsByWeek,idByName,scoring){
  const pid=idByName[normName(name||"")];
  if(!pid)return 0;
  return (weeks||[]).reduce((sum,w)=>{
    const stats=statsByWeek[w]?.[pid];
    return sum+(stats?Number(fantasyPoints(stats,scoring||{},pos)||0):0);
  },0);
}
function currentMarketValue(name,market){
  const v=market?.players?.[normName(name||"")]?.value;
  return Number.isFinite(Number(v))?Number(v):null;
}
function currentAssetValue(asset,market){
  if(!asset)return null;
  if(asset.type!=="pick")return currentMarketValue(asset.name,market);
  const m=String(asset.name||"").match(/(20\d\d)\s+(\d)(?:st|nd|rd|th)/i);
  if(!m)return null;
  const v=market?.picks?.[`${Number(m[1])}|${Number(m[2])}`];
  return Number.isFinite(Number(v))?Number(v):null;
}

async function gradeRosterAdvice({
  stateStore,league,currentWeek,season,db,market
}){
  const history=await stateStore.get(`roster_action_history_${league.id}`,{type:"json"}).catch(()=>[])||[];
  const existing=await stateStore.get(`roster_outcome_grades_${league.id}`,{type:"json"}).catch(()=>null)||{grades:{}};
  const grades={...(existing.grades||{})};
  const leagueConfig=await j(`https://api.sleeper.app/v1/league/${league.id}`)||{};
  const scoring=leagueConfig.scoring_settings||{};
  const idByName=playerIndex(db);

  const pending=[];
  const weeksNeeded=new Set();
  for(const h of history){
    for(const [index,a] of (h.actions||[]).entries()){
      const snap=a?.decisionSnapshot;
      if(!snap||!["PICKUP","TRADE"].includes(snap.kind))continue;
      for(const horizon of [1,3,6]){
        if(currentWeek<Number(snap.week||h.week||0)+horizon)continue;
        const key=rosterGradeKey(h.at,index,horizon);
        if(grades[key])continue;
        const start=Number(snap.week||h.week||0);
        const weeks=Array.from({length:horizon},(_,i)=>start+i).filter(w=>w>0&&w<currentWeek);
        if(weeks.length<horizon)continue;
        weeks.forEach(w=>weeksNeeded.add(w));
        pending.push({key,historyAt:h.at,index,action:a,snap,horizon,weeks});
      }
    }
  }

  const statsByWeek={};
  await Promise.all([...weeksNeeded].map(async w=>{
    statsByWeek[w]=await j(`https://api.sleeper.app/v1/stats/nfl/regular/${season}/${w}`)||{};
  }));

  for(const item of pending){
    const {snap,horizon,weeks}=item;
    let addPoints=0,dropPoints=0,initialAddMarket=null,initialDropMarket=null,currentAddMarket=null,currentDropMarket=null;
    let addReplacement=0,dropReplacement=0;

    if(snap.kind==="PICKUP"){
      const add=snap.add||{},drop=snap.drop||{};
      addPoints=actualPoints(add.name,add.pos,weeks,statsByWeek,idByName,scoring);
      dropPoints=actualPoints(drop.name,drop.pos,weeks,statsByWeek,idByName,scoring);
      addReplacement=Number(add.replacement||0);dropReplacement=Number(drop.replacement||0);
      initialAddMarket=add.market;initialDropMarket=drop.market;
      currentAddMarket=currentMarketValue(add.name,market);
      currentDropMarket=currentMarketValue(drop.name,market);
    }else{
      const sendAssets=snap.send||[],receiveAssets=snap.receive||[];
      const sends=sendAssets.filter(x=>x.type==="player");
      const receives=receiveAssets.filter(x=>x.type==="player");
      addPoints=receives.reduce((sum,x)=>sum+actualPoints(x.name,x.pos,weeks,statsByWeek,idByName,scoring),0);
      dropPoints=sends.reduce((sum,x)=>sum+actualPoints(x.name,x.pos,weeks,statsByWeek,idByName,scoring),0);
      const initialAdds=receiveAssets.map(x=>x.initialValue);
      const initialDrops=sendAssets.map(x=>x.initialValue);
      initialAddMarket=initialAdds.length&&initialAdds.every(v=>Number.isFinite(Number(v)))
        ? initialAdds.reduce((sum,v)=>sum+Number(v),0):null;
      initialDropMarket=initialDrops.length&&initialDrops.every(v=>Number.isFinite(Number(v)))
        ? initialDrops.reduce((sum,v)=>sum+Number(v),0):null;
      const curAdd=receiveAssets.map(x=>currentAssetValue(x,market));
      const curDrop=sendAssets.map(x=>currentAssetValue(x,market));
      currentAddMarket=curAdd.length&&curAdd.every(v=>v!=null)?curAdd.reduce((a,b)=>a+b,0):null;
      currentDropMarket=curDrop.length&&curDrop.every(v=>v!=null)?curDrop.reduce((a,b)=>a+b,0):null;
    }

    const outcome=rosterOutcomeScore({
      mode:snap.mode||"REDRAFT",horizon,
      addPoints,dropPoints,addReplacement,dropReplacement,
      initialAddMarket,initialDropMarket,currentAddMarket,currentDropMarket
    });
    const decisionId=`${item.historyAt}|${item.index}`;
    grades[item.key]={
      at:Date.now(),decisionId,horizon,week:snap.week,
      kind:snap.kind,mode:snap.mode,
      archetypes:snap.archetypes||["GENERAL"],
      informationConfidence:snap.informationConfidence||"UNKNOWN",
      addPoints:Math.round(addPoints*10)/10,dropPoints:Math.round(dropPoints*10)/10,
      ...outcome
    };
  }

  const allGrades=Object.values(grades);
  const learned=aggregateRosterLearning(allGrades);
  const model={
    at:Date.now(),leagueId:league.id,season,
    samples:learned.samples,archetypes:learned.archetypes,
    recent:allGrades.sort((a,b)=>Number(b.at||0)-Number(a.at||0)).slice(0,30)
  };
  await stateStore.setJSON(`roster_outcome_grades_${league.id}`,{at:Date.now(),grades});
  await stateStore.setJSON(`roster_learning_${league.id}`,model);
  return model;
}

function addDriverStat(acc,driver,hit){
  const key=DRIVER_KEYS.includes(driver)?driver:"other";
  const v=acc[key]||(acc[key]={n:0,hits:0});
  v.n++; if(hit)v.hits++;
}
function finalizeDrivers(acc){
  const out={};
  for(const k of DRIVER_KEYS){
    const v=acc[k]||{n:0,hits:0};
    out[k]={...v,hitRate:v.n?round2(v.hits/v.n):null};
  }
  return out;
}

export default async () => {
  const stateStore=store();
  const state=await j("https://api.sleeper.app/v1/state/nfl") || {};
  const season=Number(state.season)||new Date().getFullYear();
  const currentWeek=Number(state.week)||1;
  const leagues=await getMyLeagues();
  const db=await getPlayersTrim().catch(()=>({}));
  const dynastyMarket=await getDynastyMarket(stateStore).catch(()=>({players:{},picks:{},scrapeDate:null}));
  const result=[];

  for(const league of leagues){
    const rosters=await j(`https://api.sleeper.app/v1/league/${league.id}/rosters`) || [];
    const mine=rosters.find(r=>r.owner_id===MY_USER_ID);
    if(!mine) continue;

    const samples=[];
    const driverStats={};
    const reasoningGrades=[];

    for(let week=1;week<currentWeek;week++){
      const [log,analysis,matchups]=await Promise.all([
        stateStore.get(`projection_${league.id}_${week}`,{type:"json"}).catch(()=>null),
        stateStore.get(`analysis_${league.id}_${week}`,{type:"json"}).catch(()=>null),
        j(`https://api.sleeper.app/v1/league/${league.id}/matchups/${week}`),
      ]);
      const row=(matchups||[]).find(m=>m.roster_id===mine.roster_id);
      const actualByPid=row?.players_points || {};

      if(log?.players){
        for(const p of Object.values(log.players)){
          const actual=actualByPid[p.pid];
          if(typeof actual!=="number" || typeof p.base!=="number" || p.base<=0) continue;
          if(p.fallback) continue;
          // Injury-flagged samples are deliberately excluded from numerical
          // feature fitting. Injury news is graded in the reasoning layer.
          if(p.injury) continue;
          samples.push({
            week,pid:p.pid,name:p.name,slot:p.slot,
            rawBase:p.rawBase??p.base,base:p.base,actual,
            signals:p.signals||{},
          });
        }
      }

      if(analysis && log?.players){
        const byName={};
        for(const p of Object.values(log.players)) byName[normName(p.name)]=p;

        // Grade the LAST recommendation that existed before either player
        // kicked off. Later Sunday refreshes may know that an early game is
        // over, so grading only analysis.analysis would let hindsight replace
        // the recommendation we actually made when the decision was live.
        const snapshots=Array.isArray(analysis.history) && analysis.history.length
          ? analysis.history
          : (analysis.analysis ? [{at:analysis.at,analysis:analysis.analysis}] : []);
        const latestByPair=new Map();

        for(const snap of snapshots){
          for(const call of snap.analysis?.calls||[]){
            if(!call.start || !call.sit) continue;
            const a=byName[normName(call.start)], b=byName[normName(call.sit)];
            if(!a || !b) continue;
            const kickoffA=a.kickoffAt ? new Date(a.kickoffAt).getTime() : Infinity;
            const kickoffB=b.kickoffAt ? new Date(b.kickoffAt).getTime() : Infinity;
            const deadline=Math.min(kickoffA,kickoffB);
            if(Number.isFinite(deadline) && snap.at>=deadline) continue;
            const key=`${normName(call.start)}|${normName(call.sit)}`;
            const prev=latestByPair.get(key);
            if(!prev || snap.at>prev.at) latestByPair.set(key,{at:snap.at,call,a,b});
          }
        }

        for(const {call,a,b} of latestByPair.values()){
          const aPts=actualByPid[a.pid], bPts=actualByPid[b.pid];
          if(typeof aPts!=="number" || typeof bPts!=="number") continue;
          const hit=aPts>bPts;
          const drivers=Array.isArray(call.drivers)&&call.drivers.length?call.drivers:["other"];
          drivers.forEach(d=>addDriverStat(driverStats,d,hit));
          reasoningGrades.push({
            week,start:call.start,sit:call.sit,startPts:aPts,sitPts:bPts,hit,
            verdict:call.verdict||null,drivers,
          });
        }
      }
    }

    const posFit=fitPositionScales(samples);
    const calibratedSamples=samples.map(s=>({
      ...s,
      base:(s.rawBase??s.base)*(posFit.scales[s.slot]||1),
    }));
    const fitResult=calibratedSamples.length>=8 ? fit(calibratedSamples) : {
      weights:{...DEFAULT},rawFit:null,alpha:0,
      mae:round2(mae(calibratedSamples,DEFAULT)||0),defaultMae:round2(mae(calibratedSamples,DEFAULT)||0),
    };
    const microFit=fitMicroWeights(calibratedSamples,fitResult.weights);
    const model={
      at:Date.now(),leagueId:league.id,season,samples:samples.length,
      weeks:[...new Set(samples.map(s=>s.week))],
      positionScale:posFit.scales,positionDetail:posFit.detail,
      weights:fitResult.weights,rawFit:fitResult.rawFit,shrinkage:fitResult.alpha,
      microWeights:microFit.weights,microReliability:microFit.reliability,
      mae:fitResult.mae,defaultMae:fitResult.defaultMae,
      reliability:{
        role:signalReliability(calibratedSamples,"role"),
        matchup:signalReliability(calibratedSamples,"matchup"),
        environment:signalReliability(calibratedSamples,"environment"),
        scheme:signalReliability(calibratedSamples,"scheme"),
      },
    };
    await stateStore.setJSON(`model_${league.id}`,model);

    const reasoning={
      at:Date.now(),leagueId:league.id,season,totalCalls:reasoningGrades.length,
      drivers:finalizeDrivers(driverStats),
      recent:reasoningGrades.slice(-20),
    };
    await stateStore.setJSON(`reasoning_${league.id}`,reasoning);

    let rosterLearning=null,rosterLearningError=null;
    try{
      rosterLearning=await gradeRosterAdvice({
        stateStore,league,currentWeek,season:league.season||season,db,market:dynastyMarket
      });
    }catch(e){
      rosterLearningError=e.message;
    }

    result.push({
      league:league.name,id:league.id,samples:samples.length,
      weights:model.weights,microWeights:model.microWeights,positionScale:model.positionScale,mae:model.mae,defaultMae:model.defaultMae,
      reasoningCalls:reasoningGrades.length,
      rosterLearning:rosterLearning?{
        samples:rosterLearning.samples,
        archetypes:rosterLearning.archetypes
      }:null,
      rosterLearningError
    });
  }

  return new Response(JSON.stringify({ok:true,season,currentWeek,leagues:result},null,2),{
    headers:{"content-type":"application/json"}
  });
};

export const config={schedule:"0 15 * * 2"};


export {
  standardProjection,microEdge,microReliability,microWeightFromStat,fitMicroWeights,
  rosterGradeKey
};
