(function(root){
"use strict";
const esc=v=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt=v=>v==null?"Not priced":Number(v).toFixed(1);
const sign=v=>v==null?"Unknown":(v>=0?"+":"")+fmt(v);
let current=null,partnerId=null,send=new Set(),receive=new Set(),notice="";
const $=id=>document.getElementById(id);
function defaultPartner(a){
  const me=a?.tradeInventory?.teams?.find(t=>t.isMe);
  const partners=a?.tradeInventory?.teams?.filter(t=>!t.isMe)||[];
  const suggested=a?.tradePartners?.[0];
  return String(partners.find(t=>t.name===suggested?.name)?.rosterId || partners[0]?.rosterId || "");
}
function setData(a) {
  if(a?.error||!a?.tradeInventory?.teams?.length) {
    current=null;partnerId=null;send.clear();receive.clear();
    const el=$("trade-lab");if(el)el.innerHTML='<div class="empty">Trade lab requires a complete league audit. Refresh the audit before constructing an offer.</div>';
    return;
  }
  if(current?.league?.id!==a?.league?.id) {
    send.clear();receive.clear();partnerId=defaultPartner(a);
  }
  current=a;notice="";
  if(!a.tradeInventory.teams.some(t=>String(t.rosterId)===String(partnerId)))partnerId=defaultPartner(a);
  draw();
}
function rows(assets,which){
  const selected=which==="send"?send:receive;
  const grouped=["QB","RB","WR","TE","K","DEF","DL","LB","DB","PICKS","OTHER"];
  const posOf=a=>a.type==="pick"?"PICKS":grouped.includes(a.pos)?a.pos:"OTHER";
  const assetMarkup=a=>'<label class="tl-asset"><input type="checkbox" data-side="'+which+'" data-id="'+esc(a.id)+'"'
    +(selected.has(a.id)?' checked':'')+'><span><b>'+esc(a.name)+'</b><small>'
    +(a.type==="player"?esc(a.pos)+' · '+esc(a.observedWeeks||0)+' recent observed weeks'+(a.injury?' · '+esc(a.injury):''):
      "Future rookie draft pick")
    +(current.league.mode==="DYNASTY"?' · market '+(a.marketValue==null?"unpriced":esc(fmt(a.marketValue))):'')
    +'</small></span></label>';
  return grouped.map(pos=>{
    const matches=assets.filter(a=>posOf(a)===pos);
    if(!matches.length)return "";
    return '<details class="tl-group"'+(selected.size&&matches.some(a=>selected.has(a.id))?' open':'')
      +'><summary>'+esc(pos)+' <span>'+matches.length+'</span></summary>'+matches.map(assetMarkup).join("")+'</details>';
  }).join("");
}
function verdict(d) {
  if(!d.ok)return '<div class="tl-hint">'+esc(d.error)+'</div>';
  const h=d.historicalBaseline;
  const metrics=h?'<div class="tl-numbers">'
      +'<div><b>'+esc(sign(h.myDelta))+'</b><span>MY OBSERVED STARTERS</span></div>'
      +'<div><b>'+esc(sign(h.theirDelta))+'</b><span>THEIR OBSERVED STARTERS</span></div>'
      +(d.market?'<div><b>'+esc(sign(d.market.netValue))+'</b><span>MY DYNASTY VALUE</span></div>':'')
    +'</div>'
    :'<div class="tl-warning">Historical lineup effect unavailable. There are too few recent scores to estimate every starting slot without filling gaps with invented numbers.</div>';
  return '<div class="tl-verdict"><h4>OFFER UNDER EXAMINATION</h4><div class="tl-summary"><b>Give: '+d.send.map(a=>esc(a.name)).join(" + ")+'</b><b>Get: '+d.receive.map(a=>esc(a.name)).join(" + ")+'</b></div>'
    +metrics+
    '<div class="tl-caveats">'+d.risks.map(x=>'<p>'+esc(x)+'</p>').join("")+'</div>'
    +'<div class="tl-notice">'+esc(d.classification)+' · Nothing has been offered, accepted, or sent.</div></div>';
}
function draw(){
  const el=$("trade-lab");if(!el||!current)return;
  if(typeof WarRoomTradeLab==="undefined"){el.innerHTML='<div class="empty">Trade simulator unavailable.</div>';return}
  const teams=current.tradeInventory.teams,me=teams.find(t=>t.isMe);
  const partner=teams.find(t=>String(t.rosterId)===String(partnerId));
  if(!me||!partner){el.innerHTML='<div class="empty">Choose a manager.</div>';return}
  const options=teams.filter(t=>!t.isMe).map(t=>'<option value="'+esc(t.rosterId)+'"'
    +(String(t.rosterId)===String(partnerId)?' selected':'')+'>'+esc(t.name)+'</option>').join("");
  const mine=WarRoomTradeLab.assetsForTeam(me),theirs=WarRoomTradeLab.assetsForTeam(partner);
  const result=WarRoomTradeLab.evaluate(current,me.rosterId,partner.rosterId,[...send],[...receive]);
  const stamp=current.tradeInventory.marketSourceDate||"not available";
  el.innerHTML='<div class="tl-controls"><label for="tl-partner">TRADE WITH</label><select id="tl-partner">'+options+'</select>'
    +'<button id="tl-reset" type="button">CLEAR OFFER</button></div>'
    +'<div class="tl-explainer">Choose up to four assets from each side. Every option comes from the current Sleeper roster/pick ledger. Recent lineup scores are descriptive, not predictions. '
    +'Dynasty values: '+esc(current.tradeInventory.marketSource)+' · source date '+esc(stamp)+'.</div>'
    +'<div class="tl-grid"><div class="tl-side"><h4>YOU SEND <span>'+send.size+'/4</span></h4>'
    +rows(mine,"send")+'</div><div class="tl-side"><h4>'+esc(partner.name)+' SENDS <span>'+receive.size+'/4</span></h4>'
    +rows(theirs,"receive")+'</div></div>'
    +verdict(result)
    +'<div class="tl-footer"><button id="tl-copy" type="button"'+(!result.ok?' disabled':'')+'>COPY TRADE RESEARCH</button>'
    +(notice?'<small>'+esc(notice)+'</small>':'')+'</div>';
}
function install(){
  const el=$("trade-lab");if(!el)return;
  el.addEventListener("change",event=>{
    const target=event.target;
    if(target.id==="tl-partner") {
      partnerId=target.value;send.clear();receive.clear();notice="";draw();return;
    }
    if(target.matches('input[data-side][data-id]')){
      const set=target.dataset.side==="send"?send:receive;
      if(target.checked){if(set.size>=4){notice="Maximum four assets per side";draw();return}set.add(target.dataset.id)}
      else set.delete(target.dataset.id);
      notice="";draw();
    }
  });
  el.addEventListener("click",async event=>{
    const target=event.target;
    if(target.id==="tl-reset"){send.clear();receive.clear();notice="";draw();return}
    if(target.id==="tl-copy"&&current){
      const me=current.tradeInventory.teams.find(t=>t.isMe);
      const result=WarRoomTradeLab.evaluate(current,me.rosterId,partnerId,[...send],[...receive]);
      if(!result.ok)return;
      const packet="WAR ROOM / UNEXECUTED TRADE EXPERIMENT\n"+JSON.stringify({
        league:current.league,at:current.at,offer:result,modelQuality:current.validation,
        provenance:current.tradeInventory.valuationScope
      },null,2);
      try{await navigator.clipboard.writeText(packet);notice="Trade research copied";draw()}
      catch{notice="Clipboard unavailable";draw()}
    }
  });
}
root.WarRoomTradeLabUI={setData,install,render:draw};
})(typeof globalThis!=="undefined"?globalThis:this);
