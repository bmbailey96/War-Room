// Lightweight Sunday live-state engine.
// Uses the heavy model's pregame blueprint + current Sleeper matchup scoring.
// No nflverse downloads, no Anthropic calls.

import { store } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import {
  optimize,lineupChanges,probabilityBetter,normalCdf,
  classifyLineupCall,confidenceGrade,buildStrategicTiebreaks,lateSwapFlexMoves
} from "./lineup.mjs";

const round=x=>Math.round(Number(x||0)*10)/10;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
async function j(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok)throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export function liveProgress(kickoffAt,nowMs=Date.now()){
  if(!kickoffAt)return 0;
  const ko=new Date(kickoffAt).getTime();
  if(!Number.isFinite(ko)||nowMs<=ko)return 0;
  // We intentionally use a broad four-hour envelope. It is a proxy for game
  // progress, not a claim about the actual clock.
  return clamp((nowMs-ko)/(4*60*60*1000),0,1);
}

export function liveExpectedFinal({projection=0,actual=0,progress=0,slot="UNK"}={}){
  const pre=Number(projection||0),act=Number(actual||0),p=clamp(Number(progress||0),0,1);
  if(p<=0)return round(pre);
  if(p>=.985)return round(act);

  // Compare actual production to expected production-to-date, then only
  // partially trust the surprise. Scoring is lumpy, especially K/DST.
  const expectedSoFar=pre*p;
  const surprise=act-expectedSoFar;
  const confidence=.34+.36*p;
  const lumpiness=["K","DEF"].includes(slot)?.62:1;
  return round(pre+surprise*confidence*lumpiness);
}

function updatePlayers(players,match,nowMs){
  const points=match?.players_points||{};
  return (players||[]).map(p=>{
    const progress=liveProgress(p.kickoffAt,nowMs);
    const locked=progress>0;
    const liveActual=typeof points[p.pid]==="number"?Number(points[p.pid]):0;
    const expected=liveExpectedFinal({
      projection:p.projection,actual:liveActual,progress,slot:p.slot
    });
    const sigma=Math.max(.35,Number(p.sigma||Math.max(1,Number(p.projection||0)*.5))*Math.sqrt(Math.max(.03,1-progress)));
    const floor=round(expected-.84*sigma),ceiling=round(expected+.84*sigma);
    return {
      ...p,
      locked,
      complete:progress>=.985,
      progress:round(progress*100),
      liveActual:round(liveActual),
      pregameProjection:p.projection,
      projection:expected,
      // optimize() uses actual for locked players. Feed expected final there,
      // while preserving the scoreboard number separately as liveActual.
      actual:locked?expected:null,
      sigma:round(sigma),floor,ceiling,
    };
  });
}

function currentStarters(match,players,slots){
  const byId=Object.fromEntries((players||[]).map(p=>[p.pid,p]));
  return (match?.starters||[]).map((pid,i)=>({slot:slots[i]||"?",player:byId[pid]||null}));
}
function value(p){return p?.locked?(p.actual??0):(p?.projection??0)}
function total(rows){return round((rows||[]).reduce((s,x)=>s+value(x.player),0))}
function actualTotal(rows){return round((rows||[]).reduce((s,x)=>s+Number(x.player?.liveActual||0),0))}
function sigmaTotal(rows){
  return Math.sqrt((rows||[]).reduce((s,x)=>{
    const p=x.player;if(!p||p.complete)return s;
    const sig=Number(p.sigma||0);return s+sig*sig;
  },0));
}
function matchupProbability(my,opp){
  const margin=Number(my.expected||0)-Number(opp.expected||0);
  const sigma=Math.sqrt(Number(my.sigma||0)**2+Number(opp.sigma||0)**2);
  if(!sigma)return margin>0?.97:margin<0?.03:.5;
  return clamp(normalCdf(margin/sigma),.03,.97);
}
function callRows(current,optimal,players,posture){
  const decision=lineupChanges(current,optimal);
  const changes=(decision.calls||[]).map(call=>{
    const probability=call.sit?probabilityBetter(call.start,call.sit):null;
    const edge=call.sit&&call.start?.projection!=null&&call.sit?.projection!=null
      ? round(call.start.projection-call.sit.projection):null;
    const beatProbability=probability==null?null:Math.round(probability*100);
    const decisionScore=beatProbability??call.start?.confidenceScore??50;
    const action=classifyLineupCall({...call,edge,beatProbability});
    return {
      ...call,edge,beatProbability,decisionScore,
      decisionConfidence:confidenceGrade(decisionScore),
      actionable:action.actionable,callStrength:action.strength,
      actionReason:action.reason,live:true,
    };
  });
  const strategic=buildStrategicTiebreaks(optimal.picked,players,posture).map(x=>({...x,live:true}));
  return {
    calls:[...changes,...strategic],
    actionableCalls:changes.filter(x=>x.actionable),
    leans:[...changes.filter(x=>!x.actionable),...strategic],
  };
}

function surprises(myCurrent,oppCurrent){
  const rows=[];
  const add=(side,row)=>{
    const p=row.player;
    if(!p||!p.locked||p.complete||p.progress<10)return;
    const pre=Number(p.pregameProjection||0),progress=Number(p.progress||0)/100;
    const expectedToDate=pre*progress;
    const surprise=Number(p.liveActual||0)-expectedToDate;
    if(Math.abs(surprise)<3)return;
    rows.push({
      side,name:p.name,slot:p.slot,surprise:round(surprise),
      actual:p.liveActual,expectedToDate:round(expectedToDate),
      progress:p.progress,
      label:surprise>=0?"AHEAD OF PACE":"BEHIND PACE",
    });
  };
  myCurrent.forEach(x=>add("ME",x));
  oppCurrent.forEach(x=>add("OPP",x));
  return rows.sort((a,b)=>Math.abs(b.surprise)-Math.abs(a.surprise)).slice(0,5);
}

