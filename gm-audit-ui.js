(function (root) {
  "use strict";
  const esc=x=>String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const fixed=(x,d=1)=>x==null||!Number.isFinite(Number(x))?"—":Number(x).toFixed(d);
  const fmt=(x)=>x==null?"—":String(x);
  const row=(label,value,note="")=>'<div class="audit-metric"><b>'+esc(value)+'</b><span>'+esc(label)+'</span>'+(note?'<small>'+esc(note)+'</small>':"")+'</div>';
  const humanAge=timestamp=>{
    if(!timestamp)return"unknown";
    const time=new Date(timestamp);
    return Number.isNaN(time.getTime())?"unknown":time.toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  };
  const rank=(n,total)=>n==null?"—":n+"/"+total;
  const cleanLabel=pos=>pos==="DEF"?"DEF":pos;

  function renderAudit(data) {
    if(!data)return '<div class="empty">League-wide data is still loading.</div>';
    if(data.error)return '<div class="empty inj">'+esc(data.error)+'</div>';
    const t=data.teams||[],me=data.me||{},all=me.allPlay||{},cover=data.coverage||{},
      partners=data.tradePartners||[],free=data.freeAgents||{},picks=me.picks||[];
    const stale=data.cache?.fresh===false;
    const intro='<div class="audit-intro"><strong>'+esc(data.diagnosis||"")+'</strong>'
      +'<p>'+esc(data.stance||"")+'</p></div>';
    const status='<div class="audit-source">'+(stale?'<span class="audit-alert">STALE DATA · '+esc(data.cache.warning||"Recheck before acting")+'</span>':"")
      +'<span>SLEEPER LEAGUE SNAPSHOT · '+esc(humanAge(data.at))+'</span>'
      +'<span>'+esc(cover.completedWeeks||0)+' COMPLETED WEEKS ANALYZED</span>'
      +'<span>'+esc(cover.missingMatchupWeeks?.length||0)+' MISSING WEEK RESPONSES</span>'+
      (!cover.completeHistory?'<span class="audit-alert">PARTIAL HISTORY · SCHEDULE LUCK MAY BE UNAVAILABLE</span>':'')+'</div>';
    const stats='<div class="audit-metrics">'+[
      row("EST. STANDING",rank(me.standing,t.length),(me.wins||0)+"-"+(me.losses||0)+" record"),
      row("POINTS FOR RANK",rank(me.pfRank,t.length),fixed(me.pointsPerGame)+" points/game"),
      row("ALL-PLAY RANK",rank(me.allPlayRank,t.length),fixed(all.allPlayPct,0)+"% beats league"),
      row("SCHEDULE LUCK",all.luckWins==null?"Not comparable":(Number(all.luckWins)>=0?"+":"")+fixed(all.luckWins)+" wins",
        all.comparableToRecord?"actual wins minus round-robin expectation":"Incomplete game history"),
      row("POTENTIAL RANK",rank(me.potentialRank,t.length),
        me.potentialGap==null?"Unavailable":fixed(me.potentialGap)+" total optimistic bench points"),
    ].join("")+'</div>';

    const actualStandings='<div class="audit-box"><h4>WHO IS REALLY SCORING</h4><div class="audit-table-wrap"><table class="audit-table"><thead><tr><th>TEAM</th><th>W-L</th><th>PF</th><th>PF RANK</th><th>ALL-PLAY</th><th>TRADES</th></tr></thead><tbody>'
      +t.map(team=>'<tr'+(team.isMe?' class="mine"':'')+'><td>'+esc(team.name)+'</td><td>'
        +esc(team.wins+'-'+team.losses)+'</td><td>'+esc(fixed(team.pointsFor))+'</td><td>'
        +esc(rank(team.pfRank,t.length))+'</td><td>'
        +esc(team.allPlay?.allPlayPct==null?"—":fixed(team.allPlay.allPlayPct,0)+"%")
        +'</td><td>'+esc(team.tradeCount??0)+'</td></tr>').join("")
      +'</tbody></table></div><p class="audit-footnote">All-play = percentage of completed weekly head-to-head comparisons this team would have won. It distinguishes scoring performance from the opponent draw.</p></div>';

    const trade='<div class="audit-box"><h4>TRADE PARTNERS WORTH INVESTIGATING</h4>'+
      (partners.length?partners.slice(0,5).map(p=>'<div class="audit-item"><div class="audit-item-title">'
          +esc(p.name)+' <span class="audit-tag">FIT ONLY</span></div><div>You could offer: <b>'+esc(p.offerPositions.join(" / ")||"—")+'</b>'
          +' · Their surplus: <b>'+esc(p.targetPositions.join(" / ")||"—")+'</b></div>'
          +(p.targetExamples?.length?'<small>Example targets, ranked by observed recent scoring: '
            +p.targetExamples.map(x=>esc(x.name)+' ('+esc(x.pos)+', '+fixed(x.recentAvg)+' over '+esc(x.observedWeeks)+' recorded weeks)').join(" · ")+'</small>':'')
          +'<small>'+esc(p.completedTradesThisSeason)+' completed trades observed this season. '
          +'This is not a fair-value offer.</small></div>').join("")
        :'<div class="empty">No two-sided positional-surplus match cleared the screen. That is not proof there are no good trades. A player-value review is still required.</div>')
      +'</div>';

    const sims=data.tradeSimulations||[];
    const tradeModels=sims.length?'<div class="audit-box"><h4>MODELLED TRADE PACKAGES / RESEARCH ONLY</h4>'
      +sims.slice(0,5).map(p=>'<div class="audit-item"><div class="audit-item-title">'+esc(p.partner)
        +' <span class="audit-tag">NOT AN OFFER</span></div>'
        +'<div>Send <b>'+p.send.map(x=>esc(x.name)).join(" + ")+'</b> · Receive <b>'+esc(p.get.name)+'</b></div>'
        +'<small>My modelled lineup: '+esc((p.myWeeklyModelDelta>=0?"+":"")+fixed(p.myWeeklyModelDelta))
        +' /week · Their modelled lineup: '+esc((p.theirWeeklyModelDelta>=0?"+":"")+fixed(p.theirWeeklyModelDelta))
        +'/week'+(p.dynastyModelValueDelta!=null?' · Dynasty-model value: '+esc((p.dynastyModelValueDelta>=0?"+":"")+fixed(p.dynastyModelValueDelta)):"")
        +'</small><small>'+esc(p.caveat)+'</small></div>').join("")
      +'</div>':"";
    const freeHtml='<div class="audit-box"><h4>VERIFIED UNROSTERED CANDIDATES</h4>'+
      (!free.verified?'<div class="empty">No fresh roster-action scan. '+esc(free.reason||"")+'. No specific free agent is being recommended.</div>'
        :!free.candidates?.length?'<div class="empty">No usable adds survived the live ownership cross-check.</div>'
        :free.candidates.slice(0,6).map(p=>'<div class="audit-item"><div class="audit-item-title">'
          +esc(p.name)+' <span class="audit-tag">'+esc(p.pos)+'</span></div><div>'
          +esc(p.transactionType)+(p.drop?' · proposed drop: '+esc(p.drop):"")
          +(p.potentialWeeklyGain!=null?' · model '+esc((p.potentialWeeklyGain>=0?"+":"")+fixed(p.potentialWeeklyGain))+' pts/week':"")
          +'</div><small>'+esc(p.context)+'</small></div>').join(""))
      +'<p class="audit-footnote">Market scan: '+esc(humanAge(free.checkedAt))
      +'. Ownership is checked against this league, but final status and roster locks require a fresh check.</p></div>';

    const holdings='<div class="audit-box"><h4>MY DEPTH / DRAFT CAPITAL</h4><div class="audit-depth">'
      +["QB","RB","WR","TE","K","DEF"].map(pos=>{
        const total=me.depth?.total?.[pos]||0,available=me.depth?.active?.[pos]||0;
        const thin=me.needs?.find(x=>x.pos===pos);
        return '<div><b>'+esc(cleanLabel(pos))+'</b><span>'+esc(available)+' active / '+esc(total)+' owned</span>'
          +(thin?'<small>'+esc(thin.level.toUpperCase())+' DEPTH</small>':"")+'</div>';
      }).join("")+'</div>'
      +(data.league?.mode==="DYNASTY"
        ?'<details class="audit-picks"><summary>Owned future rookie picks ('+esc(picks.length)+')</summary><div>'
          +(cover.pickLedgerVerified===false?'<p>Traded-pick endpoint unavailable. Cannot verify ownership.</p>':
            picks.map(p=>'<div>'+esc(p.season)+' R'+esc(p.round)+' · '+esc(p.originalTeam)
              +(p.traded?' (acquired)':' (original)')+'</div>').join("")||'<div>No picks found.</div>')
          +'</div></details>'
        :'<p class="audit-footnote">Redraft league. Future rookie picks are not dynasty assets.</p>')
      +'</div>';

    const calibration=data.validation||{};
    const compared=calibration.overall?.naiveCompared||0;
    const evidenceCard='<div class="audit-box audit-validation"><h4>FORECAST SCORECARD / DOES THE MODEL EARN ITS COMPLEXITY?</h4>'
      +'<div class="audit-metrics">'
      +row("PREGAME PLAYER-WEEKS",calibration.evaluatedSamples??0,"Actual league-scored outcomes")
      +row("COMPARABLE TO SIMPLE BASELINE",compared,"Requires 2+ prior observed games")
      +row("MODEL MAE / SAME SAMPLE",fixed(calibration.overall?.modelMaeCompared),"Lower is better")
      +row("TRAILING-AVG MAE",fixed(calibration.overall?.naiveMae),"Same players and weeks")
      +'</div><div class="audit-intro"><strong>'
      +(calibration.verdict==="MODEL_BEATS_NAIVE"?"Model beat the simple baseline on this sample"
        :calibration.verdict==="NAIVE_BEATS_MODEL"?"Simple historical average beat War Room's model"
        :calibration.verdict==="TIE_WITHIN_POINT_25"?"Model and simple baseline are essentially tied"
        :"Insufficient verified comparisons to claim a model advantage")
      +'</strong><p>'
      +esc(calibration.note||"No validated pregame forecast data available.")
      +'</p></div>'
      +(calibration.recentModelMisses?.length?'<details class="audit-picks"><summary>Largest recent prediction misses</summary><div>'
        +calibration.recentModelMisses.slice(0,6).map(p=>'<div>W'+esc(p.week)+' '+esc(p.name)+' ('
          +esc(p.position)+'): model '+fixed(p.projection)+' / actual '+fixed(p.actual)+'</div>').join("")
        +'</div></details>':"")
      +'</div>';
    const quality='<details class="audit-limits"><summary>What this audit cannot establish ('+esc((data.limitations||[]).length)+')</summary>'
      +'<ul>'+(data.limitations||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></details>';

    return status+intro+stats+evidenceCard+
      '<div class="audit-columns"><div>'+actualStandings+trade+tradeModels+'</div><div>'+holdings+freeHtml+'</div></div>'+quality;
  }
  root.WarRoomGmAudit={renderAudit};
})(typeof globalThis!=="undefined"?globalThis:this);
