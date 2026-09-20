import {
  MY_USER_ID,fetchLeagueCore,computeSnapshot,normName,normTeam,ownerHistory
} from "./lib/ocho.mjs";
import {
  getPlayersTrim,pInfo,slotPos,store,callClaude
} from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { rosterActionsCacheKey,rosterActionsLockKey } from "./lib/roster-cache.mjs";
import lineup, {
  scoreSleeperProjection,optimize,fantasyPoints,parseCsv,usage,weightedMean,easternKickoffMs
} from "./lineup.mjs";
import { detectLeagueMode,validateActions } from "./lib/roster-v2.mjs";
import { getDynastyMarket,pickValue } from "./lib/market-v2.mjs";

const NV="https://github.com/nflverse/nflverse-data/releases/download";
async function j(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function txt(url){
  const r=await fetch(url,{redirect:"follow"});
  if(!r.ok)return null;
  return r.text();
}
const n=v=>v==null||v===""||Number.isNaN(+v)?0:+v;
const round=x=>Math.round(x*10)/10;

export function computeTrendVelocity(current=0,prior=0,elapsedHours=null){
  if(elapsedHours==null || !Number.isFinite(Number(elapsedHours)) || Number(elapsedHours)<=0){
    return {delta:0,perHour:0};
  }
  const delta=Math.max(0,Number(current||0)-Number(prior||0));
  return {delta:round(delta),perHour:round(delta/Math.max(.1,Number(elapsedHours)))};
}
function hardInjured(status){
  return /\b(out|ir|pup|sus|suspended|doubtful)\b/i.test(String(status||""));
}

export function buildTeamGameLocks(gamesCsv,season,week,nowMs=Date.now()){
  const rows=parseCsv(gamesCsv,[
    "season","week","game_type","home_team","away_team","gameday","gametime"
  ]);
  const out={};
  for(const g of rows){
    if(n(g.season)!==Number(season)||n(g.week)!==Number(week))continue;
    if(g.game_type&&g.game_type!=="REG")continue;
    const kickoff=easternKickoffMs(g.gameday,g.gametime);
    const shared={
      kickoffAt:kickoff?new Date(kickoff).toISOString():null,
      locked:kickoff!=null&&nowMs>=kickoff,
    };
    const h=normTeam(g.home_team),a=normTeam(g.away_team);
    if(h)out[h]={...shared,opp:a||null};
    if(a)out[a]={...shared,opp:h||null};
  }
  return out;
}

export function specialistScheduleEdge(add,drop,week){
  if(!add||!drop)return {thisWeekEdge:null,next3Edge:null};
  const av=add.weeks||{},dv=drop.weeks||{};
  const current=(av[week]!=null&&dv[week]!=null)
    ? round(Number(av[week])-Number(dv[week]))
    : null;
  const vals=[];
  for(const w of [week,week+1,week+2]){
    if(av[w]!=null&&dv[w]!=null)vals.push(Number(av[w])-Number(dv[w]));
  }
  return {
    thisWeekEdge:current,
    next3Edge:vals.length?round(vals.reduce((a,b)=>a+b,0)/vals.length):null,
  };
}
function pickLabel(p){
  const ord={1:"1st",2:"2nd",3:"3rd",4:"4th",5:"5th",6:"6th"}[p.round]||`R${p.round}`;
  return `${p.season} ${ord} (${p.original})`;
}
function parseJson(text){
  if(!text)return null;
  const clean=text.replace(/```json|```/gi,"").trim();
  const a=clean.indexOf("{"),b=clean.lastIndexOf("}");
  if(a<0||b<a)return null;
  try{return JSON.parse(clean.slice(a,b+1));}catch(e){return null;}
}
async function recentFormMap(season,week,league){
  const [curTxt,priorTxt]=await Promise.all([
    txt(`${NV}/stats_player/stats_player_week_${season}.csv`),
    txt(`${NV}/stats_player/stats_player_week_${season-1}.csv`)
  ]);
  const wanted=[
    "player_display_name","position","week","season_type",
    "completions","attempts","passing_yards","passing_tds","passing_interceptions","passing_fumbles_lost",
    "carries","rushing_yards","rushing_tds","rushing_fumbles_lost",
    "targets","receptions","receiving_yards","receiving_tds","receiving_fumbles_lost",
    "target_share","air_yards_share","wopr",
    "passing_first_downs","rushing_first_downs","receiving_first_downs",
    "passing_2pt_conversions","rushing_2pt_conversions","receiving_2pt_conversions"
  ];
  const group=rows=>{
    const out={};
    for(const r of rows){
      if(r.season_type&&r.season_type!=="REG")continue;
      const key=normName(r.player_display_name||"");
      if(!key)continue;
      (out[key]=out[key]||[]).push(r);
    }
    for(const rows of Object.values(out))rows.sort((a,b)=>n(a.week)-n(b.week));
    return out;
  };
  const cur=group(parseCsv(curTxt,wanted).filter(r=>n(r.week)<=week));
  const prior=group(parseCsv(priorTxt,wanted));
  const names=new Set([...Object.keys(cur),...Object.keys(prior)]);
  const out={};

  for(const name of names){
    const current=cur[name]||[], old=prior[name]||[];
    const pos=(current.at(-1)?.position||old.at(-1)?.position||"UNK");
    const recent=current.slice(-3);
    const baseline=current.length>3?current.slice(-6,-3):old.slice(-5);
    const recentPts=weightedMean(recent,r=>fantasyPoints(r,league.scoring_settings||{},pos));
    const baselinePts=weightedMean(baseline,r=>fantasyPoints(r,league.scoring_settings||{},pos));
    const recentUsage=weightedMean(recent,r=>usage(r,pos));
    const baselineUsage=weightedMean(baseline,r=>usage(r,pos));
    const roleRatio=recentUsage!=null&&baselineUsage>0
      ? Math.max(.72,Math.min(1.32,recentUsage/baselineUsage))
      : 1;
    out[name]={
      pos,currentGames:current.length,recentGames:recent.length,
      recentPts:recentPts==null?null:round(recentPts),
      baselinePts:baselinePts==null?null:round(baselinePts),
      roleRatio:round(roleRatio),
    };
  }
  return out;
}

export function blendedRosterForecast(providerAvg,form){
  const provider=Number(providerAvg||0);
  if(!form || form.recentPts==null)return {
    forecast:round(provider),source:"provider",roleRatio:1,
    recentPts:null,baselinePts:null,currentGames:0
  };
  const games=Number(form.currentGames||0);
  // Real football earns weight slowly: 30% after one game, topping out at
  // 62% once there is a meaningful current-season sample.
  const actualWeight=Math.min(.62,.18+games*.12);
  const baseline=form.baselinePts==null?form.recentPts:form.baselinePts;
  const sampleBlend=games>=3
    ? form.recentPts*.72+baseline*.28
    : games===2
      ? form.recentPts*.58+baseline*.42
      : form.recentPts*.38+baseline*.62;
  const roleMult=1+.20*((form.roleRatio||1)-1);
  const blended=((provider*(1-actualWeight))+(sampleBlend*actualWeight))*roleMult;
  return {
    forecast:round(Math.max(0,blended)),
    source:"blended_form",
    roleRatio:form.roleRatio||1,
    recentPts:form.recentPts,
    baselinePts:form.baselinePts,
    currentGames:games
  };
}

export function currentOfficialInjuries(csvText,week){
  const out={};
  for(const r of parseCsv(csvText,[
    "full_name","week","report_status","practice_status",
    "report_primary_injury","practice_primary_injury"
  ])){
    const wk=n(r.week),key=normName(r.full_name||"");
    if(!key||wk>Number(week))continue;
    const prev=out[key];
    if(!prev||wk>=prev.week){
      out[key]={
        week:wk,
        status:(r.report_status||r.practice_status||"").trim(),
        practice:(r.practice_status||"").trim(),
        injury:(r.report_primary_injury||r.practice_primary_injury||"").trim(),
      };
    }
  }
  return out;
}

async function projectionMap(season,week,league,db){
  const weeks=Array.from({length:6},(_,i)=>week+i).filter(w=>w<=18);
  const rows=await Promise.all(weeks.map(w=>
    j(`https://api.sleeper.app/projections/nfl/${season}/${w}?season_type=regular&order_by=ppr`).catch(()=>[])
  ));
  const out={};
  rows.forEach((list,idx)=>{
    const wk=weeks[idx];
    for(const row of list||[]){
      const pid=row.player_id;
      if(!pid)continue;
      const info=pInfo(db,pid),slot=slotPos(info);
      const pts=scoreSleeperProjection(row.stats,league.scoring_settings||{},slot);
      if(typeof pts!=="number")continue;
      const rec=out[pid]||(out[pid]={weeks:{},avg:0,tradeAvg:0,tradeTotal:0});
      rec.weeks[wk]=round(pts);
    }
  });
  for(const rec of Object.values(out)){
    const short=weeks.slice(0,3).map(w=>rec.weeks[w]).filter(v=>v!=null);
    const horizon=weeks.map(w=>rec.weeks[w]).filter(v=>v!=null);
    rec.avg=short.length?round(short.reduce((a,b)=>a+b,0)/short.length):0;
    rec.tradeAvg=horizon.length?round(horizon.reduce((a,b)=>a+b,0)/horizon.length):rec.avg;
    rec.tradeTotal=round(horizon.reduce((a,b)=>a+b,0));
    rec.tradeWeeks=horizon.length;
  }
  return out;
}
function playerView(pid,db,proj,formMap={},gameLocks={},injuryMap={}){
  const p=pInfo(db,pid);
  const key=normName(p.name);
  const provider=proj[pid]?.avg??0;
  const tradeProvider=proj[pid]?.tradeAvg??provider;
  const form=blendedRosterForecast(provider,formMap[key]);
  const tradeForm=blendedRosterForecast(tradeProvider,formMap[key]);
  const game=gameLocks[normTeam(p.team)]||null;
  const official=injuryMap[key]||null;
  const injury=official?.status||p.inj||null;
  const tradeWeeks=proj[pid]?.tradeWeeks||0;
  return {
    pid,name:p.name,pos:slotPos(p),eligibleSlots:p.fps||[],team:p.team,age:p.age,injury,
    practiceStatus:official?.practice||null,injuryDetail:official?.injury||null,
    next3:form.forecast,providerNext3:provider,weeks:proj[pid]?.weeks||{},
    tradeAvg:tradeForm.forecast,tradeTotal:round(tradeForm.forecast*Math.max(1,tradeWeeks)),tradeWeeks,
    forecastSource:form.source,roleRatio:form.roleRatio,recentPts:form.recentPts,
    baselinePts:form.baselinePts,currentGames:form.currentGames,
    kickoffAt:game?.kickoffAt||null,gameLocked:!!game?.locked
  };
}

function simPlayer(p){
  return {
    pid:p.pid,name:p.name,slot:p.pos||p.slot||"UNK",
    eligibleSlots:p.eligibleSlots||p.fps||[],
    projection:Number(p.next3||0),out:hardInjured(p.injury),locked:false
  };
}
function simTotal(players,slots){
  return round(optimize(players.map(simPlayer),slots,[]).total||0);
}
function rosterAfter(roster,{removeNames=[],addPlayers=[]}={}){
  const remove=new Set(removeNames.map(normName));
  return [
    ...roster.filter(p=>!remove.has(normName(p.name))),
    ...addPlayers.filter(Boolean),
  ];
}
function assetName(x){return x?.name||String(x||"");}

const SPECIALIST_POSITIONS=new Set(["DEF","K"]);

export function positionalDepthDecision({
  mode="REDRAFT",add=null,drop=null,roster=[],activeSlots=[],weeklyDelta=0
}={}){
  if(mode!=="REDRAFT" || !add || !drop || add.pos===drop.pos){
    return {allowed:true,reason:null};
  }
  if(!["RB","WR"].includes(drop.pos)){
    return {allowed:true,reason:null};
  }

  const dedicatedStarters=activeSlots.filter(s=>s===drop.pos).length;
  const minimum=Math.max(1,dedicatedStarters+1);
  const current=roster.filter(p=>p.pos===drop.pos&&!p.onIR).length;
  const after=current-1;

  if(after<minimum && Number(weeklyDelta||0)<2.5){
    return {
      allowed:false,
      reason:`would leave only ${after} ${drop.pos}s; protect at least ${minimum} unless the lineup gain is substantial`
    };
  }
  return {allowed:true,reason:null};
}

export function waiverMoveActionable(x,mode="REDRAFT"){
  if(!x)return false;
  if(mode==="DYNASTY")return (x.weeklyDelta??0)>=.5 || (x.marketDelta??0)>=6;
  if(x.specialistMode==="STREAM_SWAP"){
    if(x.streamWeekEdge!=null)return x.streamWeekEdge>=1 || (x.streamNext3Edge??0)>=1;
    return (x.weeklyDelta??0)>=.75;
  }
  if(x.specialistMode==="BYE_HOLD")return true;
  if(x.stash&&(x.depthDelta??0)>=1.5)return true;
  return (x.weeklyDelta??0)>=.75;
}

export function specialistRosterDecision({
  mode="REDRAFT",add=null,drop=null,roster=[],activeSlots=[],week=1,marginalDrop=0
}={}){
  if(!add || !SPECIALIST_POSITIONS.has(add.pos)){
    return {allowed:true,mode:null,reason:null};
  }

  const same=roster.filter(p=>p.pos===add.pos);
  const starterNeed=Math.max(1,activeSlots.filter(s=>s===add.pos).length);
  const alreadyCovered=same.length>=starterNeed;

  if(!alreadyCovered){
    return {allowed:true,mode:"FILL_SPECIALIST",reason:`fill open ${add.pos} slot`};
  }

  if(drop?.pos===add.pos){
    return {allowed:true,mode:"STREAM_SWAP",reason:`swap ${add.pos} rather than carry two`};
  }

  // Carrying a second defense can occasionally be rational for an imminent
  // bye/setup week in either format, but only if the sacrificed player is
  // truly replacement-level. Carrying two kickers is never worth a bench spot,
  // including dynasty: swap the kicker instead.
  if(add.pos==="K"){
    return {allowed:false,mode:"BLOCK_DUPLICATE_K",reason:"already roster a kicker; swap kickers instead"};
  }

  const upcoming=[week+1,week+2].filter(w=>w<=18);
  const addHasWindow=upcoming.some(w=>Object.prototype.hasOwnProperty.call(add.weeks||{},w));
  const hasUpcomingBye=addHasWindow && same.some(p=>
    upcoming.some(w=>!Object.prototype.hasOwnProperty.call(p.weeks||{},w))
  );
  const existingBest=Math.max(...same.map(p=>Number(p.next3||0)),0);
  const clearScheduleEdge=Number(add.next3||0)>=existingBest+1.5;
  const replacementLevelDrop=Number(marginalDrop||0)<=0.5;

  if(hasUpcomingBye && clearScheduleEdge && replacementLevelDrop){
    return {
      allowed:true,mode:"BYE_HOLD",
      reason:"temporary second defense for an imminent bye/schedule edge with a replacement-level drop"
    };
  }

  return {
    allowed:false,mode:"BLOCK_DUPLICATE_DEF",
    reason:`already roster a defense; do not burn useful ${mode==="DYNASTY"?"dynasty value":"skill depth"} for a second DST`
  };
}

export function buildWaiverPlan(pairs=[],limit=3){
  const plan=[],seenAdds=new Set();
  for(const pair of pairs||[]){
    const key=normName(pair?.add||"");
    if(!key||seenAdds.has(key))continue;
    seenAdds.add(key);
    plan.push({
      ...pair,
      claimRank:plan.length+1,
      claimRole:plan.length===0?"PRIMARY":"BACKUP",
    });
    if(plan.length>=limit)break;
  }
  return plan;
}

export function deterministicRosterFallback({waivers=[],trades=[],mode="REDRAFT",usesFaab=false,faabRemainingPct=100}={}) {
  const actions=[];
  const waiverLimit=trades.length?2:3;
  for(const [i,w] of waivers.slice(0,waiverLimit).entries()){
    const impact=Math.max(
      Number(w.weeklyDelta||0),
      Number(w.depthDelta||0)*.55,
      mode==="DYNASTY"?Number(w.marketDelta||0)/8:0
    );
    const confidence=impact>=2?"HIGH":impact>=.8?"MEDIUM":"LOW";
    const faabBase=mode==="DYNASTY"
      ? Math.min(22,Math.max(2,Math.round((w.marketDelta||0)*.7+(w.weeklyDelta||0)*4)))
      : w.stash
        ? Math.min(12,Math.max(2,Math.round((w.depthDelta||0)*2+Math.log10(1+(w.trending||0))*2)))
        : Math.min(28,Math.max(2,Math.round((w.weeklyDelta||0)*6+Math.log10(1+(w.trending||0))*3)));
    const faabPct=usesFaab?Math.min(Math.max(0,Math.round(faabRemainingPct)),faabBase):null;
    actions.push({
      type:"ADD_DROP",priority:i+1,confidence,
      claimRank:w.claimRank??i+1,claimRole:w.claimRole||(i===0?"PRIMARY":"BACKUP"),
      headline:w.specialistMode==="STREAM_SWAP"
        ? `Stream ${w.add}, drop ${w.drop}`
        : w.specialistMode==="BYE_HOLD"
          ? `Short-term hold ${w.add}, drop ${w.drop}`
          : `${w.stash?"Stash":"Add"} ${w.add}, drop ${w.drop}`,
      why:mode==="DYNASTY"
        ? `Deterministic screen: ${w.weeklyDelta>=0?"+":""}${w.weeklyDelta.toFixed(1)} points/week to the best lineup and ${w.marketDelta==null?"no market reading":`${w.marketDelta>=0?"+":""}${w.marketDelta.toFixed(0)} market value`}.`
        : w.specialistMode==="STREAM_SWAP"
          ? `DST/K roster construction: this is a specialist-for-specialist stream, not a second specialist using a skill-position bench spot. ${w.streamWeekEdge==null?"":`This week ${w.streamWeekEdge>=0?"+":""}${w.streamWeekEdge.toFixed(1)}; `}${w.weeklyDelta>=0?"+":""}${w.weeklyDelta.toFixed(1)} projected points/week across the short horizon.`
          : w.specialistMode==="BYE_HOLD"
            ? `Temporary second-defense hold cleared the bye/schedule test and the proposed drop is replacement-level.`
            : w.stash
              ? `Bench-upside screen: ${w.depthDelta>=0?"+":""}${Number(w.depthDelta||0).toFixed(1)} replacement-adjusted bench value with a real role/trend breakout signal; no immediate starter gain is required.`
              : `Deterministic screen: ${w.weeklyDelta>=0?"+":""}${w.weeklyDelta.toFixed(1)} points/week to the best legal lineup over the next three weeks.`,
      window:"BEFORE WAIVERS",
      add:{name:w.add},drop:{name:w.drop},faabPct,
      drivers:[w.stash?"role":"depth","schedule",...(mode==="DYNASTY"?["market"]:[])],
      weeklyDelta:w.weeklyDelta,depthDelta:w.depthDelta??null,stash:!!w.stash,
      specialistMode:w.specialistMode||null,
      streamWeekEdge:w.streamWeekEdge??null,streamNext3Edge:w.streamNext3Edge??null,
      rosterFitReason:w.rosterFitReason||null,
      breakoutScore:w.breakoutScore??null,marketDelta:w.marketDelta??null,
      trendDelta:w.trendDelta??null,trendVelocity:w.trendVelocity??null,
      roleRatio:w.addRoleRatio??null,forecastSource:w.addSource||null,
    });
  }
  for(const [i,t] of trades.slice(0,Math.max(0,3-actions.length)).entries()){
    actions.push({
      type:"TRADE_FOR",priority:actions.length+1,
      confidence:t.confidence||"MEDIUM",
      headline:`Offer for ${t.target}`,
      why:t.why,
      window:"THIS WEEK",partner:t.partner,
      send:t.send,receive:[{type:"player",name:t.target}],
      faabPct:null,drivers:["consolidation",...(mode==="DYNASTY"?["market","pick_value"]:[])],
      weeklyDelta:t.weeklyDelta,partnerWeeklyDelta:t.partnerWeeklyDelta,
      sendValue:t.sendValue??null,receiveValue:t.receiveValue??null,
      marketDelta:t.marketDelta??null,managerFit:t.managerFit??null,
      partnerCareerTrades:t.partnerCareerTrades??null,
    });
  }
  if(!actions.length){
    actions.push({
      type:"HOLD",priority:1,confidence:"MEDIUM",headline:"Hold the roster",
      why:"No deterministic waiver swap or trade package cleared the improvement and plausibility screens.",
      window:"WATCH",drivers:["depth"]
    });
  }
  return {
    summary:actions[0].headline,
    actions,
    watch:trades.length?trades.slice(0,2).map(t=>`Trade market: ${t.target} on ${t.partner}`):[]
  };
}

export default async req=>{
  try{
    const url=new URL(req.url),force=url.searchParams.get("refresh")==="1",coreOnly=url.searchParams.get("core")==="1";
    const leagues=await getMyLeagues();
    const requested=url.searchParams.get("league");
    const chosen=leagues.find(l=>l.id===requested)||leagues[0];
    if(!chosen)return new Response(JSON.stringify({error:"no league"}),{status:404});

    const s=store(),cacheKey=rosterActionsCacheKey(chosen.id);
    const cached=await s.get(cacheKey,{type:"json"}).catch(()=>null);
    if(!force&&cached&&Date.now()-(cached.at||0)<4*60*60*1000){
      return new Response(JSON.stringify(cached),{headers:{"content-type":"application/json","cache-control":"no-store"}});
    }

    const [core,db]=await Promise.all([fetchLeagueCore(chosen.id),getPlayersTrim()]);
    const league=core.league,snapshot=computeSnapshot(core,db);
    const me=snapshot.teams.find(t=>t.isMe);
    if(!me)throw new Error("my roster missing");
    const mode=detectLeagueMode(league);
    const faabTotal=Number(league.settings?.waiver_budget||0);
    const faabUsed=Number(me.waiverBudgetUsed||0);
    const faabRemaining=Math.max(0,faabTotal-faabUsed);
    const usesFaab=faabTotal>0;
    const faabRemainingPct=faabTotal>0?faabRemaining/faabTotal*100:0;
    const week=Number(core.nflState?.week)||1,season=Number(core.nflState?.season)||Number(league.season);
    const [proj,formMap,lineupData,market,gamesCsv,injuryCsv]=await Promise.all([
      projectionMap(season,week,league,db),
      recentFormMap(season,week,league),
      lineup(new Request(`${url.origin}/.netlify/functions/lineup?league=${encodeURIComponent(chosen.id)}`))
        .then(r=>r.json()).catch(()=>null),
      mode==="DYNASTY"?getDynastyMarket(s):Promise.resolve({players:{},picks:{},scrapeDate:null}),
      txt("https://github.com/nflverse/nfldata/raw/master/data/games.csv"),
      txt(`${NV}/injuries/injuries_${season}.csv`)
    ]);
    const gameLocks=buildTeamGameLocks(gamesCsv,season,week,Date.now());
    const officialInjuries=currentOfficialInjuries(injuryCsv,week);
    const marketValue=name=>market.players?.[normName(name)]?.value??null;
    const rankedTeams=[...snapshot.teams].sort((a,b)=>(b.wins-a.wins)||(b.pointsFor-a.pointsFor));
    const tierOfOriginal=original=>{
      const idx=rankedTeams.findIndex(t=>t.name===original);
      if(idx<0)return "mid";
      const third=Math.max(1,Math.ceil(rankedTeams.length/3));
      if(idx<third)return "late";
      if(idx>=rankedTeams.length-third)return "early";
      return "mid";
    };

    const rostered=new Set();
    for(const r of core.rosters)for(const pid of r.players||[])rostered.add(pid);
    const trendById=Object.fromEntries((core.trending||[]).map(x=>[x.player_id,n(x.count)]));
    const priorTrendById=cached?.context?.trendingSnapshot||{};
    const trendElapsedHours=cached?.at
      ? Math.max(.1,(Date.now()-cached.at)/3600000)
      : null;
    const topProj=Object.entries(proj).sort((a,b)=>(b[1].avg||0)-(a[1].avg||0)).slice(0,220).map(([pid])=>pid);
    const candidateIds=[...new Set([...(core.trending||[]).map(x=>x.player_id),...topProj])]
      .filter(pid=>pid&&!rostered.has(pid));

    let free=candidateIds.map(pid=>{
      const p=playerView(pid,db,proj,formMap,gameLocks,officialInjuries),trend=trendById[pid]||0;
      const priorTrend=Number(priorTrendById[pid]||0);
      const velocity=computeTrendVelocity(trend,priorTrend,trendElapsedHours);
      const trendDelta=velocity.delta;
      const trendVelocity=velocity.perHour;
      const mv=mode==="DYNASTY"?marketValue(p.name):null;
      const ageBonus=mode==="DYNASTY"&&p.age?Math.max(-5,Math.min(6,(27-p.age)*1.1)):0;
      const velocityBonus=Math.log10(1+trendVelocity)*1.5;
      const score=mode==="DYNASTY"
        ? (mv??0)*.7+(p.next3||0)*1.25+Math.log10(1+trend)*3+velocityBonus+ageBonus
        : (p.next3||0)*4+Math.log10(1+trend)*3+velocityBonus;
      return {
        ...p,market:mv,trending:trend,trendDelta:round(trendDelta),
        trendVelocity:round(trendVelocity),screenScore:round(score)
      };
    }).filter(p=>p.name&&p.team&&!hardInjured(p.injury)&&!p.gameLocked)
      .sort((a,b)=>b.screenScore-a.screenScore).slice(0,24);

    const enrichForecast=p=>{
      const key=normName(p.name),provider=proj[p.pid]?.avg??0;
      const tradeProvider=proj[p.pid]?.tradeAvg??provider;
      const form=blendedRosterForecast(provider,formMap[key]);
      const tradeForm=blendedRosterForecast(tradeProvider,formMap[key]);
      const game=gameLocks[normTeam(p.team)]||null;
      const official=officialInjuries[key]||null;
      const tradeWeeks=proj[p.pid]?.tradeWeeks||0;
      return {
        ...p,eligibleSlots:p.fps||[],
        injury:official?.status||p.inj||p.injury||null,
        practiceStatus:official?.practice||null,injuryDetail:official?.injury||null,
        next3:form.forecast,providerNext3:provider,weeks:proj[p.pid]?.weeks||{},
        tradeAvg:tradeForm.forecast,tradeTotal:round(tradeForm.forecast*Math.max(1,tradeWeeks)),tradeWeeks,
        forecastSource:form.source,roleRatio:form.roleRatio,recentPts:form.recentPts,
        baselinePts:form.baselinePts,currentGames:form.currentGames,
        kickoffAt:game?.kickoffAt||null,gameLocked:!!game?.locked
      };
    };
    const lineupByName=new Map((lineupData?.players||[]).map(p=>[normName(p.name),p]));
    const myRoster=me.players.map(p=>({
      ...enrichForecast(p),
      market:mode==="DYNASTY"?marketValue(p.name):null,
      gameLocked:!!lineupByName.get(normName(p.name))?.locked||!!p.gameLocked,
    }));
    const starterSet=new Set(snapshot.matchup?.myStarters||[]);
    const baseDropPool=myRoster.filter(p=>!starterSet.has(p.name)&&!p.onIR&&!p.gameLocked);
    const specialistSwapPool=myRoster.filter(p=>SPECIALIST_POSITIONS.has(p.pos)&&!p.onIR&&!p.gameLocked);
    const dropPool=[...new Map([...baseDropPool,...specialistSwapPool].map(p=>[p.pid,p])).values()];
    const drops=dropPool
      .map(p=>({...p,dropScore:mode==="DYNASTY"?(p.market??0)*.75+(p.next3||0)*1.5:(p.next3||0)}))
      .sort((a,b)=>a.dropScore-b.dropScore).slice(0,12);

    const enrichPick=p=>{
      const tier=tierOfOriginal(p.original);
      return {name:pickLabel(p),type:"pick",season:p.season,round:p.round,tier,value:pickValue(p,market,tier)};
    };

    const seasonTradeProfile={};
    for(const txns of core.txnWeeks||[]){
      for(const tx of txns||[]){
        if(tx?.type!=="trade" || (tx.status && tx.status!=="complete"))continue;
        for(const rid of tx.roster_ids||[]){
          const p=seasonTradeProfile[rid]||(seasonTradeProfile[rid]={trades:0,acquired:{},picksReceived:0});
          p.trades++;
          for(const [pid,toRid] of Object.entries(tx.adds||{})){
            if(Number(toRid)!==Number(rid))continue;
            const pos=slotPos(pInfo(db,pid));
            if(pos)p.acquired[pos]=(p.acquired[pos]||0)+1;
          }
          p.picksReceived+=(tx.draft_picks||[]).filter(dp=>Number(dp.owner_id)===Number(rid)).length;
        }
      }
    }

    const otherTeams=snapshot.teams.filter(t=>!t.isMe).map(t=>{
      const hist=ownerHistory(t.ownerId);
      return {
        name:t.name,ownerId:t.ownerId,record:`${t.wins}-${t.losses}`,stance:t.stance,
        holes:t.holes,surplus:t.surplus,
        tradeProfile:{
          careerTrades:Number(hist.trades_count||0),
          seasonTrades:Number(seasonTradeProfile[t.rosterId]?.trades||0),
          acquired:hist.trade_positions_acquired||{},
          seasonAcquired:seasonTradeProfile[t.rosterId]?.acquired||{},
          seasonPicksReceived:Number(seasonTradeProfile[t.rosterId]?.picksReceived||0),
          lineupEfficiency:hist.lineup_efficiency_pct??null,
          benchLeak:hist.avg_bench_leak_per_week??null,
        },
        players:t.players.map(p=>({
          ...enrichForecast(p),
          market:mode==="DYNASTY"?marketValue(p.name):null
        })),
        picks:mode==="DYNASTY"?t.picks.map(enrichPick):[]
      };
    });
    const myPicks=mode==="DYNASTY"?me.picks.map(enrichPick):[];
    const myNames=new Set(myRoster.map(p=>normName(p.name)));
    const freeNames=new Set(free.map(p=>normName(p.name)));
    const teamPlayers=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.players.map(p=>normName(p.name)))]));
    const teamPicks=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.picks.map(p=>p.name))]));
    const myPickNames=new Set(myPicks.map(p=>p.name));

    const activeSlots=(league.roster_positions||[]).filter(s=>!["BN","IR","TAXI"].includes(s));
    const baselineRosterTotal=simTotal(myRoster,activeSlots);

    // Replacement value matters for bench construction. The third-best
    // available option at a position is a conservative approximation of what
    // can be replaced from waivers in this specific league.
    const replacementByPos={};
    for(const pos of ["QB","RB","WR","TE","K","DEF","DL","LB","DB"]){
      const vals=free.filter(p=>p.pos===pos).map(p=>Number(p.next3||0)).sort((a,b)=>b-a);
      replacementByPos[pos]=vals.length?vals[Math.min(2,vals.length-1)]:0;
    }
    const marginal=p=>p?Math.max(0,Number(p.next3||0)-Number(replacementByPos[p.pos]||0)):0;

    const waiverPairs=[];
    for(const add of free.slice(0,18)){
      for(const drop of drops.slice(0,8)){
        if(add.pid===drop.pid)continue;
        const after=simTotal(rosterAfter(myRoster,{removeNames:[drop.name],addPlayers:[add]}),activeSlots);
        const weeklyDelta=round(after-baselineRosterTotal);
        const marketDelta=mode==="DYNASTY"&&add.market!=null&&drop.market!=null?add.market-drop.market:null;
        const depthDelta=round(marginal(add)-marginal(drop));
        const specialist=specialistRosterDecision({
          mode,add,drop,roster:myRoster,activeSlots,week,marginalDrop:marginal(drop)
        });
        if(!specialist.allowed)continue;
        const depthFit=positionalDepthDecision({
          mode,add,drop,roster:myRoster,activeSlots,weeklyDelta
        });
        if(!depthFit.allowed)continue;
        const stream=specialist.mode==="STREAM_SWAP"
          ? specialistScheduleEdge(add,drop,week)
          : {thisWeekEdge:null,next3Edge:null};

        const roleSurge=Math.max(0,Number(add.roleRatio||1)-1);
        const trendSignal=Math.log10(1+Number(add.trending||0));
        const velocitySignal=Math.log10(1+Number(add.trendVelocity||0));
        const breakoutScore=round(roleSurge*10+trendSignal+velocitySignal*1.5);
        const stash=!SPECIALIST_POSITIONS.has(add.pos) &&
          weeklyDelta<=.2 && depthDelta>=1.5 &&
          (roleSurge>=.08 || trendSignal>=2 || velocitySignal>=1.45);
        const specialistBonus=specialist.mode==="STREAM_SWAP"?2.5:specialist.mode==="BYE_HOLD"?0.5:0;
        const score=mode==="DYNASTY"
          ? weeklyDelta*5+(marketDelta??0)*.35+depthDelta*.7+(add.screenScore-drop.dropScore)*.08
          : weeklyDelta*8+depthDelta*2.5+breakoutScore*1.5+specialistBonus;
        waiverPairs.push({
          add:add.name,drop:drop.name,pos:add.pos,dropPos:drop.pos,
          specialistMode:specialist.mode,
          streamWeekEdge:stream.thisWeekEdge,streamNext3Edge:stream.next3Edge,
          rosterFitReason:specialist.reason||depthFit.reason||null,
          weeklyDelta,depthDelta,breakoutScore,stash,marketDelta,
          score:round(score),addNext3:add.next3,dropNext3:drop.next3,
          addMarket:add.market,dropMarket:drop.market,trending:add.trending,
          trendDelta:add.trendDelta,trendVelocity:add.trendVelocity,
          addSource:add.forecastSource,dropSource:drop.forecastSource,
          addRoleRatio:add.roleRatio,dropRoleRatio:drop.roleRatio,
          replacement:Number(replacementByPos[add.pos]||0)
        });
      }
    }
    waiverPairs.sort((a,b)=>b.score-a.score);
    const bestWaiverPairs=waiverPairs
      .filter(x=>waiverMoveActionable(x,mode))
      .slice(0,12);
    const waiverPlan=buildWaiverPlan(bestWaiverPairs,3);

    const tradeTargets=[];
    for(const team of otherTeams){
      for(const p of team.players){
        if(hardInjured(p.injury))continue;
        const after=simTotal(rosterAfter(myRoster,{addPlayers:[p]}),activeSlots);
        const weeklyCeiling=round(after-baselineRosterTotal);
        if(weeklyCeiling<=0.2 && mode!=="DYNASTY")continue;
        tradeTargets.push({
          partner:team.name,name:p.name,pos:p.pos,age:p.age,next3:p.next3,
          market:p.market,weeklyCeiling,forecastSource:p.forecastSource,
          roleRatio:p.roleRatio,recentPts:p.recentPts,
          partnerHoles:team.holes,partnerSurplus:team.surplus
        });
      }
    }
    tradeTargets.sort((a,b)=>
      mode==="DYNASTY"
        ? ((b.weeklyCeiling*5+(b.market??0)*.15)-(a.weeklyCeiling*5+(a.market??0)*.15))
        : b.weeklyCeiling-a.weeklyCeiling
    );
    const bestTradeTargets=tradeTargets.slice(0,24);

    const rosterByName=new Map(myRoster.map(p=>[normName(p.name),p]));
    const freeByName=new Map(free.map(p=>[normName(p.name),p]));
    const teamByName=Object.fromEntries(otherTeams.map(t=>[t.name,t]));
    const pickValueByName=new Map([
      ...myPicks.map(p=>[p.name,p.value]),
      ...otherTeams.flatMap(t=>t.picks.map(p=>[p.name,p.value]))
    ]);
    const playerAssetValue=name=>{
      const k=normName(name);
      const own=rosterByName.get(k)||freeByName.get(k);
      if(own)return own.market??null;
      for(const t of otherTeams){
        const p=t.players.find(x=>normName(x.name)===k);
        if(p)return p.market??null;
      }
      return null;
    };
    const dynastyAssetValue=x=>{
      if(x?.type==="pick")return pickValueByName.get(assetName(x))??null;
      return playerAssetValue(assetName(x));
    };

    // Build a few exact, plausible trade packages without AI. These are not
    // generated from prose: both teams are re-optimized and dynasty packages
    // must land inside a reasonable market-value band.
    const deterministicTrades=[];
    const myBench=myRoster
      .filter(p=>!starterSet.has(p.name)&&!p.onIR&&!hardInjured(p.injury))
      .sort((a,b)=>(mode==="DYNASTY"?(a.market??0)-(b.market??0):(a.next3||0)-(b.next3||0)));
    const sendAssets=[
      ...myBench.map(p=>({type:"player",name:p.name,value:mode==="DYNASTY"?p.market:(p.next3||0),player:p})),
      ...(mode==="DYNASTY"?myPicks.map(p=>({type:"pick",name:p.name,value:p.value,pick:p})):[])
    ].filter(x=>x.value!=null);

    for(const target of bestTradeTargets.slice(0,12)){
      const partner=teamByName[target.partner];
      const targetPlayer=partner?.players.find(p=>normName(p.name)===normName(target.name));
      if(!partner||!targetPlayer)continue;
      const partnerBase=simTotal(partner.players,activeSlots);
      const targetValue=mode==="DYNASTY"?(target.market??null):(target.next3||0);
      const combos=[];
      for(const a of sendAssets)combos.push([a]);
      for(let i=0;i<Math.min(sendAssets.length,12);i++){
        for(let j=i+1;j<Math.min(sendAssets.length,12);j++)combos.push([sendAssets[i],sendAssets[j]]);
      }

      let best=null;
      for(const combo of combos){
        const sentPlayers=combo.filter(x=>x.type==="player").map(x=>x.player);
        const sendValue=combo.reduce((s,x)=>s+Number(x.value||0),0);
        if(mode==="DYNASTY" && targetValue!=null){
          const ratio=targetValue/Math.max(1,sendValue);
          if(ratio<.72||ratio>1.38)continue;
        }
        const myAfter=simTotal(rosterAfter(myRoster,{
          removeNames:sentPlayers.map(p=>p.name),addPlayers:[targetPlayer]
        }),activeSlots);
        const partnerAfter=simTotal(rosterAfter(partner.players,{
          removeNames:[targetPlayer.name],addPlayers:sentPlayers
        }),activeSlots);
        const weeklyDelta=round(myAfter-baselineRosterTotal);
        const partnerWeeklyDelta=round(partnerAfter-partnerBase);
        if(weeklyDelta<=.2)continue;
        if(mode==="REDRAFT" && partnerWeeklyDelta<-1.5)continue;
        if(mode==="DYNASTY" && partnerWeeklyDelta<-3)continue;

        const receiveValue=mode==="DYNASTY"?targetValue:null;
        const marketDelta=mode==="DYNASTY"&&receiveValue!=null?round(receiveValue-sendValue):null;
        const fairnessPenalty=mode==="DYNASTY"&&receiveValue!=null
          ? Math.abs(receiveValue-sendValue)*.18
          : Math.abs(Math.min(0,partnerWeeklyDelta))*1.2;

        // Manager realism: prefer packages that resemble what this owner has
        // actually acquired historically. This is a soft ranking factor, not
        // permission to show an unfair trade.
        const profile=partner.tradeProfile||{};
        const careerTrades=Number(profile.careerTrades||0);
        const seasonTrades=Number(profile.seasonTrades||0);
        const openness=Math.min(1.22,.86+Math.log10(1+careerTrades)*.10+Math.min(.16,seasonTrades*.035));
        const sentPositions=sentPlayers.map(p=>p.pos).filter(Boolean);
        const histAcquired=profile.acquired||{};
        const seasonAcquired=profile.seasonAcquired||{};
        const positionTaste=sentPositions.length
          ? sentPositions.reduce((s,pos)=>{
              const longTerm=Math.log1p(Number(histAcquired[pos]||0));
              const recent=Math.log1p(Number(seasonAcquired[pos]||0))*1.6;
              return s+longTerm+recent;
            },0)/sentPositions.length
          : 0;
        const hasPick=combo.some(x=>x.type==="pick");
        const pickHistory=Number(profile.seasonPicksReceived||0);
        const stanceFit=hasPick
          ? (/rebuild|retool/i.test(partner.stance||"")?1.4:/win-now|ascending/i.test(partner.stance||"")?-.6:0)+Math.min(.8,pickHistory*.25)
          : (/win-now|ascending/i.test(partner.stance||"")?.7:0);
        const managerFit=positionTaste*.8+stanceFit;
        const score=(weeklyDelta*7+partnerWeeklyDelta*1.5-fairnessPenalty)*openness+managerFit;
        if(!best||score>best.score){
          best={
            score,partner:target.partner,target:target.name,
            send:combo.map(x=>({type:x.type,name:x.name})),
            weeklyDelta,partnerWeeklyDelta,
            sendValue:mode==="DYNASTY"?round(sendValue):null,
            receiveValue:mode==="DYNASTY"&&receiveValue!=null?round(receiveValue):null,
            marketDelta,
            managerFit:round(managerFit),
            partnerCareerTrades:careerTrades,
            partnerSeasonTrades:seasonTrades,
          };
        }
      }
      if(best){
        best.confidence=best.weeklyDelta>=2&&best.partnerWeeklyDelta>=-1?"HIGH":"MEDIUM";
        best.why=mode==="DYNASTY"
          ? `Deterministic trade math: ${best.weeklyDelta>=0?"+":""}${best.weeklyDelta.toFixed(1)} points/week for my best lineup, ${best.partnerWeeklyDelta>=0?"+":""}${best.partnerWeeklyDelta.toFixed(1)} for theirs, market ${best.sendValue} → ${best.receiveValue}; package fit uses this manager's historical trade behavior.`
          : `Deterministic trade math: ${best.weeklyDelta>=0?"+":""}${best.weeklyDelta.toFixed(1)} points/week for my best lineup and ${best.partnerWeeklyDelta>=0?"+":""}${best.partnerWeeklyDelta.toFixed(1)} for theirs.`;
        deterministicTrades.push(best);
      }
    }
    deterministicTrades.sort((a,b)=>b.score-a.score);

    const lineupSummary=(lineupData?.optimal||[]).filter(x=>x.player).map(x=>({
      slot:x.slot,name:x.player.name,projection:x.player.projection,
      floor:x.player.floor,ceiling:x.player.ceiling,injury:x.player.injury
    }));

    const modeRules=mode==="DYNASTY"
      ? `This is DYNASTY. Balance title odds with franchise value. The market values attached below are a deterministic current anchor dated ${market.scrapeDate||"recently"}; live reporting may justify modest deviation but not invented value. Age and future picks matter. Protect projected-early 1sts and do not spend a first for a marginal weekly gain. Trades must make sense for the other manager too.`
      : `This is REDRAFT / the fun league. Ignore future asset value and draft picks. Maximize this season: near-term points, injury insurance, role growth, and consolidating bench depth into better starters.`;

    const prompt=`You are War Room's roster-management engine. The lineup engine is separate. Recommend only moves that can materially improve my team.

LEAGUE: ${league.name}
MODE: ${mode}
NFL WEEK: ${week}
MY MATCHUP WIN CHANCE: ${lineupData?.matchup?.winProbability??"unknown"}%
MY WAIVER POSITION: ${me.waiverPosition??"unknown"}
${modeRules}

CURRENT BEST LINEUP:
${JSON.stringify(lineupSummary,null,2)}

MY ROSTER:
${JSON.stringify(myRoster,null,2)}

MY MOST PLAUSIBLE DROPS:
${JSON.stringify(drops,null,2)}

WAIVER CLAIM PLAN, ordered and deduplicated by target:
${JSON.stringify(waiverPlan,null,2)}

DETERMINISTIC ADD/DROP PAIRS, ordered by real best-lineup impact:
${JSON.stringify(bestWaiverPairs,null,2)}

ACTUALLY UNROSTERED CANDIDATES:
${JSON.stringify(free,null,2)}

DETERMINISTIC TRADE TARGET SCREEN (weeklyCeiling = max three-week lineup gain before acquisition cost):
${JSON.stringify(bestTradeTargets,null,2)}

DETERMINISTIC EXACT TRADE PACKAGES (already re-solved for both teams):
${JSON.stringify(deterministicTrades.slice(0,10),null,2)}

${mode==="DYNASTY"?`MY ACTUAL PICKS (only these may be spent):
${JSON.stringify(myPicks,null,2)}`:""}

OTHER TEAMS, THEIR ROSTERS, NEEDS AND PICKS:
${JSON.stringify(otherTeams,null,2)}

Use web search for current injury/practice news, depth-chart movement, snap/route/target role, coaching comments, scheme changes, and current trade-market sentiment. Be selective. HOLD is valid.

Hard rules:
- A pickup must be from ACTUALLY UNROSTERED CANDIDATES.
- Prefer the deterministic ADD/DROP PAIRS. Do not recommend waiver churn with no measurable lineup/value gain.
- If an add needs a roster spot, give an exact drop from MY ROSTER.
- A trade target must be on the named partner's roster.
- I can only send assets I actually own.
- In dynasty, only use the exact pick labels listed under MY ACTUAL PICKS.
- In redraft, never use draft picks.
- Give at most 5 actions, ordered by importance.
- Prefer exact packages from DETERMINISTIC EXACT TRADE PACKAGES when one exists. Otherwise use the deterministic target screen.
- For a trade, explain briefly why the other manager might accept.
- In dynasty, keep total market value reasonably defensible for BOTH sides. Weekly fit can justify a modest overpay, not fantasy-land offers.
- In redraft, the other manager also needs a credible weekly roster reason to accept.
- Do not recommend lateral churn.
- Do not recommend a player who is Out, IR, PUP, Suspended or Doubtful.

Return ONLY valid JSON:
{
  "summary":"single most important roster priority",
  "actions":[{
    "type":"ADD|WAIVER|ADD_DROP|TRADE_FOR|SELL|HOLD",
    "priority":1,
    "confidence":"HIGH|MEDIUM|LOW",
    "headline":"exact action",
    "why":"2 concise sentences",
    "window":"NOW|BEFORE WAIVERS|THIS WEEK|WATCH",
    "add":{"name":"exact player"} or null,
    "drop":{"name":"exact player"} or null,
    "partner":"exact team name" or null,
    "send":[{"type":"player|pick","name":"exact asset"}],
    "receive":[{"type":"player|pick","name":"exact asset"}],
    "faabPct":number or null,
    "drivers":["role","injury","market","schedule","depth","consolidation","pick_value"]
  }],
  "watch":["up to 3 short trigger conditions"]
}`;

    let parsed=null,error=null;
    if(!coreOnly){
      try{
        const raw=await callClaude(prompt,{maxTokens:3000,useSearch:true});
        parsed=parseJson(raw);
        if(!parsed)throw new Error("invalid roster-actions JSON");
      }catch(e){error=e.message;}
    }
    if(!parsed)parsed=deterministicRosterFallback({
      waivers:waiverPlan,trades:deterministicTrades,mode,usesFaab,faabRemainingPct
    });

    let actions=validateActions(parsed.actions,{
      myNames,freeNames,teamPlayers,teamPicks,myPicks:myPickNames,dynasty:mode==="DYNASTY"
    });

    actions=actions.map(a=>{
      if(["ADD","WAIVER","ADD_DROP"].includes(a.type)){
        const add=freeByName.get(normName(a.add?.name||""));
        const drop=rosterByName.get(normName(a.drop?.name||""));
        const after=simTotal(rosterAfter(myRoster,{
          removeNames:drop?[drop.name]:[],addPlayers:add?[add]:[]
        }),activeSlots);
        const weeklyDelta=round(after-baselineRosterTotal);
        const marketDelta=mode==="DYNASTY"&&add?.market!=null&&drop?.market!=null?add.market-drop.market:null;
        const depthDelta=round(marginal(add)-marginal(drop));
        const specialist=specialistRosterDecision({
          mode,add,drop,roster:myRoster,activeSlots,week,marginalDrop:marginal(drop)
        });
        const depthFit=positionalDepthDecision({
          mode,add,drop,roster:myRoster,activeSlots,weeklyDelta
        });
        const stream=specialist.mode==="STREAM_SWAP"
          ? specialistScheduleEdge(add,drop,week)
          : {thisWeekEdge:null,next3Edge:null};
        const roleSurge=Math.max(0,Number(add?.roleRatio||1)-1);
        const trendSignal=Math.log10(1+Number(add?.trending||0));
        const velocitySignal=Math.log10(1+Number(add?.trendVelocity||0));
        const breakoutScore=round(roleSurge*10+trendSignal+velocitySignal*1.5);
        const stash=!SPECIALIST_POSITIONS.has(add?.pos) &&
          weeklyDelta<=.2 && depthDelta>=1.5 &&
          (roleSurge>=.08 || trendSignal>=2 || velocitySignal>=1.45);
        return {
          ...a,weeklyDelta,depthDelta,breakoutScore,stash,marketDelta,
          trendDelta:add?.trendDelta??null,trendVelocity:add?.trendVelocity??null,
          rosterFitBlocked:!specialist.allowed||!depthFit.allowed,
          specialistMode:specialist.mode||null,
          streamWeekEdge:stream.thisWeekEdge,streamNext3Edge:stream.next3Edge,
          rosterFitReason:specialist.reason||depthFit.reason||null,
          forecastSource:add?.forecastSource||null,
          roleRatio:add?.roleRatio??null,
          recentPts:add?.recentPts??null,
          providerNext3:add?.providerNext3??null,
        };
      }
      if(["TRADE_FOR","SELL"].includes(a.type)){
        const partner=teamByName[a.partner];
        if(!partner)return {...a,invalidMath:true};
        const sentPlayers=(a.send||[]).filter(x=>x.type!=="pick")
          .map(x=>rosterByName.get(normName(assetName(x)))).filter(Boolean);
        const gotPlayers=(a.receive||[]).filter(x=>x.type!=="pick")
          .map(x=>partner.players.find(p=>normName(p.name)===normName(assetName(x)))).filter(Boolean);
        const myAfter=simTotal(rosterAfter(myRoster,{
          removeNames:sentPlayers.map(p=>p.name),addPlayers:gotPlayers
        }),activeSlots);
        const partnerBase=simTotal(partner.players,activeSlots);
        const partnerAfter=simTotal(rosterAfter(partner.players,{
          removeNames:gotPlayers.map(p=>p.name),addPlayers:sentPlayers
        }),activeSlots);
        const weeklyDelta=round(myAfter-baselineRosterTotal);
        const partnerWeeklyDelta=round(partnerAfter-partnerBase);
        let sendValue=null,receiveValue=null,marketDelta=null;
        if(mode==="DYNASTY"){
          const sv=(a.send||[]).map(dynastyAssetValue);
          const rv=(a.receive||[]).map(dynastyAssetValue);
          if(sv.every(v=>v!=null)&&rv.every(v=>v!=null)){
            sendValue=sv.reduce((x,y)=>x+y,0);
            receiveValue=rv.reduce((x,y)=>x+y,0);
            marketDelta=receiveValue-sendValue;
          }
        }
        const primaryGet=gotPlayers[0]||null;
        return {
          ...a,weeklyDelta,partnerWeeklyDelta,sendValue,receiveValue,marketDelta,
          forecastSource:primaryGet?.forecastSource||null,
          roleRatio:primaryGet?.roleRatio??null,
          recentPts:primaryGet?.recentPts??null,
          providerNext3:primaryGet?.providerNext3??null,
        };
      }
      return a;
    }).filter(a=>{
      if(a.invalidMath)return false;
      if(["ADD","WAIVER","ADD_DROP"].includes(a.type)){
        if(a.rosterFitBlocked)return false;
        return waiverMoveActionable(a,mode);
      }
      if(["TRADE_FOR","SELL"].includes(a.type)){
        if(mode==="DYNASTY"&&a.sendValue!=null&&a.receiveValue!=null){
          const ratio=a.sendValue>0?a.receiveValue/a.sendValue:1;
          if(ratio<.68||ratio>1.48)return false;
          if((a.partnerWeeklyDelta??0)<-3 && ratio>1.15)return false;
        }else if(mode!=="DYNASTY"&&(a.partnerWeeklyDelta??0)<-3.5){
          return false;
        }
      }
      return true;
    }).slice(0,6);
    const claimRankByAdd=new Map(waiverPlan.map(x=>[normName(x.add),x]));
    actions=actions.map(a=>{
      if(!["ADD","WAIVER","ADD_DROP"].includes(a.type))return a;
      const planned=claimRankByAdd.get(normName(a.add?.name||""));
      return planned
        ? {...a,claimRank:planned.claimRank,claimRole:planned.claimRole}
        : a;
    }).sort((a,b)=>{
      const aw=["ADD","WAIVER","ADD_DROP"].includes(a.type),bw=["ADD","WAIVER","ADD_DROP"].includes(b.type);
      if(aw&&bw)return Number(a.claimRank||99)-Number(b.claimRank||99);
      if(aw!==bw)return aw?-1:1;
      return Number(a.priority||99)-Number(b.priority||99);
    });

    const result={
      at:Date.now(),league:{id:chosen.id,name:league.name,mode,week,season},
      summary:parsed.summary||actions[0]?.headline||"No urgent roster move.",
      actions:actions.length?actions:deterministicRosterFallback({
        waivers:waiverPlan,trades:deterministicTrades,mode,usesFaab,faabRemainingPct
      }).actions,
      watch:Array.isArray(parsed.watch)?parsed.watch.slice(0,3):[],
      context:{
        freeAgentsScreened:free.length,
        waiverPosition:me.waiverPosition??null,
        waiver:{usesFaab,total:faabTotal,used:faabUsed,remaining:faabRemaining},
        myPicks,
        marketDate:market.scrapeDate||null,
        baselineNext3Lineup:baselineRosterTotal,
        waiverPlan,
        deterministicWaiverPairs:bestWaiverPairs.slice(0,5),
        rosterConstruction:"redraft specialists default to same-position swaps; duplicate DST only for a near-term bye/schedule hold with a replacement-level drop",
        noChurnThreshold:"redraft add/drop requires +0.75 pts/week, stream swap +0.35, or a qualified breakout stash",
        depthProtection:"redraft protects one RB and WR beyond dedicated starting slots unless a cross-position move adds at least 2.5 pts/week",
        gameDayLegality:"free agents are removed once their NFL game has started; specialist streams are evaluated on this-week edge first",
        deterministicTradeTargets:bestTradeTargets.slice(0,8),
        deterministicTrades:deterministicTrades.slice(0,5),
        trendingSnapshot:trendById,
        trendSnapshotAgeMinutes:cached?.at?round((Date.now()-cached.at)/60000):null,
        forecastModel:"provider + recent league-scored production + workload trend",
        replacementByPos,
        tradeModel:mode==="DYNASTY"?"fair value + both lineups + manager trade history":"both lineups + roster fit",
      },
      reasoningMode:(coreOnly||error)?"deterministic":"live_news",
      reasoningAvailable:!coreOnly&&!error,
      reasoningError:error||null,
      error:null
    };

    await s.setJSON(cacheKey,result);
    await s.delete(rosterActionsLockKey(chosen.id)).catch(()=>{});
    const histKey=`roster_action_history_${chosen.id}`;
    const hist=await s.get(histKey,{type:"json"}).catch(()=>[])||[];
    const fingerprint=JSON.stringify(result.actions.map(a=>[a.type,a.headline]));
    if(!hist.length||hist.at(-1)?.fingerprint!==fingerprint){
      hist.push({at:result.at,week,mode,fingerprint,summary:result.summary,actions:result.actions});
      while(hist.length>30)hist.shift();
      await s.setJSON(histKey,hist);
    }
    return new Response(JSON.stringify(result),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{status:502,headers:{"content-type":"application/json"}});
  }
};
