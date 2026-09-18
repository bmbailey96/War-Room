// Live-news judgment layer for the focused lineup engine.
// Arithmetic comes from lineup.mjs. This call only decides whether current
// reporting gives us a concrete reason to distrust or override that number.

import lineup, { eligibility } from "./lineup.mjs";
import { store, callClaude, normName } from "./lib/war-v2.mjs";

function parseJson(text) {
  if (!text) return null;
  let s=text.replace(/```json|```/gi,"").trim();
  const a=s.indexOf("{"), b=s.lastIndexOf("}");
  if(a<0 || b<a) return null;
  try { return JSON.parse(s.slice(a,b+1)); } catch(e) { return null; }
}

const DRIVER_KEYS=new Set(["injury","role","depth_chart","scheme","weather","matchup","projection_only"]);
const CONFIDENCE=new Set(["HIGH","MEDIUM","LOW"]);

export function sanitizeAnalysis(analysis,data){
  if(!analysis || !data) return {summary:null,confidence:"LOW",calls:[],watch:[]};

  const byName=new Map((data.players||[]).map(p=>[normName(p.name),p]));
  const current=(data.current||[]).filter(x=>x.player);
  const starterByPid=new Map(current.map(x=>[x.player.pid,x]));
  const starterIds=new Set(starterByPid.keys());
  const calls=[];

  for(const raw of analysis.calls||[]){
    const start=byName.get(normName(raw.start));
    const sit=byName.get(normName(raw.sit));
    if(!start || !sit) continue;
    if(start.pid===sit.pid || start.locked || sit.locked) continue;

    // A live-news override must still describe a move that can be made right
    // now: bench -> current starter, in the starter's currently occupied slot.
    if(starterIds.has(start.pid) || !starterIds.has(sit.pid)) continue;
    const occupied=starterByPid.get(sit.pid);
    if(!occupied || !eligibility(occupied.slot,start)) continue;

    const drivers=[...new Set((raw.drivers||[]).filter(d=>DRIVER_KEYS.has(d)))];
    calls.push({
      start:start.name,
      sit:sit.name,
      slot:occupied.slot,
      verdict:raw.verdict==="OVERRIDE"?"OVERRIDE":"START",
      confidence:CONFIDENCE.has(raw.confidence)?raw.confidence:"LOW",
      why:String(raw.why||"").slice(0,600),
      sourceDate:/^\d{4}-\d{2}-\d{2}$/.test(raw.sourceDate||"")?raw.sourceDate:null,
      drivers:drivers.length?drivers:["projection_only"],
    });
  }

  const watch=(analysis.watch||[])
    .filter(x=>typeof x==="string" && x.trim())
    .slice(0,3)
    .map(x=>x.trim().slice(0,240));

  const summary=calls.length
    ? String(analysis.summary||"Current news supports a lineup change.").slice(0,300)
    : (data.calls?.length
        ? "No current news invalidates the computed lineup changes."
        : "Keep the lineup.");

  return {
    summary,
    confidence:CONFIDENCE.has(analysis.confidence)?analysis.confidence:"LOW",
    calls,
    watch,
  };
}

