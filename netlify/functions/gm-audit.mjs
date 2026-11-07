// Netlify read-only endpoint: a league-wide GM audit built from actual Sleeper
// rosters, weekly matchup scores, completed trades and pick ownership.
// Deliberately no paid LLM, no external rankings and no mutation of Sleeper.
import { getMyLeagues } from "./leagues.mjs";
import { getPlayersTrim, json, store } from "./lib/war-v2.mjs";
import { rosterActionsCacheKey, rosterActionsFreshnessMs } from "./lib/roster-cache.mjs";
import { buildGmAudit } from "./lib/gm-audit-core.mjs";
import { gradeCapturedProjections } from "./lib/gm-calibration.mjs";
import { getDynastyMarket } from "./lib/market-v2.mjs";

const TTL_NORMAL=45*60*1000;
const TTL_GAMEDAY=10*60*1000;
const response=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"},
});

async function optionalJson(url){
  try{return await json(url,1)}catch{return null}
}

export default async function gmAudit(request){
  const url=new URL(request.url);
  const requested=url.searchParams.get("league");
  const force=url.searchParams.get("refresh")==="1";
  let id=null,cache=null;
  const s=store(),now=Date.now();
  try{
    const leagues=await getMyLeagues();
    const chosen=leagues.find(l=>l.id===requested)||(!requested?leagues[0]:null);
    if(!chosen)return response({error:"League not among the owner's Sleeper leagues"},404);
    id=chosen.id;
    const key="gm_audit_v2_"+id;
    cache=await s.get(key,{type:"json"}).catch(()=>null);
    const target=rosterActionsFreshnessMs(now)<=10*60*1000?TTL_GAMEDAY:TTL_NORMAL;
    if(!force&&cache&&now-Number(cache.at||0)<target)
      return response({...cache,cache:{fresh:true,ageMinutes:Math.round((now-cache.at)/60000)}});

    const [league,rosters,users,tradedPicks,nflState,db]=await Promise.all([
      json("https://api.sleeper.app/v1/league/"+id,1),
      json("https://api.sleeper.app/v1/league/"+id+"/rosters",1),
      json("https://api.sleeper.app/v1/league/"+id+"/users",1),
      optionalJson("https://api.sleeper.app/v1/league/"+id+"/traded_picks"),
      optionalJson("https://api.sleeper.app/v1/state/nfl"),
      getPlayersTrim()
    ]);
    const week=Math.max(1,Math.min(19,Number(nflState?.week)||Number(cache?.league?.week)||1));
    const priorWeeks=Array.from({length:week-1},(_,i)=>i+1);
    const [matchups,txns,rosterScan,pregameLogs,market]=await Promise.all([
      Promise.all(priorWeeks.map(w=>optionalJson("https://api.sleeper.app/v1/league/"+id+"/matchups/"+w))),
      Promise.all(priorWeeks.map(w=>optionalJson("https://api.sleeper.app/v1/league/"+id+"/transactions/"+w))),
      s.get(rosterActionsCacheKey(id),{type:"json"}).catch(()=>null),
      Promise.all(priorWeeks.map(w=>s.get("projection_"+id+"_"+w,{type:"json"}).catch(()=>null))),
      Number(league?.settings?.type)===2 || Number(league?.settings?.pick_trading||0)>0?getDynastyMarket(s).catch(()=>null):Promise.resolve(null),
    ]);
    const scanAge=now-Number(rosterScan?.at||0);
    const freshScan=rosterScan&&scanAge>=0&&scanAge<=rosterActionsFreshnessMs(now)*1.5&&!rosterScan.refreshing
      ?rosterScan:null;
    const audit=buildGmAudit({
      league,rosters,users,playersDB:db,tradedPicks:tradedPicks||[],
      weeks:matchups.map((rows,i)=>({week:i+1,rows:rows||[]})),
      transactions:txns.map((rows,i)=>({week:i+1,rows:rows||[]})),
      ownerId:"863128676391383040",now,scan:freshScan,market
    });
    const gradeWeeks=matchups.flatMap((rows,i)=>{
      if(!Array.isArray(rows)||rows.length!==rosters.length)return [];
      const valid=rows.every(r=>{const pts=r?.points??r?.custom_points;return r?.roster_id!=null&&pts!=null&&Number.isFinite(Number(pts))});
      return valid?[{week:i+1,rows}]:[];
    });
    audit.validation=gradeCapturedProjections(
      gradeWeeks,
      Object.fromEntries(pregameLogs.map((log,i)=>[i+1,log])),
      db
    );
    audit.league.week=week;
    audit.coverage.missingMatchupWeeks=matchups.map((x,i)=>x?null:i+1).filter(x=>x!=null);
    audit.coverage.missingTradeWeeks=txns.map((x,i)=>x?null:i+1).filter(x=>x!=null);
    audit.coverage.pickLedgerVerified=tradedPicks!=null;
    if(!tradedPicks&&audit.league.mode==="DYNASTY"){
      audit.me.picks=[];
      for(const team of audit.tradeInventory?.teams||[])team.picks=[];
      audit.limitations.unshift("Traded-picks endpoint unavailable. All owned-pick records are withheld from the audit AND trade laboratory. Reconstructed pick ownership cannot be verified.");
    }
    await s.setJSON(key,audit).catch(()=>{});
    return response({...audit,cache:{fresh:true,ageMinutes:0}});
  }catch(error){
    if(cache)return response({...cache,cache:{
      fresh:false,ageMinutes:Math.round((now-cache.at)/60000),
      warning:"Live Sleeper retrieval failed; displaying an older league audit, not current ownership."
    }});
    return response({error:"GM audit unavailable: "+String(error.message||error),leagueId:id},502);
  }
}
