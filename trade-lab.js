/* Read-only trade laboratory. Every player/pick is selected from a Sleeper
   roster snapshot; history is an observed scoring baseline, not a ROS forecast.
   Portable UMD for browser and Node regression tests. */
(function(root) {
"use strict";
const keyPlayer = p=>"P:"+String(p.id);
const keyPick = p=>"K:"+String(p.key);
const num=x=>x!=null&&Number.isFinite(Number(x))?Number(x):null;
const round=x=>Math.round(x*10)/10;
const isEligible=(p,slot)=>{
  const positions=(p.fantasyPositions||[p.pos]).map(String);
  if(positions.includes(slot))return true;
  if(slot==="FLEX"||slot==="REC_FLEX")return ["RB","WR","TE"].some(x=>positions.includes(x));
  if(slot==="WRRB_FLEX")return ["WR","RB"].some(x=>positions.includes(x));
  if(slot==="SUPER_FLEX")return ["QB","RB","WR","TE"].some(x=>positions.includes(x));
  if(slot==="IDP_FLEX")return ["DL","LB","DB"].some(x=>positions.includes(x));
  return false;
};

function startingBaseline(players,slots) {
  const eligible=(players||[]).filter(p=>!p.onReserve&&!/^(IR|OUT|SUS|PUP|NFI|INACTIVE)$/i.test(p.injury||""));
  const unknown=eligible.filter(p=>p.recentMean==null).map(p=>p.name);
  const useful=eligible.filter(p=>num(p.recentMean)!=null);
  if(slots.length>15)return {score:null,reason:"More than 15 starting slots; observed optimizer disabled",unknown};
  const states=1<<slots.length;
  const dp=new Float64Array(states);
  dp.fill(Number.NEGATIVE_INFINITY); dp[0]=0;
  for(const p of useful){
    const rating=num(p.recentMean);
    for(let mask=states-1;mask>=0;mask--){
      if(dp[mask]===Number.NEGATIVE_INFINITY)continue;
      for(let j=0;j<slots.length;j++){
        const bit=1<<j;
        if(mask&bit||!isEligible(p,slots[j]))continue;
        const after=mask|bit;
        if(dp[after]<dp[mask]+rating)dp[after]=dp[mask]+rating;
      }
    }
  }
  const final=dp[states-1];
  return final===Number.NEGATIVE_INFINITY
    ?{score:null,reason:"Not enough players with 2+ observed game scores to fill every slot",unknown}
    :{score:round(final),reason:"Last four observed league-scored games per player, not a future forecast",unknown};
}

function assetsForTeam(t) {
  return [...(t.players||[]).map(p=>({
    id:keyPlayer(p),type:"player",name:p.name,pos:p.pos,
    age:p.age,injury:p.injury,observedWeeks:p.observedWeeks,
    recentMean:p.recentMean,marketValue:p.marketValue,
    player:p
  })),...(t.picks||[]).map(p=>({
    id:keyPick(p),type:"pick",name:p.season+" R"+p.round+" ("+p.originalTeam+")",
    marketValue:p.marketValue,pick:p
  }))];
}

function evaluate(league,meId,partnerId,sendIds=[],receiveIds=[]) {
  const t=league?.tradeInventory?.teams||[];
  const me=t.find(x=>String(x.rosterId)===String(meId));
  const partner=t.find(x=>String(x.rosterId)===String(partnerId));
  if(!me||!partner||me===partner)return {ok:false,error:"Pick two different, verified league rosters"};
  const ours=assetsForTeam(me),theirs=assetsForTeam(partner);
  const sSet=new Set(sendIds),rSet=new Set(receiveIds);
  const send=ours.filter(a=>sSet.has(a.id)),receive=theirs.filter(a=>rSet.has(a.id));
  if(!send.length||!receive.length)return {ok:false,error:"Select at least one asset from each side"};
  if(send.length!==sSet.size||receive.length!==rSet.size)return {ok:false,error:"A selected asset is not owned by the assigned team"};
  if(send.length>4||receive.length>4)return {ok:false,error:"Limit each side to four assets per experiment"};
  const myBefore=startingBaseline(me.players,league.league.activeSlots||[]);
  const theirBefore=startingBaseline(partner.players,league.league.activeSlots||[]);
  const myAfterPlayers=me.players.filter(p=>!sSet.has(keyPlayer(p))).concat(receive.filter(a=>a.type==="player").map(a=>a.player));
  const theirAfterPlayers=partner.players.filter(p=>!rSet.has(keyPlayer(p))).concat(send.filter(a=>a.type==="player").map(a=>a.player));
  const myAfter=startingBaseline(myAfterPlayers,league.league.activeSlots||[]);
  const theirAfter=startingBaseline(theirAfterPlayers,league.league.activeSlots||[]);
  const incoming=receive.filter(a=>a.type==="player").length,outgoing=send.filter(a=>a.type==="player").length;
  const numValue=arr=>arr.some(x=>num(x.marketValue)==null)?null:round(arr.reduce((total,a)=>total+num(a.marketValue),0));
  const sentValue=numValue(send),receivedValue=numValue(receive);
  const mode=league.league?.mode||"UNKNOWN";
  const baselineReady=[myBefore,theirBefore,myAfter,theirAfter].every(x=>x.score!=null);
  const risks=[];
  if(!baselineReady)risks.push("Observed scoring coverage is incomplete; there is no defensible projected lineup gain.");
  else risks.push("Lineup changes use recent league-scored output, not future projections or injury-adjusted rankings.");
  if(mode==="DYNASTY"&&(sentValue==null||receivedValue==null))
    risks.push("At least one dynasty asset lacks a current market value. Fairness cannot be calculated.");
  else if(mode==="DYNASTY")risks.push("DynastyProcess 1QB values are reference prices, not proof the trade is fair in this league.");
  if(incoming!==outgoing)risks.push("You gain "+(incoming-outgoing)+" net roster spots; the other manager gains "+(outgoing-incoming)+". Roster limits and any required drops are not simulated.");
  if(send.some(a=>a.type==="pick")||receive.some(a=>a.type==="pick"))
    risks.push("Pick valuation assumes a generic round; original team strength, future pick range, and manager preference are not priced.");
  if(send.concat(receive).some(a=>a.injury))risks.push("An included player carries an injury designation. Verify official status.");
  const myDelta=baselineReady?round(myAfter.score-myBefore.score):null;
  const partnerDelta=baselineReady?round(theirAfter.score-theirBefore.score):null;
  const fit=root.WarRoomTradeFit?.assess({audit:league,me,partner,send,receive})||null;
  return {
    ok:true,
    owner:me.name,partner:partner.name,
    send:send.map(a=>({id:a.id,type:a.type,name:a.name,pos:a.pos||null,value:a.marketValue??null})),
    receive:receive.map(a=>({id:a.id,type:a.type,name:a.name,pos:a.pos||null,value:a.marketValue??null})),
    evidence:{inventoryAt:league.tradeInventory.at,marketDate:league.tradeInventory.marketSourceDate},
    twoSidedFit:fit,
    historicalBaseline:baselineReady?{
      myBefore:myBefore.score,myAfter:myAfter.score,myDelta,
      theirBefore:theirBefore.score,theirAfter:theirAfter.score,theirDelta:partnerDelta,
    }:null,
    unpricedBaseline:baselineReady?null:{
      myBefore:myBefore.reason,theirBefore:theirBefore.reason,
      myAfter:myAfter.reason,theirAfter:theirAfter.reason
    },
    market:mode==="DYNASTY"?{
      sentValue,receivedValue,
      netValue:sentValue!=null&&receivedValue!=null?round(receivedValue-sentValue):null,
      priced:sentValue!=null&&receivedValue!=null
    }:null,
    rosterSlots:{myNet:incoming-outgoing,partnerNet:outgoing-incoming},
    risks,
    classification:"RESEARCH / NOT A TRADE RECOMMENDATION",
  };
}
root.WarRoomTradeLab={evaluate,assetsForTeam,startingBaseline,keyPlayer,keyPick};
})(typeof globalThis!=="undefined"?globalThis:this);
