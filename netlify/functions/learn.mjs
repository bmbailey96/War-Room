// Weekly learning for the focused v2 lineup engine.
// Grades the last pre-kickoff projection saved for each player against the
// points Sleeper actually credited in that league, then learns how much to
// trust workload, matchup and game-environment signals separately.
//
// It also grades the live-news reasoning layer by driver. This is not model
// fine-tuning. It is an explicit, inspectable feedback loop stored per league.

import { store, MY_USER_ID, normName } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";

const DEFAULT = { role:0.28, matchup:0.25, environment:0.35 };
const DRIVER_KEYS = ["injury","role","depth_chart","scheme","weather","matchup","projection_only","other"];

async function j(url) {
  try { const r=await fetch(url); return r.ok ? r.json() : null; }
  catch(e){ return null; }
}
const mae=(samples,w)=> {
  if(!samples.length) return null;
  let total=0;
  for(const s of samples){
    let p=s.base;
    p*=1+w.role*((s.signals?.roleRatio||1)-1);
    p*=1+w.matchup*((s.signals?.matchupRatio||1)-1);
    p*=1+w.environment*((s.signals?.environmentRatio||1)-1);
    total+=Math.abs(p-s.actual);
  }
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
        const w={role:round2(role),matchup:round2(matchup),environment:round2(environment)};
        const err=mae(samples,w);
        if(err<bestErr){best=w;bestErr=err;}
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

function signalReliability(samples,key){
  let n=0, hit=0;
  const ratioKey={role:"roleRatio",matchup:"matchupRatio",environment:"environmentRatio"}[key];
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

      if(analysis?.analysis?.calls?.length && log?.players){
        const byName={};
        for(const p of Object.values(log.players)) byName[normName(p.name)]=p;
        for(const call of analysis.analysis.calls){
          if(!call.start || !call.sit) continue;
          const a=byName[normName(call.start)], b=byName[normName(call.sit)];
          if(!a || !b) continue;
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
    const model={
      at:Date.now(),leagueId:league.id,season,samples:samples.length,
      weeks:[...new Set(samples.map(s=>s.week))],
      positionScale:posFit.scales,positionDetail:posFit.detail,
      weights:fitResult.weights,rawFit:fitResult.rawFit,shrinkage:fitResult.alpha,
      mae:fitResult.mae,defaultMae:fitResult.defaultMae,
      reliability:{
        role:signalReliability(calibratedSamples,"role"),
        matchup:signalReliability(calibratedSamples,"matchup"),
        environment:signalReliability(calibratedSamples,"environment"),
      },
    };
    await stateStore.setJSON(`model_${league.id}`,model);

    const reasoning={
      at:Date.now(),leagueId:league.id,season,totalCalls:reasoningGrades.length,
      drivers:finalizeDrivers(driverStats),
      recent:reasoningGrades.slice(-20),
    };
    await stateStore.setJSON(`reasoning_${league.id}`,reasoning);

    result.push({
      league:league.name,id:league.id,samples:samples.length,
      weights:model.weights,positionScale:model.positionScale,mae:model.mae,defaultMae:model.defaultMae,
      reasoningCalls:reasoningGrades.length,
    });
  }

  return new Response(JSON.stringify({ok:true,season,currentWeek,leagues:result},null,2),{
    headers:{"content-type":"application/json"}
  });
};

export const config={schedule:"0 15 * * 2"};
