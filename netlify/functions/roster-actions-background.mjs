import {
  MY_USER_ID,fetchLeagueCore,computeSnapshot,normName
} from "./lib/ocho.mjs";
import {
  getPlayersTrim,pInfo,slotPos,store,callClaude
} from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import lineup, { scoreSleeperProjection, optimize } from "./lineup.mjs";
import { detectLeagueMode,validateActions } from "./lib/roster-v2.mjs";
import { getDynastyMarket,pickValue } from "./lib/market-v2.mjs";

async function j(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const n=v=>v==null||v===""||Number.isNaN(+v)?0:+v;
const round=x=>Math.round(x*10)/10;
function hardInjured(status){
  return /\b(out|ir|pup|sus|suspended|doubtful)\b/i.test(String(status||""));
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
async function projectionMap(season,week,league,db){
  const weeks=[week,week+1,week+2].filter(w=>w<=18);
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
      const rec=out[pid]||(out[pid]={weeks:{},avg:0});
      rec.weeks[wk]=round(pts);
    }
  });
  for(const rec of Object.values(out)){
    const vals=Object.values(rec.weeks);
    rec.avg=vals.length?round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
  }
  return out;
}
function playerView(pid,db,proj){
  const p=pInfo(db,pid);
  return {
    pid,name:p.name,pos:slotPos(p),eligibleSlots:p.fps||[],team:p.team,age:p.age,injury:p.inj||null,
    next3:proj[pid]?.avg??0,weeks:proj[pid]?.weeks||{}
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

function fallbackAction(free,drops){
  if(!free.length)return {summary:"No urgent roster move.",actions:[{type:"HOLD",priority:1,confidence:"LOW",headline:"Hold",why:"No available player cleared the deterministic screen."}],watch:[]};
  return {
    summary:`Best available screen: ${free[0].name}.`,
    actions:[{
      type:"ADD_DROP",priority:1,confidence:"LOW",
      headline:`Add ${free[0].name}${drops[0]?`, drop ${drops[0].name}`:""}`,
      why:"Fallback recommendation because the live reasoning layer did not return valid structured output.",
      add:{name:free[0].name},drop:drops[0]?{name:drops[0].name}:null,window:"WATCH",drivers:["depth"]
    }],
    watch:[]
  };
}

export default async req=>{
  try{
    const url=new URL(req.url),force=url.searchParams.get("refresh")==="1";
    const leagues=await getMyLeagues();
    const requested=url.searchParams.get("league");
    const chosen=leagues.find(l=>l.id===requested)||leagues[0];
    if(!chosen)return new Response(JSON.stringify({error:"no league"}),{status:404});

    const s=store(),cacheKey=`roster_actions_${chosen.id}`;
    const cached=await s.get(cacheKey,{type:"json"}).catch(()=>null);
    if(!force&&cached&&Date.now()-(cached.at||0)<4*60*60*1000){
      return new Response(JSON.stringify(cached),{headers:{"content-type":"application/json","cache-control":"no-store"}});
    }

    const [core,db]=await Promise.all([fetchLeagueCore(chosen.id),getPlayersTrim()]);
    const league=core.league,snapshot=computeSnapshot(core,db);
    const me=snapshot.teams.find(t=>t.isMe);
    if(!me)throw new Error("my roster missing");
    const mode=detectLeagueMode(league);
    const week=Number(core.nflState?.week)||1,season=Number(core.nflState?.season)||Number(league.season);
    const [proj,lineupData,market]=await Promise.all([
      projectionMap(season,week,league,db),
      lineup(new Request(`${url.origin}/.netlify/functions/lineup?league=${encodeURIComponent(chosen.id)}`))
        .then(r=>r.json()).catch(()=>null),
      mode==="DYNASTY"?getDynastyMarket(s):Promise.resolve({players:{},picks:{},scrapeDate:null})
    ]);
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
    const topProj=Object.entries(proj).sort((a,b)=>(b[1].avg||0)-(a[1].avg||0)).slice(0,220).map(([pid])=>pid);
    const candidateIds=[...new Set([...(core.trending||[]).map(x=>x.player_id),...topProj])]
      .filter(pid=>pid&&!rostered.has(pid));

    let free=candidateIds.map(pid=>{
      const p=playerView(pid,db,proj),trend=trendById[pid]||0;
      const mv=mode==="DYNASTY"?marketValue(p.name):null;
      const ageBonus=mode==="DYNASTY"&&p.age?Math.max(-5,Math.min(6,(27-p.age)*1.1)):0;
      const score=mode==="DYNASTY"
        ? (mv??0)*.7+(p.next3||0)*1.25+Math.log10(1+trend)*3+ageBonus
        : (p.next3||0)*4+Math.log10(1+trend)*3;
      return {...p,market:mv,trending:trend,screenScore:round(score)};
    }).filter(p=>p.name&&p.team&&!hardInjured(p.injury))
      .sort((a,b)=>b.screenScore-a.screenScore).slice(0,24);

    const myRoster=me.players.map(p=>({
      ...p,eligibleSlots:p.fps||[],next3:proj[p.pid]?.avg??0,weeks:proj[p.pid]?.weeks||{},
      market:mode==="DYNASTY"?marketValue(p.name):null
    }));
    const starterSet=new Set(snapshot.matchup?.myStarters||[]);
    const drops=myRoster.filter(p=>!starterSet.has(p.name)&&!p.onIR)
      .map(p=>({...p,dropScore:mode==="DYNASTY"?(p.market??0)*.75+(p.next3||0)*1.5:(p.next3||0)}))
      .sort((a,b)=>a.dropScore-b.dropScore).slice(0,10);

    const enrichPick=p=>{
      const tier=tierOfOriginal(p.original);
      return {name:pickLabel(p),type:"pick",season:p.season,round:p.round,tier,value:pickValue(p,market,tier)};
    };
    const otherTeams=snapshot.teams.filter(t=>!t.isMe).map(t=>({
      name:t.name,record:`${t.wins}-${t.losses}`,stance:t.stance,
      holes:t.holes,surplus:t.surplus,
      players:t.players.map(p=>({...p,eligibleSlots:p.fps||[],next3:proj[p.pid]?.avg??0,market:mode==="DYNASTY"?marketValue(p.name):null})),
      picks:mode==="DYNASTY"?t.picks.map(enrichPick):[]
    }));
    const myPicks=mode==="DYNASTY"?me.picks.map(enrichPick):[];
    const myNames=new Set(myRoster.map(p=>normName(p.name)));
    const freeNames=new Set(free.map(p=>normName(p.name)));
    const teamPlayers=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.players.map(p=>normName(p.name)))]));
    const teamPicks=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.picks.map(p=>p.name))]));
    const myPickNames=new Set(myPicks.map(p=>p.name));

    const activeSlots=(league.roster_positions||[]).filter(s=>!["BN","IR","TAXI"].includes(s));
    const baselineRosterTotal=simTotal(myRoster,activeSlots);

    const waiverPairs=[];
    for(const add of free.slice(0,18)){
      for(const drop of drops.slice(0,8)){
        if(add.pid===drop.pid)continue;
        const after=simTotal(rosterAfter(myRoster,{removeNames:[drop.name],addPlayers:[add]}),activeSlots);
        const weeklyDelta=round(after-baselineRosterTotal);
        const marketDelta=mode==="DYNASTY"&&add.market!=null&&drop.market!=null?add.market-drop.market:null;
        const score=mode==="DYNASTY"
          ? weeklyDelta*5+(marketDelta??0)*.35+(add.screenScore-drop.dropScore)*.08
          : weeklyDelta*8+(add.next3-drop.next3)*1.5+Math.log10(1+add.trending)*2;
        waiverPairs.push({
          add:add.name,drop:drop.name,pos:add.pos,weeklyDelta,marketDelta,
          score:round(score),addNext3:add.next3,dropNext3:drop.next3,
          addMarket:add.market,dropMarket:drop.market,trending:add.trending
        });
      }
    }
    waiverPairs.sort((a,b)=>b.score-a.score);
    const bestWaiverPairs=waiverPairs
      .filter(x=>x.weeklyDelta>0 || (mode==="DYNASTY"&&(x.marketDelta??0)>=8))
      .slice(0,12);

    const tradeTargets=[];
    for(const team of otherTeams){
      for(const p of team.players){
        if(hardInjured(p.injury))continue;
        const after=simTotal(rosterAfter(myRoster,{addPlayers:[p]}),activeSlots);
        const weeklyCeiling=round(after-baselineRosterTotal);
        if(weeklyCeiling<=0.2 && mode!=="DYNASTY")continue;
        tradeTargets.push({
          partner:team.name,name:p.name,pos:p.pos,age:p.age,next3:p.next3,
          market:p.market,weeklyCeiling,partnerHoles:team.holes,partnerSurplus:team.surplus
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

DETERMINISTIC ADD/DROP PAIRS, ordered by real best-lineup impact:
${JSON.stringify(bestWaiverPairs,null,2)}

ACTUALLY UNROSTERED CANDIDATES:
${JSON.stringify(free,null,2)}

DETERMINISTIC TRADE TARGET SCREEN (weeklyCeiling = max three-week lineup gain before acquisition cost):
${JSON.stringify(bestTradeTargets,null,2)}

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
- Prefer trade targets from the deterministic TRADE TARGET SCREEN.
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
    try{
      const raw=await callClaude(prompt,{maxTokens:3000,useSearch:true});
      parsed=parseJson(raw);
      if(!parsed)throw new Error("invalid roster-actions JSON");
    }catch(e){error=e.message;}
    if(!parsed)parsed=fallbackAction(free,drops);

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
        return {...a,weeklyDelta,marketDelta};
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
        return {...a,weeklyDelta,partnerWeeklyDelta,sendValue,receiveValue,marketDelta};
      }
      return a;
    }).filter(a=>{
      if(a.invalidMath)return false;
      if(["ADD","WAIVER","ADD_DROP"].includes(a.type)){
        return (a.weeklyDelta??0)>.15 || (mode==="DYNASTY"&&(a.marketDelta??0)>=6);
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
    const result={
      at:Date.now(),league:{id:chosen.id,name:league.name,mode,week,season},
      summary:parsed.summary||actions[0]?.headline||"No urgent roster move.",
      actions:actions.length?actions:fallbackAction(free,drops).actions,
      watch:Array.isArray(parsed.watch)?parsed.watch.slice(0,3):[],
      context:{
        freeAgentsScreened:free.length,
        waiverPosition:me.waiverPosition??null,
        myPicks,
        marketDate:market.scrapeDate||null,
        baselineNext3Lineup:baselineRosterTotal,
        deterministicWaiverPairs:bestWaiverPairs.slice(0,5),
        deterministicTradeTargets:bestTradeTargets.slice(0,8),
      },
      error
    };

    await s.setJSON(cacheKey,result);
    await s.delete(`roster_actions_refresh_${chosen.id}`).catch(()=>{});
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
