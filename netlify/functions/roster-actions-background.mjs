import {
  MY_USER_ID,fetchLeagueCore,computeSnapshot,normName
} from "./lib/ocho.mjs";
import {
  getPlayersTrim,pInfo,slotPos,store,callClaude
} from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import lineup, { scoreSleeperProjection } from "./lineup.mjs";
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
    pid,name:p.name,pos:slotPos(p),team:p.team,age:p.age,injury:p.inj||null,
    next3:proj[pid]?.avg??0,weeks:proj[pid]?.weeks||{}
  };
}
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
      ...p,next3:proj[p.pid]?.avg??0,weeks:proj[p.pid]?.weeks||{},
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
      players:t.players.map(p=>({...p,next3:proj[p.pid]?.avg??0,market:mode==="DYNASTY"?marketValue(p.name):null})),
      picks:mode==="DYNASTY"?t.picks.map(enrichPick):[]
    }));
    const myPicks=mode==="DYNASTY"?me.picks.map(enrichPick):[];
    const myNames=new Set(myRoster.map(p=>normName(p.name)));
    const freeNames=new Set(free.map(p=>normName(p.name)));
    const teamPlayers=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.players.map(p=>normName(p.name)))]));
    const teamPicks=Object.fromEntries(otherTeams.map(t=>[t.name,new Set(t.picks.map(p=>p.name))]));
    const myPickNames=new Set(myPicks.map(p=>p.name));

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

ACTUALLY UNROSTERED CANDIDATES:
${JSON.stringify(free,null,2)}

${mode==="DYNASTY"?`MY ACTUAL PICKS (only these may be spent):
${JSON.stringify(myPicks,null,2)}`:""}

OTHER TEAMS, THEIR ROSTERS, NEEDS AND PICKS:
${JSON.stringify(otherTeams,null,2)}

Use web search for current injury/practice news, depth-chart movement, snap/route/target role, coaching comments, scheme changes, and current trade-market sentiment. Be selective. HOLD is valid.

Hard rules:
- A pickup must be from ACTUALLY UNROSTERED CANDIDATES.
- If an add needs a roster spot, give an exact drop from MY ROSTER.
- A trade target must be on the named partner's roster.
- I can only send assets I actually own.
- In dynasty, only use the exact pick labels listed under MY ACTUAL PICKS.
- In redraft, never use draft picks.
- Give at most 5 actions, ordered by importance.
- For a trade, explain briefly why the other manager might accept.
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

    const actions=validateActions(parsed.actions,{
      myNames,freeNames,teamPlayers,teamPicks,myPicks:myPickNames,dynasty:mode==="DYNASTY"
    });
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
