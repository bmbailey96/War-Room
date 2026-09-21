// Rebuild the deterministic lineup/injury blueprint for both leagues.
// No live-news model call, so this can run frequently on Sundays.
import lineup from "./lineup.mjs";
import { getMyLeagues } from "./leagues.mjs";

export default async () => {
  const leagues=await getMyLeagues();
  const results=[];
  for(const league of leagues){
    try{
      const req=new Request(
        `https://war-room.local/.netlify/functions/lineup?league=${encodeURIComponent(league.id)}`
      );
      const res=await lineup(req);
      let body=null;
      try{body=await res.json();}catch(e){}
      results.push({
        league:league.name,id:league.id,ok:res.ok,status:res.status,
        week:body?.week??null,
        calls:Array.isArray(body?.calls)?body.calls.length:0
      });
    }catch(e){
      results.push({league:league.name,id:league.id,ok:false,error:e.message});
    }
  }
  return new Response(JSON.stringify({ok:results.every(r=>r.ok),results}),{
    headers:{"content-type":"application/json"}
  });
};

// Every 15 minutes through the main Sunday slate (UTC).
export const config={schedule:"*/15 15-23 * * 0"};
