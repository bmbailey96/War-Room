/* Shared browser/Netlify trade-fit analysis.
 * Observed roster structure and preferences inferred from standings, age,
 * trade activity and draft capital. Not a claim about a manager's intentions.
 * This layer does not calculate a fantasy-points edge or a fair trade price.
 */
(function(root){
"use strict";
const POS=["QB","RB","WR","TE","DL","LB","DB","K","DEF"];
const asNum=x=>x!=null&&Number.isFinite(Number(x))?Number(x):null;
const unavailable=p=>Boolean(p?.onReserve)||/^(OUT|IR|PUP|NFI|SUS|SUSPENDED|INACTIVE)$/i.test(String(p?.injury||"").trim());
const visible=p=>!unavailable(p);
const position=p=>String(p?.pos||"OTHER").toUpperCase();
const asSet=arr=>new Set((arr||[]).map(p=>String(p?.player?.id||p?.id||p).replace(/^P:/,"")));
const fmt=(n)=>n<0?String(n):"+"+String(n);
function requirements(slots=[]){
  const dedicated=Object.fromEntries(POS.map(p=>[p,0]));
  let flex=0,superflex=0,idpFlex=0;
  for(const s of slots){
    if(dedicated[s]!=null)dedicated[s]++;
    else if(["FLEX","REC_FLEX","WRRB_FLEX"].includes(s))flex++;
    else if(s==="SUPER_FLEX")superflex++;
    else if(s==="IDP_FLEX")idpFlex++;
  }
  return {dedicated,flex,superflex,idpFlex};
}
function depth(players=[],slots=[]){
  const req=requirements(slots),count=Object.fromEntries(POS.map(p=>[p,0]));
  for(const p of players)if(visible(p)&&count[position(p)]!=null)count[position(p)]++;
  const needs=[],surplus=[],coverage={};
  for(const p of POS){
    const required=req.dedicated[p],have=count[p];
    if(required===0)continue;
    // A single healthy QB is sufficient in ordinary one-QB leagues.
    const loneQb=p==="QB"&&required===1&&req.superflex===0;
    const level=have<required?"urgent":have===required&&!loneQb?"thin":"covered";
    coverage[p]={have,required,level};
    if(level!=="covered")needs.push({position:p,level,have,required});
    const minimum=required+(loneQb?1:2);
    if(have>minimum)surplus.push({position:p,have,required});
  }
  const combined=["RB","WR","TE"].reduce((sum,p)=>sum+count[p],0);
  const dedicated=["RB","WR","TE"].reduce((sum,p)=>sum+req.dedicated[p],0);
  const playable=combined-dedicated-req.flex-req.superflex;
  const flex=(req.flex||req.superflex)?{
    have:combined,required:dedicated+req.flex+req.superflex,
    benchBeyondFlex:playable,
    level:playable<0?"urgent":playable<=1?"thin":"covered"
  }:null;
  if(flex?.level!=="covered"&&flex)needs.push({position:"FLEX_POOL",level:flex.level,
    have:combined,required:flex.required});
  return {count,coverage,needs,surplus,flex};
}
function postTrade(a,b,send=[],receive=[],partnerCuts=[],myCuts=[]){
  const sent=asSet(send),received=asSet(receive),cutPartner=asSet(partnerCuts),cutMe=asSet(myCuts);
  const incoming=receive.filter(x=>x.type==="player").map(x=>x.player||x);
  const outgoing=send.filter(x=>x.type==="player").map(x=>x.player||x);
  return {
    mine:(a||[]).filter(x=>!sent.has(String(x.id))&&!cutMe.has(String(x.id))).concat(incoming),
    theirs:(b||[]).filter(x=>!received.has(String(x.id))&&!cutPartner.has(String(x.id))).concat(outgoing),
    myNet:incoming.length-outgoing.length,
    theirNet:outgoing.length-incoming.length
  };
}
function changes(before,after){
  const reasons=[],risks=[];
  const labels={"FLEX_POOL":"FLEX-eligible players"};
  const positions=new Set([...Object.keys(before.coverage),...Object.keys(after.coverage)]);
  if(before.flex||after.flex)positions.add("FLEX_POOL");
  for(const p of positions) {
    const b=p==="FLEX_POOL"?before.flex:before.coverage[p];
    const a=p==="FLEX_POOL"?after.flex:after.coverage[p];
    if(!b||!a)continue;
    const name=labels[p]||p;
    const countDelta=Number(a.have)-Number(b.have);
    const levels={urgent:0,thin:1,covered:2};
    const improvement=levels[a.level]-levels[b.level];
    if(improvement>0)reasons.push(name+" coverage improves from "+b.level+" to "+a.level);
    if(improvement<0)risks.push(name+" coverage deteriorates from "+b.level+" to "+a.level);
    if(improvement===0&&countDelta>0&&b.level!=="covered")
      reasons.push("Adds "+countDelta+" available "+name+" to a "+b.level+" position");
    if(improvement===0&&countDelta<0&&a.level!=="covered")
      risks.push("Loses "+Math.abs(countDelta)+" available "+name+" from a "+a.level+" position");
  }
  return {reasons,risks};
}
function contextFor(audit,team){
  const row=(audit?.teams||[]).find(x=>String(x.rosterId)===String(team.rosterId))||{};
  const league=audit?.league||{};
  const playoff=asNum(league.playoffTeams);
  const standing=asNum(row.standing),pf=asNum(row.pfRank),count=asNum(league.teamCount);
  const contender=playoff>0&&standing!=null&&pf!=null&&count>0
    &&standing<=playoff&&pf<=Math.ceil(count/2);
  const struggling=playoff>0&&standing!=null&&pf!=null&&count>0
    &&standing>playoff&&pf>Math.ceil(count/2);
  return {name:team.name||row.name||"Team",
    observedTrades:asNum(row.tradeCount)??0,
    standing,pfRank:pf,
    inferredDirection:league.mode==="DYNASTY"?
      contender?"current contender (inferred from record and scoring)":
      struggling?"outside playoff positions with below-median scoring (possible retool)": "competitive window unclear":
      contender?"redraft contender (inferred)": "redraft standing does not establish trade preference"
  };
}
function needsImpact(before,after,assetsReceived=[],mode="REDRAFT"){
  const result=changes(before,after),notes=[];
  const recvPlayers=assetsReceived.filter(x=>x.type==="player").map(x=>x.player||x);
  const recvPicks=assetsReceived.filter(x=>x.type==="pick");
  if(recvPicks.length)notes.push("Receives "+recvPicks.length+" future pick"+(recvPicks.length===1?"":"s")+"; the manager's preference for picks is unverified");
  if(mode==="DYNASTY"&&recvPlayers.length){
    const youngest=recvPlayers.filter(x=>asNum(x.age)!=null&&asNum(x.age)<=25);
    if(youngest.length)notes.push("Receives "+youngest.length+" player"+(youngest.length===1?"":"s")+" age 25 or younger; future value remains unproven");
  }
  const interesting=recvPlayers.filter(p=>(asNum(p.recentMean)!=null)&&(asNum(p.observedWeeks)||0)>=2);
  if(interesting.length)notes.push("Incoming "+interesting.map(p=>p.name+" ("+Number(p.recentMean).toFixed(1)+" historical pts/g)").join(", ")+" may upgrade starter quality, but their next-week roles are unverified");
  return {...result,notes};
}
function assess({audit,me,partner,send=[],receive=[],partnerCuts=[],myCuts=[]}){
  if(!audit?.league||!me||!partner)return {status:"UNKNOWN",why:["Missing league or manager evidence"],risks:[],confidence:"insufficient"};
  const mode=audit.league.mode||"UNKNOWN";
  const slots=audit.league.activeSlots||[];
  const preMe=depth(me.players||[],slots),prePartner=depth(partner.players||[],slots);
  const changed=postTrade(me.players||[],partner.players||[],send,receive,partnerCuts,myCuts);
  const postMe=depth(changed.mine,slots),postPartner=depth(changed.theirs,slots);
  const mine=needsImpact(preMe,postMe,receive,mode),theirs=needsImpact(prePartner,postPartner,send,mode);
  const meProfile=contextFor(audit,me),otherProfile=contextFor(audit,partner);
  const allRisks=[...mine.risks.map(x=>"Your team: "+x),...theirs.risks.map(x=>otherProfile.name+": "+x)];
  if(partnerCuts.length)allRisks.push("Other manager must release "+partnerCuts.length+" additional player(s) to execute this package; their lost depth is included.");
  if(myCuts.length)allRisks.push("You must release "+myCuts.length+" additional player(s) to execute this package; lost depth is included.");
  if(changed.myNet<0)allRisks.push("You would have "+Math.abs(changed.myNet)+" empty roster spot"+(changed.myNet===-1?"":"s")+", not automatically valuable");
  if(changed.theirNet<0)allRisks.push("Other manager would have "+Math.abs(changed.theirNet)+" empty roster spot"+(changed.theirNet===-1?"":"s"));
  if(changed.myNet>0)allRisks.push("You receive "+changed.myNet+" net player"+(changed.myNet===1?"":"s")+" and may need cuts to fit roster limits");
  if(changed.theirNet>0)allRisks.push("Other manager receives "+changed.theirNet+" net player"+(changed.theirNet===1?"":"s")+" and may need cuts");
  const positiveMe=mine.reasons.length>0;
  const positivePartner=theirs.reasons.length>0;
  const negativeMe=mine.risks.length>0,negativePartner=theirs.risks.length>0;
  let status="NEEDS FURTHER NEGOTIATION";
  if(positiveMe&&positivePartner&&!negativeMe&&!negativePartner)status="TWO-SIDED ROSTER FIT";
  else if(positiveMe&&!positivePartner)status="YOUR NEED IS CLEAR; THEIRS IS NOT";
  else if(!positiveMe&&positivePartner)status="THEIR NEED IS CLEAR; YOURS IS NOT";
  else if(negativeMe||negativePartner)status="CREATES A DEPTH PROBLEM";
  const why=[];
  if(!positiveMe)why.push("Your roster gains no demonstrated shortage improvement by counts alone");
  if(!positivePartner)why.push("The other manager gains no demonstrated shortage improvement by counts alone");
  if(otherProfile.observedTrades===0)
    why.push("No completed trades observed this season; that does not establish unwillingness");
  else why.push(otherProfile.observedTrades+" completed trade(s) observed this season; willingness on this offer remains unknown");
  // The manager's expressed player/pick wants are never public API facts.
  why.push("Manager wants and negotiating priorities are unknown unless stated by that manager");
  return {status,hasMutualDepthFit:positiveMe&&positivePartner&&!negativeMe&&!negativePartner,
    mine:{...mine,before:preMe,after:postMe,context:meProfile},
    partner:{...theirs,before:prePartner,after:postPartner,context:otherProfile},
    why,risks:allRisks,
    opportunities:[
      "Check free-agent alternatives before trading away a scarce player",
      "Evaluate the actual starter-quality change and market price independently",
      "Ask whether the other manager prefers immediate points, youth, or future picks"
    ],
    evidence:"Counts from current Sleeper-owned roster; lineup requirements; historical scoring; observed completed trades. Preferences are hypotheses, not facts."
  };
}
root.WarRoomTradeFit={assess,depth};
})(typeof globalThis!=="undefined"?globalThis:this);
