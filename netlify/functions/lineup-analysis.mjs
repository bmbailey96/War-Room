// Current lineup guidance plus dated public news. No paid AI calls.
import lineup from "./lineup.mjs";
import { store } from "./lib/war-v2.mjs";
import { readNewsFeeds, matchRosterNews } from "./lib/news-v2.mjs";

export function deterministicAnalysis(data) {
  const calls=(data.calls||[]).map(c=>{
    const edge=c.edge==null?null:Number(c.edge);
    const prob=c.beatProbability==null?null:Number(c.beatProbability);
    const start=c.start?.name||"";
    const sit=c.sit?.name||null;
    const confidence=c.decisionConfidence||c.start?.confidence||"MEDIUM";
    const bits=[];
    if(edge!=null)bits.push(`${edge>=0?"+":""}${edge.toFixed(1)} projected-point edge`);
    if(c.strategic&&c.riskEdge!=null){
      bits.push(`${c.riskEdge>=0?"+":""}${Number(c.riskEdge).toFixed(1)} ${c.posture==="protect_floor"?"floor":"ceiling"} edge`);
    }
    if(prob!=null)bits.push(`${Math.round(prob)}% better-outlook estimate`);
    if(c.start?.injury)bits.push(`${start} is listed ${c.start.injury}`);
    return {
      start,sit,slot:c.slot,
      verdict:c.actionable===false?"LEAN":"START",
      actionable:c.actionable!==false,
      callStrength:c.callStrength||null,
      confidence,
      why:c.actionable===false
        ? `${bits.join("; ")}. This is inside the model's no-churn threshold, so hold unless new information changes it.`
        : bits.length
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

  const topAction=calls.find(x=>x.actionable);
  const topLean=calls.find(x=>!x.actionable);
  return {
    summary:topAction
      ? `Start ${topAction.start}${topAction.sit?` over ${topAction.sit}`:""}.`
      : (data.unfilledSlots||[]).length
        ? `Unfilled ${data.unfilledSlots.join(" / ")} slot. Find an available starter.`
      : topLean
        ? `Hold the lineup. ${topLean.start} over ${topLean.sit||"the current option"} is only a lean.`
        : "Keep the lineup as it is.",
    confidence:(topAction||topLean)?.confidence||"MEDIUM",
    calls,
    watch,
  };
}

export default async req => {
  try {
    const baseResponse=await lineup(req);
    const data=await baseResponse.json();
    if(!baseResponse.ok||data.error)return new Response(JSON.stringify(data),{status:baseResponse.status||502,headers:{"content-type":"application/json"}});
    const feeds=await readNewsFeeds(store());
    const news=matchRosterNews(feeds,data.players||[]);
    // Recompute from today's legal lineup, never reuse a cached start/sit judgment.
    // Feed matches are evidence to read, not independent AI calls for the learner.
    return new Response(JSON.stringify({
      at:Date.now(),leagueId:data.league.id,week:data.week,
      analysis:deterministicAnalysis(data),projection:data,news,
      reasoningMode:"public_news",reasoningAvailable:false,reasoningError:null,
    }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(e){return new Response(JSON.stringify({error:e.message}),{status:502,headers:{"content-type":"application/json"}})}
};
