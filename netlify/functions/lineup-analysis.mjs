// Live-news judgment layer for the focused lineup engine.
// Arithmetic comes from lineup.mjs. This call only decides whether current
// reporting gives us a concrete reason to distrust or override that number.

import lineup from "./lineup.mjs";
import { store, callClaude } from "./lib/war-v2.mjs";

function parseJson(text) {
  if (!text) return null;
  let s=text.replace(/```json|```/gi,"").trim();
  const a=s.indexOf("{"), b=s.lastIndexOf("}");
  if(a<0 || b<a) return null;
  try { return JSON.parse(s.slice(a,b+1)); } catch(e) { return null; }
}

export function deterministicAnalysis(data) {
  const calls=(data.calls||[]).map(c=>{
    const edge=c.edge==null?null:Number(c.edge);
    const prob=c.beatProbability==null?null:Number(c.beatProbability);
    const start=c.start?.name||"";
    const sit=c.sit?.name||null;
    const confidence=c.decisionConfidence||c.start?.confidence||"MEDIUM";
    const bits=[];
    if(edge!=null)bits.push(`${edge>=0?"+":""}${edge.toFixed(1)} projected-point edge`);
    if(prob!=null)bits.push(`${Math.round(prob)}% better-outlook estimate`);
    if(c.start?.injury)bits.push(`${start} is listed ${c.start.injury}`);
    return {
      start,sit,slot:c.slot,
      verdict:"START",
      confidence,
      why:bits.length
        ? `${bits.join("; ")}. No live-news override was applied.`
        : "Best legal lineup from the deterministic engine. No live-news override was applied.",
      sourceDate:null,
      drivers:["projection_only"],
    };
  });

  const watch=[];
  const seen=new Set();

  for(const x of data.flexMoves||[]){
    if(!x?.message)continue;
    watch.push(`FLEX // ${x.message.replace(/^FLEX\s*\/\/\s*/i,"")}`);
    if(watch.length>=4)break;
  }
  for(const x of data.contingencies||[]){
    if(watch.length>=4)break;
    if(!x?.message)continue;
    watch.push(x.message);
    if(x.starter)seen.add(String(x.starter).toLowerCase());
  }
  for(const p of data.players||[]){
    if(watch.length>=4)break;
    const status=String(p.injury||"");
    if(!status || !/question|doubt|out|ir|pup|sus/i.test(status))continue;
    const key=(p.name||"").toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    const practice=p.practiceStatus?` // ${p.practiceStatus}`:"";
    watch.push(`${p.name}: ${status}${practice}`);
  }

  const top=calls[0];
  return {
    summary:top
      ? `Start ${top.start}${top.sit?` over ${top.sit}`:""}.`
      : "Keep the lineup as it is.",
    confidence:top?.confidence||"MEDIUM",
    calls,
    watch,
  };
}

