// Owner-only, explicit opt-in paid GM review. No request on page load.
// Separate from the public read-only audit. Rate limited per league.
// Existing public legacy LLM endpoints are NOT reused here.
import { createHash, timingSafeEqual } from "node:crypto";
import { getMyLeagues } from "./leagues.mjs";
import { store, callClaude } from "./lib/war-v2.mjs";
import { buildReviewRequest, makePrompt, validateReview } from "./lib/gm-review-core.mjs";

const json=(x,status=200)=>new Response(JSON.stringify(x),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
const HOURS=60*60*1000;
const REVIEW_TTL=12*HOURS;
const LOCK_TTL=4*60*1000;
const MIN_CODE_LENGTH=24;
function safeEquals(a,b) {
  const left=createHash("sha256").update(String(a||"")).digest();
  const right=createHash("sha256").update(String(b||"")).digest();
  return timingSafeEqual(left,right);
}
const msg=e=>String(e?.message||e||"Unknown error").slice(0,250);

export default async function gmReview(req) {
  if(req.method!=="POST")return json({error:"POST only. Reviews are never run on page load."},405);
  const secret=process.env.WARROOM_GM_OWNER_CODE;
  if(!secret||secret.length<MIN_CODE_LENGTH||!process.env.ANTHROPIC_API_KEY)
    return json({error:"AI GM is disabled until the owner configures a 24+ character access code and an Anthropic API key in Netlify. Copy GM Dossier still works."},503);
  let body;
  try{body=await req.json()}catch{return json({error:"Malformed JSON"},400)}
  if(!safeEquals(body?.accessCode,secret))return json({error:"Owner access code incorrect"},403);
  const id=String(body?.leagueId||"");
  if(!/^\d{15,22}$/.test(id))return json({error:"Invalid league ID"},400);
  let selected;
  try{
    selected=(await getMyLeagues()).find(l=>String(l.id)===id);
  }catch{return json({error:"Could not verify Sleeper account's league membership"},503)}
  if(!selected)return json({error:"League does not belong to the configured Sleeper owner"},403);

  const s=store(),now=Date.now();
  const audit=await s.get("gm_audit_v2_"+id,{type:"json"}).catch(()=>null);
  if(!audit||!audit.tradeInventory||audit.league?.id!==id)
    return json({error:"Update the league GM Audit before requesting AI review"},409);
  if(now-Number(audit.at||0)>60*60*1000)
    return json({error:"GM Audit is older than one hour. Refresh the league first; no AI credits spent."},409);
  const key="gm_review_v1_"+id;
  const cached=await s.get(key,{type:"json"}).catch(()=>null);
  if(cached&&now-Number(cached.at||0)<REVIEW_TTL){
    return json({...cached,cache:{reused:true,reviewAgeMinutes:Math.round((now-cached.at)/60000)},
      warning:cached.auditAt!==audit.at?"This review is based on an earlier audited snapshot; re-evaluate after the next paid review window.":null});
  }
  const lockKey="gm_review_lock_v1_"+id;
  const lock=await s.get(lockKey,{type:"json"}).catch(()=>null);
  if(lock&&now-Number(lock.at||0)<LOCK_TTL)
    return json({error:"An owner GM review was requested recently. Check back after it finishes; no duplicate review started."},429);
  await s.setJSON(lockKey,{at:now}).catch(()=>{});
  try {
    const data=buildReviewRequest(audit);
    const prompt=makePrompt(data);
    // Plain grounded reasoning. NO web search, NO scheduled inference,
    // no automatic transaction creation or external account changes.
    const answer=await callClaude(prompt,{maxTokens:1300,useSearch:false});
    const checked=validateReview(answer,data);
    const result={
      ok:true,leagueId:id,leagueName:selected.name,
      at:Date.now(),auditAt:audit.at,review:checked,
      provider:"Anthropic / on-demand, no search",
      feeNote:"One explicitly requested paid AI review; up to one new review per league every 12 hours",
    };
    await s.setJSON(key,result).catch(()=>{});
    return json({...result,cache:{reused:false}});
  }catch(e){
    return json({error:"AI review could not be validated: "+msg(e)+". Nothing was committed to the recommendation cache."},502);
  }finally{
    await s.delete(lockKey).catch(()=>{});
  }
}
