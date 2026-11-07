(function(root){
"use strict";
const esc=x=>String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
let audit=null,review=null,status=null,busy=false;
const el=()=>document.getElementById("gm-review");
function render() {
  const target=el();if(!target)return;
  if(!audit?.league?.id){
    target.innerHTML='<div class="empty">Load a current league GM Audit first.</div>';return;
  }
  const a=review?.review;
  const current=review&&String(review.leagueId)===String(audit.league.id);
  const body=current&&a?'<div class="ai-result"><div class="ai-result-header"><b>'+esc(a.stance)+'</b><span>AI hypothesis · '+esc(new Date(review.at).toLocaleString())+'</span></div>'
    +'<h4>'+esc(a.title)+'</h4><p>'+esc(a.summary)+'</p><p><strong>WHY:</strong> '+esc(a.reason)+'</p>'
    +'<p><strong>COUNTERCASE:</strong> '+esc(a.countercase)+'</p>'
    +'<p><strong>CHECK BEFORE ACTING:</strong> '+esc(a.whatToVerify)+'</p>'
    +'<details class="ai-evidence"><summary>Evidence fields the AI referenced</summary>'
    +(a.evidence||[]).map(x=>'<div>'+esc(x.id)+' · '+esc(x.description)+'</div>').join("")+'</details>'
    +'<div class="ai-note">'+esc(a.disclaimer)+'</div>'
    +(review.warning?'<div class="ai-warning">'+esc(review.warning)+'</div>':'')+'</div>':'';
  target.innerHTML='<div class="ai-intro">The AI reviews the audited league, selects only from verified candidates, and argues against its own conclusion. It does not search the web or make any fantasy transaction. <b>Paid AI is off unless an owner access code and provider key are configured in Netlify.</b></div>'
    +'<div class="ai-controls"><label for="gm-access-code">OWNER ACCESS CODE</label>'
    +'<input type="password" id="gm-access-code" autocomplete="off" placeholder="Netlify GM review access code">'
    +'<button type="button" id="gm-run-review"'+(busy?' disabled':'')+'>'+(busy?'REVIEWING…':'RUN INDEPENDENT REVIEW')+'</button></div>'
    +(status?'<div class="ai-status">'+esc(status)+'</div>':'')
    +body
    +'<p class="audit-footnote">Opt-in only. One new paid review per league every 12 hours. Cached results are labeled. No independent injury or news verification. Never share your access code in a chat or exported dossier.</p>';
}
async function requestReview() {
  if(busy||!audit?.league?.id)return;
  const code=document.getElementById("gm-access-code")?.value||"";
  document.getElementById("gm-access-code").value="";
  if(!code.trim()){status="Enter your owner access code to run a paid review.";render();return}
  const leagueId=audit.league.id;
  busy=true;status="Review requested. No other league is affected.";render();
  try{
    const response=await fetch("/.netlify/functions/gm-review",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({leagueId,accessCode:code})
    });
    const data=await response.json();
    if(String(audit?.league?.id)!==String(leagueId))return;
    if(!response.ok)throw new Error(data.error||"AI review could not complete");
    review=data;status=data.cache?.reused?"Showing existing review (no new AI charges).":"New GM review completed.";
  }catch(err){
    if(String(audit?.league?.id)===String(leagueId))status=err.message||"AI review unavailable";
  }finally{busy=false;render()}
}
function setData(next) {
  if(String(next?.league?.id)!==String(audit?.league?.id)){
    review=null;status=null;
  }
  audit=next?.error?null:next;
  render();
}
function install() {
  const target=el();if(!target)return;
  target.addEventListener("click",e=>{
    if(e.target?.id==="gm-run-review")requestReview();
  });
  target.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&e.target?.id==="gm-access-code"){e.preventDefault();requestReview()}
  });
}
root.WarRoomGmReviewUI={install,setData};
})(typeof globalThis!=="undefined"?globalThis:this);
