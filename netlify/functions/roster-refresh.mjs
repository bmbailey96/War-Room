// Precompute deterministic roster moves for both leagues without spending AI credits.
// The interactive page can still request the live-news reasoning layer separately.

import { getMyLeagues } from "./leagues.mjs";
import buildRosterActions from "./roster-actions-background.mjs";

export default async () => {
  const leagues=await getMyLeagues();
  const results=[];

  for(const league of leagues){
    try{
      const req=new Request(
        `https://war-room.local/.netlify/functions/roster-actions-background?league=${encodeURIComponent(league.id)}&refresh=1&core=1`
      );
      const res=await buildRosterActions(req);
      let body=null;
      try{body=await res.json();}catch(e){}
      results.push({
        league:league.name,id:league.id,ok:res.ok,status:res.status,
        mode:body?.league?.mode||null,
        summary:body?.summary||body?.error||null,
        actions:Array.isArray(body?.actions)?body.actions.length:0,
      });
    }catch(e){
      results.push({league:league.name,id:league.id,ok:false,error:e.message});
    }
  }

  return new Response(JSON.stringify({ok:results.every(r=>r.ok),results}),{
    headers:{"content-type":"application/json"}
  });
};

// Morning Mountain-time-ish refresh. It is deliberately deterministic/core-only,
// so it remains useful when Anthropic is unavailable and costs no AI credits.
export const config={schedule:"15 13 * * *"};
