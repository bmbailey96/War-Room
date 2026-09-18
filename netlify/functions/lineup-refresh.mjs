// Scheduled pregame snapshots for both leagues.
// This gives the learner a real "what did we believe before kickoff?" record
// even on weeks when the site is never opened manually.

import analyze from "./lineup-analysis.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { freezePregame } from "./lib/freeze-v2.mjs";

export default async () => {
  const leagues=await getMyLeagues();
  const results=[];
  for(const league of leagues){
    try{
      const req=new Request(
        `https://war-room.local/.netlify/functions/lineup-analysis?league=${encodeURIComponent(league.id)}&refresh=1`
      );
      const res=await analyze(req);
      let body=null;
      try{body=await res.json();}catch(e){}

      // Freeze whatever deterministic projection we successfully built even
      // when the live-news reasoning layer fails. Reasoning is attached only
      // when it also completed successfully.
      let frozen=null;
      if(body?.projection){
        frozen=await freezePregame(body.projection,body.analysis||null);
      }

      results.push({
        league:league.name,id:league.id,ok:res.ok,status:res.status,
        summary:body?.analysis?.summary||body?.error||null,
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

// Several snapshots on game days. The projection log only overwrites players
// whose games have not started, so each player's last saved state is naturally
// the last pre-kickoff state rather than hindsight.
export const config={schedule:"30 15,16,19,22 * * 0,1,4"};