export default async req=>{
  try{
    const url=new URL(req.url),requested=url.searchParams.get("league");
    const leagues=await getMyLeagues();
    const chosen=leagues.find(l=>l.id===requested)||leagues[0];
    if(!chosen)return new Response(JSON.stringify({error:"no league"}),{status:404});

    const nfl=await j("https://api.sleeper.app/v1/state/nfl");
    const week=Number(nfl.week)||1;
    const s=store();
    const key=`live_blueprint_${chosen.id}_${week}`;
    const blueprint=await s.get(key,{type:"json"}).catch(()=>null);
    if(!blueprint){
      return new Response(JSON.stringify({
        error:"live blueprint missing",rebuildRequired:true,league:{id:chosen.id,name:chosen.name},week
      }),{status:409,headers:{"content-type":"application/json","cache-control":"no-store"}});
    }

    const matchups=await j(`https://api.sleeper.app/v1/league/${chosen.id}/matchups/${week}`);
    const myMatch=matchups.find(m=>m.roster_id===blueprint.myRosterId);
    const oppMatch=matchups.find(m=>m.roster_id===blueprint.opponentRosterId);
    if(!myMatch)throw new Error("live matchup missing");

    const now=Date.now();
    const myPlayers=updatePlayers(blueprint.myPlayers,myMatch,now);
    const oppPlayers=updatePlayers(blueprint.opponentPlayers,oppMatch,now);
    const slots=blueprint.slots||[];

    const myCurrent=currentStarters(myMatch,myPlayers,slots);
    const oppCurrent=currentStarters(oppMatch,oppPlayers,slots);
    const myOptimal=optimize(myPlayers,slots,myCurrent);
    const oppOptimal=optimize(oppPlayers,slots,oppCurrent);

    const mine={
      actual:actualTotal(myCurrent),
      expected:round(myOptimal.total),
      currentExpected:total(myCurrent),
      sigma:round(sigmaTotal(myOptimal.picked)),
    };
    const opponent={
      actual:actualTotal(oppCurrent),
      expected:round(oppOptimal.total),
      currentExpected:total(oppCurrent),
      sigma:round(sigmaTotal(oppOptimal.picked)),
    };
    const win=matchupProbability(mine,opponent);
    const posture=win>=.65?"protect_floor":win<=.35?"chase_ceiling":"neutral";
    const decisions=callRows(myCurrent,myOptimal,myPlayers,posture);
    const flexMoves=lateSwapFlexMoves(myOptimal.picked);

    const allPlayers=[...myPlayers,...oppPlayers];
    const anyLive=allPlayers.some(p=>p.locked&&!p.complete);
    const anyStarted=allPlayers.some(p=>p.locked);
    const anyRemaining=allPlayers.some(p=>!p.locked);
    const phase=anyLive?"LIVE":anyStarted&&anyRemaining?"BETWEEN_GAMES":anyStarted?"POSTGAME":"PREGAME";
    const nextKickoff=allPlayers.filter(p=>!p.locked&&p.kickoffAt)
      .map(p=>new Date(p.kickoffAt).getTime()).filter(Number.isFinite).sort((a,b)=>a-b)[0]||null;

    const previous=await s.get(`live_state_${chosen.id}_${week}`,{type:"json"}).catch(()=>null);
    const winPct=Math.round(win*100);
    const events=surprises(myCurrent,oppCurrent);
    if(previous?.winProbability!=null&&Math.abs(winPct-previous.winProbability)>=8){
      events.unshift({
        side:"MATCHUP",label:"WIN ODDS MOVED",
        surprise:winPct-previous.winProbability,
        name:`${previous.winProbability}% → ${winPct}%`,
      });
    }
    if(previous?.posture&&previous.posture!==posture){
      events.unshift({
        side:"MATCHUP",label:"STRATEGY CHANGED",
        name:`${String(previous.posture).replaceAll("_"," ")} → ${String(posture).replaceAll("_"," ")}`,
        surprise:0,
      });
    }

    const lockedNow=myPlayers.filter(p=>p.locked).map(p=>p.pid);
    const priorLocked=new Set(previous?.lockedPids||[]);
    const newlyLocked=myPlayers.filter(p=>p.locked&&!priorLocked.has(p.pid)).map(p=>p.name);

    const response={
      at:now,phase,pollAfterSeconds:phase==="LIVE"?60:phase==="BETWEEN_GAMES"?120:phase==="PREGAME"?180:600,
      league:{id:chosen.id,name:chosen.name},week,opponentName:blueprint.opponent,
      score:{mine:mine.actual,opponent:opponent.actual},
      expected:{
        mine:mine.expected,opponent:opponent.expected,
        currentMine:mine.currentExpected,currentOpponent:opponent.currentExpected,
        margin:round(mine.expected-opponent.expected)
      },
      winProbability:winPct,posture,
      calls:decisions.calls,actionableCalls:decisions.actionableCalls,leans:decisions.leans,
      flexMoves,events,newlyLocked,
      nextKickoffAt:nextKickoff?new Date(nextKickoff).toISOString():null,
      mine:{current:myCurrent,optimal:myOptimal.picked,players:myPlayers},
      opponent:{current:oppCurrent,optimal:oppOptimal.picked},
    };

    await s.setJSON(`live_state_${chosen.id}_${week}`,{
      at:now,winProbability:winPct,posture,lockedPids:lockedNow
    }).catch(()=>{});

    return new Response(JSON.stringify(response),{
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{
      status:502,headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }
};