export default async req => {
  let data=null;
  try {
    const baseResponse=await lineup(req);
    data=await baseResponse.json();
    if(!baseResponse.ok || data.error) {
      return new Response(JSON.stringify(data),{status:baseResponse.status||502,headers:{"content-type":"application/json"}});
    }

    const url=new URL(req.url);
    const force=url.searchParams.get("refresh")==="1";
    const stateStore=store();
    const reasoningModel=await stateStore.get(`reasoning_${data.league.id}`,{type:"json"}).catch(()=>null);
    // This cache is for the live UI only. The learner never reads it.
    // Scheduled pregame freezes live in a separate immutable-ish snapshot.
    const cacheKey=`live_analysis_${data.league.id}_${data.week}`;
    const cached=await stateStore.get(cacheKey,{type:"json"}).catch(()=>null);
    if(!force && cached && Date.now()-cached.at < 4*60*60*1000) {
      const safeAnalysis=sanitizeAnalysis(cached.analysis,data);
      return new Response(JSON.stringify({...cached,analysis:safeAnalysis,projection:data}),{
        headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }

    const current=(data.current||[]).filter(x=>x.player).map(x=>({
      slot:x.slot,name:x.player.name,proj:x.player.projection,floor:x.player.floor,ceiling:x.player.ceiling,
      opp:x.player.opp,injury:x.player.injury,confidence:x.player.confidence,fallback:x.player.fallback,reasons:x.player.reasons
    }));
    const bench=(data.players||[])
      .filter(p=>!p.locked)
      .filter(p=>!(data.current||[]).some(x=>x.player?.pid===p.pid))
      .sort((a,b)=>(b.projection||0)-(a.projection||0))
      .slice(0,12)
      .map(p=>({name:p.name,pos:p.slot,proj:p.projection,floor:p.floor,ceiling:p.ceiling,opp:p.opp,injury:p.injury,confidence:p.confidence,fallback:p.fallback,reasons:p.reasons}));
    const computed=(data.calls||[]).map(c=>({
      start:c.start?.name,sit:c.sit?.name,slot:c.slot,gain:c.gain,
      startProjection:c.start?.projection,sitProjection:c.sit?.projection
    }));
    const lockedBench=(data.lockedBench||[]).map(p=>({
      name:p.name,actual:p.actual,team:p.team,kickoffAt:p.kickoffAt
    }));
    const learnedDrivers=reasoningModel?.drivers||{};

    const prompt=`You are the final sit/start editor for one fantasy football roster. The projection engine below is deterministic and is the default answer. Your job is NOT to make a second projection model or invent a different number. Use web search for current, dated information from this week: injury/practice reports, confirmed role or depth-chart changes, coach statements, expected limitations, inactives, and major scheme changes.

League: ${data.league.name}. NFL week ${data.week}. Opponent: ${data.opponent}.
MATCHUP STATE:
${JSON.stringify(data.matchup||{},null,2)}

Computed current lineup:
${JSON.stringify(current,null,2)}

Best projected lineup changes:
${JSON.stringify(computed,null,2)}

Highest projected bench options:
${JSON.stringify(bench,null,2)}

PLAYERS ALREADY LOCKED ON THE BENCH:
${JSON.stringify(lockedBench,null,2)}

YOUR GRADED REASONING TRACK RECORD IN THIS LEAGUE:
${JSON.stringify(learnedDrivers,null,2)}

Rules:
1. Start from the computed lineup. Do not override it for generic matchup talk, reputation, consensus rankings, or vibes.
2. NEVER recommend moving a player whose game has started. A player listed under PLAYERS ALREADY LOCKED ON THE BENCH is history, not an option.
3. Override only when you find specific CURRENT evidence the arithmetic does not know, such as a snap limitation, newly won/lost role, return from injury, a scheme change, or credible inactive news.
4. If two players are within 1.5 projected points, treat it as a genuine decision. If MATCHUP STATE posture is protect_floor, prefer the stronger floor when evidence is otherwise close. If it is chase_ceiling, prefer the stronger ceiling. If neutral, do not force a risk-style tiebreak.
5. Do not use matchup posture to override a gap larger than 1.5 projected points.
6. Use the graded track record above as calibration, not gospel. If "scheme" is 1/5, demand stronger scheme evidence. If "role" is 8/10, that evidence has earned more trust.
7. If the model used Sleeper fallback for a player, say so and lower confidence.
8. Never claim you found news you did not actually find.
9. Keep this brutally scannable.

Return ONLY valid JSON:
{
  "summary":"one sentence with the lineup action that matters most, or 'Keep the lineup' if no change matters",
  "confidence":"HIGH|MEDIUM|LOW",
  "calls":[
    {"start":"name","sit":"name or null","slot":"slot","verdict":"START|HOLD|OVERRIDE","confidence":"HIGH|MEDIUM|LOW","why":"1-2 concrete sentences","sourceDate":"YYYY-MM-DD or null","drivers":["injury|role|depth_chart|scheme|weather|matchup|projection_only"]}
  ],
  "watch":["up to 3 short things to check before kickoff"]
}`;

    const raw=await callClaude(prompt,{maxTokens:1500,useSearch:true});
    const parsed=parseJson(raw);
    if(!parsed) throw new Error("lineup reasoning returned invalid JSON");
    const analysis=sanitizeAnalysis(parsed,data);
    const saved={at:Date.now(),leagueId:data.league.id,week:data.week,analysis};
    await stateStore.setJSON(cacheKey,saved);
    return new Response(JSON.stringify({...saved,projection:data}),{
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  } catch(e) {
    return new Response(JSON.stringify({
      error:e.message,
      projection:data && !data.error ? data : null,
    }),{status:502,headers:{"content-type":"application/json"}});
  }
};
