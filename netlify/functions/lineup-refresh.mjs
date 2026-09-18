// Scheduled pregame freezer for both leagues.
//
// This runs cheaply every three hours on every day of the week so Saturday,
// holiday and international-game slates do not fall through a Sun/Mon/Thu
// calendar assumption. The deterministic lineup is frozen each pass. The
// expensive live-news reasoning runs only when one of my unlocked players is
// within a few hours of kickoff.

import lineup from "./lineup.mjs";
import analyze from "./lineup-analysis.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { freezePregame } from "./lib/freeze-v2.mjs";

const REASONING_WINDOW_MS=4.5*60*60*1000;

export function isReasoningWindow(data,now=Date.now()){
  return (data?.players||[]).some(p=>{
    if(p.locked || !p.kickoffAt)return false;
    const kickoff=new Date(p.kickoffAt).getTime();
    const gap=kickoff-now;
    return Number.isFinite(kickoff) && gap>=0 && gap<=REASONING_WINDOW_MS;
  });
}

export default async () => {
  const leagues=await getMyLeagues();
  const results=[];

  for(const league of leagues){
    try{
      const url=`https://war-room.local/.netlify/functions/lineup?league=${encodeURIComponent(league.id)}`;
      const req=new Request(url);
      const baseRes=await lineup(req);
      const data=await baseRes.json();

      if(!baseRes.ok || data?.error){
        results.push({league:league.name,id:league.id,ok:false,status:baseRes.status,error:data?.error||"lineup failed"});
        continue;
      }

      // Freeze numerical beliefs regardless of whether an AI/news call is
      // warranted. Later passes overwrite only players who are still unlocked.
      let frozen=await freezePregame(data,null);
      let summary="projection frozen; outside live-news window";
      let reasoningRan=false;
      let analysisOk=true;

      if(isReasoningWindow(data)){
        reasoningRan=true;
        const analysisReq=new Request(
          `https://war-room.local/.netlify/functions/lineup-analysis?league=${encodeURIComponent(league.id)}&refresh=1`
        );
        const res=await analyze(analysisReq);
        let body=null;
        try{body=await res.json();}catch(e){}

        // lineup-analysis returns its computed projection even if the news call
        // fails, but the numerical snapshot above is already safe either way.
        if(body?.analysis){
          frozen=await freezePregame(body.projection||data,body.analysis);
          summary=body.analysis.summary||"pregame reasoning frozen";
        }else{
          analysisOk=false;
          summary=body?.error||"live-news reasoning failed; numerical snapshot still frozen";
        }
      }

      results.push({
        league:league.name,id:league.id,
        ok:baseRes.ok && analysisOk,
        reasoningRan,
        summary,
        frozen,
      });
    }catch(e){
      results.push({league:league.name,id:league.id,ok:false,error:e.message});
    }
  }

  return new Response(JSON.stringify({ok:results.every(r=>r.ok),results}),{
    headers:{"content-type":"application/json"}
  });
};

// Three-hour cadence is frequent enough to land before all normal NFL kickoff
// windows while avoiding assumptions about which weekdays contain games.
export const config={schedule:"30 */3 * * *"};