export default async req => {
  try {
    const baseResponse=await lineup(req);
    const data=await baseResponse.json();
    if(!baseResponse.ok || data.error) {
      return new Response(JSON.stringify(data),{status:baseResponse.status||502,headers:{"content-type":"application/json"}});
    }

    const url=new URL(req.url);
    const force=url.searchParams.get("refresh")==="1";
    const stateStore=store();
    const reasoningModel=await stateStore.get(`reasoning_${data.league.id}`,{type:"json"}).catch(()=>null);
    const cacheKey=`analysis_${data.league.id}_${data.week}`;
    const cached=await stateStore.get(cacheKey,{type:"json"}).catch(()=>null);
    if(!force && cached && Date.now()-cached.at < 4*60*60*1000) {
      return new Response(JSON.stringify({...cached,projection:data}),{
        headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }

    const current=(data.current||[]).filter(x=>x.player).map(x=>({
      slot:x.slot,name:x.player.name,proj:x.player.projection,floor:x.player.floor,ceiling:x.player.ceiling,
      opp:x.player.opp,injury:x.player.injury,confidence:x.player.confidence,confidenceScore:x.player.confidenceScore,
      source:x.player.source,rangeSource:x.player.rangeSource,reasons:x.player.reasons,
      coverageMatchup:x.player.signals?.coverageMatchup||null,
      passRush:x.player.signals?.passRush||null,
      opportunityShare:x.player.signals?.opportunityShare??null,
      opportunityLabel:x.player.signals?.opportunityLabel||null,
      matchupExposure:x.player.signals?.matchupExposure??1
    }));
    const bench=(data.players||[])
      .filter(p=>!(data.current||[]).some(x=>x.player?.pid===p.pid))
      .sort((a,b)=>(b.projection||0)-(a.projection||0))
      .slice(0,12)
      .map(p=>({name:p.name,pos:p.slot,proj:p.projection,floor:p.floor,ceiling:p.ceiling,opp:p.opp,injury:p.injury,
        confidence:p.confidence,confidenceScore:p.confidenceScore,source:p.source,rangeSource:p.rangeSource,reasons:p.reasons,
        coverageMatchup:p.signals?.coverageMatchup||null,
        passRush:p.signals?.passRush||null,
        opportunityShare:p.signals?.opportunityShare??null,
        opportunityLabel:p.signals?.opportunityLabel||null,
        matchupExposure:p.signals?.matchupExposure??1}));
    const computed=(data.calls||[]).map(c=>({
      start:c.start?.name,sit:c.sit?.name,slot:c.slot,
      edge:c.edge,beatProbability:c.beatProbability,decisionConfidence:c.decisionConfidence,
      startProjection:c.start?.projection,startFloor:c.start?.floor,startCeiling:c.start?.ceiling,startSource:c.start?.source,
      startCoverage:c.start?.signals?.coverageMatchup||null,
      startPassRush:c.start?.signals?.passRush||null,
      startOpportunityShare:c.start?.signals?.opportunityShare??null,
      startMatchupExposure:c.start?.signals?.matchupExposure??1,
      sitProjection:c.sit?.projection,sitFloor:c.sit?.floor,sitCeiling:c.sit?.ceiling,sitSource:c.sit?.source,
      sitCoverage:c.sit?.signals?.coverageMatchup||null,
      sitPassRush:c.sit?.signals?.passRush||null,
      sitOpportunityShare:c.sit?.signals?.opportunityShare??null,
      sitMatchupExposure:c.sit?.signals?.matchupExposure??1
    }));
    const lockedBench=(data.lockedBench||[]).map(p=>({
      name:p.name,actual:p.actual,team:p.team,kickoffAt:p.kickoffAt
    }));
    const unavailable=(data.players||[])
      .filter(p=>p.availability==="UNAVAILABLE")
      .map(p=>({name:p.name,status:p.injury,injury:p.injuryDetail,practice:p.practiceStatus}));
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

PLAYERS UNAVAILABLE THIS WEEK:
${JSON.stringify(unavailable,null,2)}

DETERMINISTIC LATE-SWAP CONTINGENCIES:
${JSON.stringify(data.contingencies||[],null,2)}

ZERO-POINT FLEX PRESERVATION MOVES:
${JSON.stringify(data.flexMoves||[],null,2)}

YOUR GRADED REASONING TRACK RECORD IN THIS LEAGUE:
${JSON.stringify(learnedDrivers,null,2)}

Rules:
1. Start from the computed lineup. Do not override it for generic matchup talk, reputation, consensus rankings, or vibes.
2. NEVER recommend moving a player whose game has started. A player listed under PLAYERS ALREADY LOCKED ON THE BENCH is history, not an option.
3. NEVER recommend START/HOLD/OVERRIDE in favor of anyone listed under PLAYERS UNAVAILABLE THIS WEEK, even if old projections or reputation favor him.
4. Preserve the deterministic late-swap and FLEX guidance unless current news changes the player's availability. Never tell me to wait on a questionable late player if the listed fallback locks earlier.
5. Override only when you find specific CURRENT evidence the arithmetic does not know, such as a snap limitation, newly won/lost role, return from injury, a scheme change, credible inactive news, or a confirmed shadow/slot coverage assignment.
6. Respect the engine's uncertainty. A LOW decision-confidence call or beat probability near 50% is genuinely close even if the raw point gap looks noticeable. A HIGH-confidence mathematical edge should require strong concrete news to override.
7. If MATCHUP STATE posture is protect_floor, use floor as a tiebreak only for genuinely close calls. If it is chase_ceiling, use ceiling as a tiebreak only for genuinely close calls. Do not sacrifice a clear expected-value edge just to chase variance.
8. Use the graded track record above as calibration, not gospel. If "scheme" is 1/5, demand stronger scheme evidence. If "role" is 8/10, that evidence has earned more trust.
9. A source of "sleeper" is the weakest projection source and should lower confidence. "league_history" is actual scoring from this league and is stronger than a provider fallback, but may still have a thin sample.
10. COVERAGE MATCHUP is an inferred likely assignment from current depth charts plus actual defender coverage results. Its assignmentConfidence is deliberately modest. Treat it as a tiebreaker unless current reporting explicitly confirms a shadow/slot assignment.
11. MATCHUP EXPOSURE scales team/coverage matchup effects by actual target or workload ownership. A low-volume player should not receive the same boost from a soft defense as an alpha player.
12. PASS RUSH is a small opponent pressure edge derived from actual defender pressure production and is already partially reflected in the projection. Do not double-count it.
13. Never claim a defender will shadow a receiver unless current reporting actually says so.
14. Never claim you found news you did not actually find.
15. Keep this brutally scannable.

Return ONLY valid JSON:
{
  "summary":"one sentence with the lineup action that matters most, or 'Keep the lineup' if no change matters",
  "confidence":"HIGH|MEDIUM|LOW",
  "calls":[
    {"start":"name","sit":"name or null","slot":"slot","verdict":"START|HOLD|OVERRIDE","confidence":"HIGH|MEDIUM|LOW","why":"1-2 concrete sentences","sourceDate":"YYYY-MM-DD or null","drivers":["injury|role|depth_chart|scheme|weather|matchup|projection_only"]}
  ],
  "watch":["up to 3 short things to check before kickoff"]
}`;

    let analysis=null,reasoningMode="live_news",reasoningError=null;
    try {
      const raw=await callClaude(prompt,{maxTokens:1500,useSearch:true});
      analysis=parseJson(raw);
      if(!analysis) throw new Error("lineup reasoning returned invalid JSON");
    } catch (err) {
      reasoningMode="deterministic";
      reasoningError=err?.message||String(err);
      analysis=deterministicAnalysis(data);
    }

    const now=Date.now();
    const priorHistory=Array.isArray(cached?.history)
      ? cached.history
      : (cached?.analysis ? [{at:cached.at,analysis:cached.analysis}] : []);

    // Only grade/store true live-news judgments. Deterministic fallback is
    // already represented by the projection engine and should not masquerade
    // as an independent reasoning sample.
    const history=reasoningMode==="live_news"
      ? [...priorHistory,{at:now,analysis}].slice(-30)
      : priorHistory;
    const saved={
      at:now,leagueId:data.league.id,week:data.week,analysis,history,
      reasoningMode,reasoningAvailable:reasoningMode==="live_news",
      reasoningError:reasoningMode==="live_news"?null:reasoningError,
    };
    if(reasoningMode==="live_news")await stateStore.setJSON(cacheKey,saved);
    return new Response(JSON.stringify({...saved,projection:data}),{
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:502,headers:{"content-type":"application/json"}});
  }
};
