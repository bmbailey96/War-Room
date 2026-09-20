import { store } from "./lib/war-v2.mjs";
import { getMyLeagues } from "./leagues.mjs";
import { rosterActionsCacheKey,rosterActionsLockKey } from "./lib/roster-cache.mjs";

export default async req=>{
  try{
    const url=new URL(req.url);
    const leagues=await getMyLeagues();
    const requested=url.searchParams.get("league");
    const chosen=leagues.find(l=>l.id===requested)||leagues[0];
    if(!chosen)return new Response(JSON.stringify({error:"no league"}),{status:404});

    const s=store();
    const cacheKey=rosterActionsCacheKey(chosen.id);
    const lockKey=rosterActionsLockKey(chosen.id);
    const [cached,lock]=await Promise.all([
      s.get(cacheKey,{type:"json"}).catch(()=>null),
      s.get(lockKey,{type:"json"}).catch(()=>null),
    ]);
    const force=url.searchParams.get("refresh")==="1";
    const coreOnly=url.searchParams.get("core")==="1";
    const stale=!cached||Date.now()-(cached.at||0)>4*60*60*1000;
    const locked=lock&&Date.now()-(lock.at||0)<10*60*1000;
    const shouldTrigger=(force||stale)&&!locked;

    if(shouldTrigger){
      await s.setJSON(lockKey,{at:Date.now()}).catch(()=>{});
      const base=url.origin;
      const r=await fetch(
        `${base}/.netlify/functions/roster-actions-background?league=${encodeURIComponent(chosen.id)}&refresh=1${coreOnly?"&core=1":""}`
      ).catch(()=>null);
      if(!r||!r.ok){
        await s.delete(lockKey).catch(()=>{});
      }
    }

    if(cached){
      return new Response(JSON.stringify({
        ...cached,
        refreshing:shouldTrigger||locked||stale
      }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
    }

    return new Response(JSON.stringify({
      status:"building",
      refreshing:true,
      league:{id:chosen.id,name:chosen.name}
    }),{
      status:202,
      headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }catch(e){
    return new Response(JSON.stringify({error:e.message}),{
      status:502,headers:{"content-type":"application/json"}
    });
  }
};
