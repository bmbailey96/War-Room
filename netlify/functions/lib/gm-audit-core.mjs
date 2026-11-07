import "../../../trade-fit.js";

// Pure league-wide audit. No provider projections or invented player values.
// Inputs are the observed Sleeper league, rosters, matchup scores, transactions,
// traded picks and player metadata. Keep all calculations testable without network.

const fixed = (x, places=1) => Number.isFinite(Number(x)) ? Math.round(Number(x)*10**places)/10**places : null;
const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const positions = ["QB","RB","WR","TE","K","DEF","DL","LB","DB"];
const statusOut = v => /^(out|ir|pup|nfi|suspended|sus|doubtful|inactive)$/i.test(String(v||"").trim());
const nameOf = (p, pid) => p?.n || p?.full_name || [p?.first_name,p?.last_name].filter(Boolean).join(" ") || String(pid);
const posOf = p => {
  const f=p?.fp||p?.fantasy_positions||[];
  for(const x of positions)if(f.includes(x))return x;
  const raw=String(p?.p||p?.position||"").toUpperCase();
  return ["DE","DT"].includes(raw)?"DL":["CB","S","FS","SS"].includes(raw)?"DB":raw==="OLB"?"LB":positions.includes(raw)?raw:"OTHER";
};
const scored = row => {
  const value=row?.points??row?.custom_points;
  return value!=null&&Number.isFinite(Number(value))?Number(value):null;
};
const round = v => fixed(v,1);
const strong = (a,b) => a>b?1:a<b?-1:0;
const asId = x => String(x);
const safeJsonDate = d => Number.isFinite(Number(d))?new Date(Number(d)).toISOString():null;

function depthFromRoster(roster, db) {
  const total=Object.fromEntries(positions.map(p=>[p,0]));
  const active={...total};
  const players=[];
  for(const pid of roster?.players||[]) {
    const p=db?.[pid]||{};
    const pos=posOf(p),injury=p.inj||p.injury_status||null;
    if(total[pos]!=null)total[pos]++;
    const onReserve=(roster.reserve||[]).some(x=>asId(x)===asId(pid));
    if(active[pos]!=null&&!statusOut(injury)&&!onReserve)active[pos]++;
    players.push({id:String(pid),name:nameOf(p,pid),pos,
      team:p.t||p.team||null,age:p.a||p.age||null,injury,onReserve});
  }
  return {total,active,players};
}

function completedMatches(weeks, rosters) {
  const ids=new Set(rosters.map(r=>asId(r.roster_id)));
  return (weeks||[]).flatMap((week,i)=>{
    const rows=Array.isArray(week)?week:(week?.rows||[]);
    if(rows.length!==ids.size)return [];
    const map=new Map();
    for(const row of rows) {
      const id=asId(row?.roster_id);
      if(!ids.has(id)||map.has(id)||scored(row)==null)return [];
      map.set(id,row);
    }
    if(map.size!==ids.size)return [];
    return [{week:week?.week||i+1,rows:[...map.values()]}];
  });
}

export function scoreAllPlay(completed, rosterId) {
  let wins=0,ties=0,games=0,expected=0;
  const weekly=[];
  for(const week of completed) {
    const mine=week.rows.find(x=>asId(x.roster_id)===asId(rosterId));
    if(!mine)continue;
    const score=scored(mine);
    const others=week.rows.filter(x=>asId(x.roster_id)!==asId(rosterId));
    const count=others.length;
    if(!count)continue;
    const w=others.filter(x=>score>scored(x)).length;
    const t=others.filter(x=>Math.abs(score-scored(x))<1e-6).length;
    const leagueRank=1+others.filter(x=>scored(x)>score).length;
    wins+=w;ties+=t;games+=count;expected+=(w+t*.5)/count;
    weekly.push({week:week.week,score:round(score),rank:leagueRank,allPlayPct:round((w+t*.5)/count*100)});
  }
  return games?{
    completedWeeks:weekly.length,
    allPlayPct:round((wins+ties*.5)/games*100),
    expectedWins:round(expected),
    weekly,
  }:{completedWeeks:0,allPlayPct:null,expectedWins:null,weekly:[]};
}

function participantIds(tx) {
  const r=new Set((tx?.consenter_ids||[]).map(asId));
  for(const v of Object.values(tx?.adds||{}))if(v!=null)r.add(asId(v));
  for(const v of Object.values(tx?.drops||{}))if(v!=null)r.add(asId(v));
  for(const p of tx?.draft_picks||[]){
    if(p?.owner_id!=null)r.add(asId(p.owner_id));
    if(p?.previous_owner_id!=null)r.add(asId(p.previous_owner_id));
  }
  return r;
}

function tradeActivity(transactions) {
  const byId={};
  const seen=new Set();
  for(const group of transactions||[]) {
    const rows=Array.isArray(group)?group:(group?.rows||[]);
    for(const t of rows) {
      if(t?.type!=="trade"||t.status!=="complete")continue;
      const id=String(t.transaction_id||"");
      if(!id||seen.has(id))continue;
      seen.add(id);
      for(const rid of participantIds(t))byId[rid]=(byId[rid]||0)+1;
    }
  }
  return byId;
}

function rankBy(rows,key,desc=true) {
  const valid=rows.filter(x=>Number.isFinite(x[key]));
  return Object.fromEntries(valid.map(x=>[
    asId(x.rosterId),
    1+valid.filter(y=>desc?y[key]>x[key]+1e-6:y[key]<x[key]-1e-6).length
  ]));
}

function rosterNeeds(team, slots) {
  const must={RB:0,WR:0,TE:0,QB:0};
  for(const slot of slots||[])if(must[slot]!=null)must[slot]++;
  const priority=[];
  const oneQb=must.QB===1&&!(slots||[]).includes("SUPER_FLEX");
  for(const pos of ["RB","WR","TE","QB"]) {
    const have=team.depth.active[pos]||0, required=must[pos]||0;
    // In a one-QB league, having one healthy QB is not an urgent shortage.
    // Backup QB depth is typically streamable; only an empty position is urgent.
    if(pos==="QB"&&oneQb&&have>=1)continue;
    if(required>0&&have<=required)priority.push({pos,level:"urgent",have,required});
    else if(required>0&&have<=required+1)priority.push({pos,level:"thin",have,required});
  }
  return priority;
}

function ownedPicks(league,rosters,users,tradedPicks) {
  // Imported only for dynasty; no fictional pick capital in redraft.
  const type=Number(league?.settings?.type||0);
  const mode=type===2?"DYNASTY":
    Number(league?.settings?.pick_trading||0)>0&&Number(league?.settings?.draft_rounds||0)<=6?"DYNASTY":"REDRAFT";
  if(mode!=="DYNASTY")return {mode,picksByRoster:{}};
  const season=Number(league.season||new Date().getFullYear());
  const future=[...(league.status==="pre_draft"||league.status==="drafting"?[season]:[]),season+1,season+2,season+3];
  const rounds=Math.max(1,Math.min(8,Number(league.settings?.draft_rounds||3)));
  const byRoster=Object.fromEntries(rosters.map(r=>[asId(r.roster_id),[]]));
  const rosterOwner=Object.fromEntries(rosters.map(r=>[asId(r.roster_id),r.owner_id]));
  const names=Object.fromEntries(users.map(u=>[asId(u.user_id),u.metadata?.team_name||u.display_name||"Unknown"]));
  const moved=new Set();
  for(const p of tradedPicks||[]) {
    if(!future.includes(Number(p.season)))continue;
    if(!byRoster[asId(p.owner_id)])continue;
    const key=[p.season,p.round,p.roster_id].join("|");
    if(moved.has(key))continue;
    byRoster[asId(p.owner_id)].push({
      season:Number(p.season),round:Number(p.round),originalRosterId:p.roster_id,
      originalTeam:names[asId(rosterOwner[asId(p.roster_id)])]||String(p.roster_id),traded:true
    });
    moved.add(key);
  }
  for(const year of future)for(let round=1;round<=rounds;round++)for(const r of rosters) {
    const key=[year,round,r.roster_id].join("|");
    if(moved.has(key))continue;
    byRoster[asId(r.roster_id)].push({
      season:year,round,originalRosterId:r.roster_id,
      originalTeam:names[asId(r.owner_id)]||String(r.roster_id),traded:false
    });
  }
  for(const arr of Object.values(byRoster))arr.sort((a,b)=>a.season-b.season||a.round-b.round);
  return {mode,picksByRoster:byRoster};
}

function recentPoints(completed) {
  // Matchup players_points are the actual league-scored figures from prior
  // weeks. Players may have changed teams; count only weeks where seen.
  const points=new Map();
  for(const w of completed.slice(-4)){
    for(const row of w.rows){
      for(const [pid,val] of Object.entries(row.players_points||{})){
        if(!Number.isFinite(Number(val)))continue;
        const rec=points.get(String(pid))||{sum:0,n:0};
        rec.sum+=Number(val);rec.n++;points.set(String(pid),rec);
      }
    }
  }
  return points;
}

function strengthByPos(team, recent) {
  const out={};
  for(const pos of ["QB","RB","WR","TE"]){
    const players=team.depth.players.filter(p=>p.pos===pos)
      .map(p=>{const record=recent.get(p.id);return {...p,
        recentAvg:record?.n>=2?round(record.sum/record.n):null,
        observedWeeks:record?.n||0};})
      .sort((a,b)=>(b.recentAvg??-999)-(a.recentAvg??-999));
    out[pos]=players.slice(0,3);
  }
  return out;
}

function opponentTradeIdeas(me, teams, league, recent) {
  const out=[];
  const myNeeds=rosterNeeds(me,league.roster_positions||[]).filter(x=>x.level==="urgent"||x.level==="thin");
  for(const t of teams) {
    if(t.isMe)continue;
    const theirNeeds=rosterNeeds(t,league.roster_positions||[]);
    const myOffer=[],target=[];
    for(const pos of ["RB","WR","TE"]){
      const ours=me.depth.active[pos]||0;
      const theirs=t.depth.active[pos]||0;
      const theirThin=theirNeeds.some(x=>x.pos===pos);
      const myThin=myNeeds.some(x=>x.pos===pos);
      const medianHave=(me.depth.active[pos]||0);
      if(ours>=3 && theirThin && ours>=theirs+2)myOffer.push(pos);
      if(myThin && theirs>=medianHave+2 && theirs>=3)target.push(pos);
    }
    if(!myOffer.length||!target.length)continue;
    const samples=target.flatMap(pos=>t.strength[pos]||[])
      .filter(p=>p.recentAvg!=null&&p.observedWeeks>=2)
      .sort((a,b)=>(b.recentAvg||0)-(a.recentAvg||0));
    const involvement=t.tradeCount||0;
    const score=myOffer.length*2+target.length*2+Math.min(3,involvement);
    out.push({
      rosterId:t.rosterId,name:t.name,
      offerPositions:myOffer,targetPositions:target,
      targetExamples:samples.slice(0,3).map(p=>({
        name:p.name,pos:p.pos,recentAvg:p.recentAvg,observedWeeks:p.observedWeeks
      })),
      completedTradesThisSeason:involvement,
      fitScore:score,
      caveat:"Positional fit only. No fair offer or willingness to trade has been established."
    });
  }
  return out.sort((a,b)=>b.fitScore-a.fitScore||b.completedTradesThisSeason-a.completedTradesThisSeason).slice(0,5);
}

function verifiedTradeSimulations(scan, me, teams, now) {
  if(!scan?.at||now-Number(scan.at)>6*60*60*1000||scan.refreshing||scan.error)return [];
  // Existing War Room computes both teams' projected lineup and value math.
  // This layer only shows player-only packages whose ownership still matches
  // live rosters. Pick packages require manual verification and are withheld.
  const normal=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const others=teams.filter(t=>!t.isMe);
  const out=[];
  for(const idea of scan?.context?.deterministicTrades||[]) {
    if(out.length>=5)break;
    if(!idea?.target||!idea?.partner||!Array.isArray(idea.send)||!idea.send.length)continue;
    if(idea.send.some(x=>x.type!=="player"||!x.name))continue;
    const t=others.find(x=>normal(x.name)===normal(idea.partner));
    if(!t)continue;
    const player=t.depth.players.find(p=>normal(p.name)===normal(idea.target));
    if(!player)continue;
    const send=idea.send.map(x=>me.depth.players.find(p=>normal(p.name)===normal(x.name)));
    if(send.some(x=>!x)||new Set(send.map(x=>x.id)).size!==send.length)continue;
    if(!Number.isFinite(Number(idea.weeklyDelta))||Number(idea.weeklyDelta)<=0)continue;
    if(!Number.isFinite(Number(idea.partnerWeeklyDelta)))continue;
    out.push({
      partner:t.name,
      send:send.map(x=>({name:x.name,pos:x.pos})),
      get:{name:player.name,pos:player.pos},
      myWeeklyModelDelta:round(idea.weeklyDelta),
      theirWeeklyModelDelta:round(idea.partnerWeeklyDelta),
      dynastyModelValueDelta:idea.marketDelta==null?null:round(idea.marketDelta),
      modelTradeRatio:idea.tradeRatio??null,
      managerTradeCount:t.tradeCount,
      verdict:"RESEARCH ONLY",
      caveat:"Player ownership rechecked. The two projected lineup deltas and market valuations are model estimates, not guaranteed gains or an accepted offer."
    });
  }
  return out;
}

function freeAgentCandidates(scan, rosteredIds, playersDB, now, mine) {
  const age=scan?.at!=null?(now-Number(scan.at))/60000:null;
  const valid=age!=null&&age>=0&&age<=360&&!scan?.refreshing&&!scan?.error&&!scan?.status;
  if(!valid)return {
    verified:false,checkedAt:scan?.at||null,
    reason:scan?.error?"Roster-action service error":age==null?"No roster-action scan":"Roster-action scan is stale or refreshing",candidates:[]
  };
  const byName=new Map();
  for(const [pid,p] of Object.entries(playersDB||{})) {
    const name=nameOf(p,pid).toLowerCase().replace(/[^a-z0-9]/g,"");
    if(name)byName.set(name,String(pid));
  }
  const out=[];
  for(const a of scan.actions||[]) {
    if(!["ADD","WAIVER","ADD_DROP","IR_ADD"].includes(String(a.type||"")))continue;
    const p=a.add;
    if(!p?.name)continue;
    const pid=p.pid?String(p.pid):byName.get(p.name.toLowerCase().replace(/[^a-z0-9]/g,""));
    // An unmatched name cannot be reliably ownership-checked.
    if(!pid||rosteredIds.has(pid)||!playersDB[pid]||statusOut(playersDB[pid].inj||playersDB[pid].injury_status))continue;
    if(a.drop?.name&&!mine.depth.players.some(x=>x.name.toLowerCase().replace(/[^a-z0-9]/g,"")===a.drop.name.toLowerCase().replace(/[^a-z0-9]/g,"")))continue;
    const key=pid+"|"+a.type;
    if(out.some(x=>x.key===key))continue;
    out.push({key,name:p.name,pos:posOf(playersDB[pid]),
      transactionType:a.type,drop:a.drop?.name||null,
      potentialWeeklyGain:a.weeklyDelta==null?null:round(a.weeklyDelta),
      faabPct:a.faabPct??null,
      isFreeAgent:!!a.immediateFreeAgent,isWaiver:!!a.waiverOnly,
      requiresIrMove:a.moveToIr?.name||null,
      context:"Verified unrostered at the league snapshot. Still confirm game locks and final status."
    });
  }
  return {verified:true,checkedAt:scan.at,reason:null,candidates:out.slice(0,6)};
}

export function buildGmAudit({league,rosters=[],users=[],playersDB={},tradedPicks=[],weeks=[],transactions=[],
  ownerId,now=Date.now(),scan=null,market=null}) {
  if(!league?.league_id)throw new Error("Missing league ID");
  if(rosters.length<2)throw new Error("Not enough league rosters");
  const mine=rosters.find(r=>asId(r.owner_id)===asId(ownerId));
  if(!mine)throw new Error("Owner does not have a roster in selected league");
  const history=completedMatches(weeks,rosters);
  const recent=recentPoints(history);
  const completedTradeCounts=tradeActivity(transactions);
  const names=Object.fromEntries(users.map(u=>[asId(u.user_id),u.metadata?.team_name||u.display_name||String(u.user_id)]));
  const pickBook=ownedPicks(league,rosters,users,tradedPicks);
  const teams=rosters.map(r=>{
    const st=r.settings||{},rid=asId(r.roster_id);
    const pf=n(st.fpts)+n(st.fpts_decimal)/100,
      pa=n(st.fpts_against)+n(st.fpts_against_decimal)/100,
      potential=n(st.ppts)+n(st.ppts_decimal)/100;
    const games=n(st.wins)+n(st.losses)+n(st.ties);
    const allPlay=scoreAllPlay(history,rid);
    const depth=depthFromRoster(r,playersDB);
    const covered=games===allPlay.completedWeeks;
    const isMe=rid===asId(mine.roster_id);
    const team={
      rosterId:r.roster_id,name:names[asId(r.owner_id)]||"Unknown",isMe,
      wins:n(st.wins),losses:n(st.losses),ties:n(st.ties),
      pointsFor:round(pf),pointsAgainst:round(pa),
      potentialPoints:potential>0?round(potential):null,
      potentialGap:potential>=pf&&potential>0?round(potential-pf):null,
      pointsPerGame:games?round(pf/games):null,
      totalGames:games,depth,
      allPlay:{...allPlay,
        luckWins:covered?round(n(st.wins)-n(allPlay.expectedWins)):null,
        comparableToRecord:covered},
      tradeCount:completedTradeCounts[rid]||0,
      picks:pickBook.picksByRoster[rid]||[],
    };
    team.strength=strengthByPos(team,recent);
    team.needs=rosterNeeds(team,league.roster_positions||[]);
    return team;
  });
  const pfRank=rankBy(teams,"pointsFor");
  const potentialRank=rankBy(teams,"potentialPoints");
  const allPlayRank=rankBy(teams.map(t=>({...t,allPlayRate:t.allPlay.allPlayPct??NaN})),"allPlayRate");
  for(const team of teams) {
    team.pfRank=pfRank[asId(team.rosterId)]||null;
    team.potentialRank=potentialRank[asId(team.rosterId)]||null;
    team.allPlayRank=allPlayRank[asId(team.rosterId)]||null;
  }
  teams.sort((a,b)=>b.wins-a.wins||b.pointsFor-a.pointsFor);
  teams.forEach((t,i)=>t.standing=i+1);
  const me=teams.find(x=>x.isMe);
  const owned=new Set(rosters.flatMap(r=>(r.players||[]).map(asId)));
  const freeAgents=freeAgentCandidates(scan,owned,playersDB,now,me);
  const tradeSimulations=verifiedTradeSimulations(scan,me,teams,now);
  const tradePartners=opponentTradeIdeas(me,teams,league,recent);

  let diagnosis="Performance cannot be diagnosed without completed weekly matchups.";
  if(me.allPlay.completedWeeks>=3) {
    const luck=me.allPlay.luckWins;
    if(luck!=null&&luck<=-1.0)diagnosis="Schedule has cost at least one expected win versus an all-play schedule. Do not confuse that with roster weakness.";
    else if(luck!=null&&luck>=1.0)diagnosis="Record has benefited by at least one win versus all-play expectation. Check underlying scoring before buying expensive veterans.";
    else if(me.pfRank>Math.ceil(teams.length/2))diagnosis="Below-median points scored. Improving available starters matters more than chasing matchup micro-edges.";
    else diagnosis="Scoring is competitive and schedule luck does not explain a full win. Prioritize targeted upgrades and lineup execution.";
  }
  const teamCount=teams.length;
  const stance=pickBook.mode==="DYNASTY"
    ? (me.pfRank<=Math.ceil(teamCount/2)&&me.standing<=(Number(league.settings?.playoff_teams)||Math.ceil(teamCount/2))
      ?"Compete selectively. Current scoring and standing support contention, but do not liquidate young assets."
      :"Do not force win-now trades. Review draft capital and playoff odds before buying veterans.")
    : "Redraft: optimize the remaining season and starting lineup; long-term dynasty value does not apply.";

  const inventory=teams.map(t=>({
    rosterId:String(t.rosterId),name:t.name,isMe:t.isMe,
    players:t.depth.players.map(p=>{
      const past=recent.get(String(p.id));
      const marketKey=String(p.name||"").toLowerCase().replace(/[^a-z ]/g,"")
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"").replace(/\s+/g," ").trim();
      const record=market?.players?.[marketKey];
      return {...p,
        fantasyPositions:playersDB?.[p.id]?.fp||[p.pos],
        recentMean:past?.n>=2?round(past.sum/past.n):null,
        observedWeeks:past?.n||0,
        marketValue:record?.value??null,
      };
    }),
    picks:(t.picks||[]).map(p=>({
      ...p,
      key:String(p.season)+"|"+String(p.round)+"|"+String(p.originalRosterId),
      marketValue:market?.picks?.[String(p.season)+"|"+String(p.round)]??null,
    })),
  }));
  const tradeInventory={
    at:now,
    marketSource:pickBook.mode==="DYNASTY"?"DynastyProcess 1QB published values":"Not used in redraft",
    marketSourceDate:market?.scrapeDate||null,
    marketRetrievedAt:market?.at||null,
    valuationScope:pickBook.mode==="DYNASTY"?
      "Cross-player/pick reference values (1QB), not verified league prices":
      "Only observed recent league-scored games; no rest-of-season forecast.",
    teams:inventory,
  };
  // Existing trade suggestions are not declared realistic just because both
  // projected lineup deltas are positive. Evaluate actual coverage and the
  // other owner's context from the current roster inventory.
  const meAssetTeam=inventory.find(t=>t.isMe);
  const fitAudit={
    league:{mode:pickBook.mode,activeSlots:(league.roster_positions||[]).filter(x=>!["BN","IR","TAXI"].includes(x)),
      playoffTeams:Number(league.settings?.playoff_teams||0),teamCount},
    teams:teams.map(t=>({
      rosterId:t.rosterId,name:t.name,standing:t.standing,pfRank:t.pfRank,tradeCount:t.tradeCount
    }))
  };
  const normalize=x=>String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  for(const idea of tradeSimulations){
    const other=inventory.find(t=>normalize(t.name)===normalize(idea.partner));
    if(!meAssetTeam||!other)continue;
    const outgoing=idea.send.map(p=>meAssetTeam.players.find(x=>normalize(x.name)===normalize(p.name)));
    const incoming=other.players.find(x=>normalize(x.name)===normalize(idea.get?.name));
    if(outgoing.some(x=>!x)||!incoming)continue;
    const fit=globalThis.WarRoomTradeFit.assess({
      audit:fitAudit,me:meAssetTeam,partner:other,
      send:outgoing.map(p=>({type:"player",id:"P:"+p.id,player:p})),
      receive:[{type:"player",id:"P:"+incoming.id,player:incoming}]
    });
    idea.twoSidedFit={
      status:fit.status,hasMutualDepthFit:fit.hasMutualDepthFit,
      yourReasons:fit.mine.reasons,theirReasons:fit.partner.reasons,
      yourRisks:fit.mine.risks,theirRisks:fit.partner.risks,
      why:fit.why,
      inferredOtherDirection:fit.partner.context.inferredDirection
    };
    idea.caveat+=" "+(fit.hasMutualDepthFit?
      "Both sides' positional coverage improves under current roster counts.":
      "At least one side has no verified positional-needs benefit; investigate starter quality and preferences.");
  }
  return {
    at:now,league:{id:league.league_id,name:league.name,season:league.season,week:history.length+1,
      mode:pickBook.mode,teamCount,playoffTeams:Number(league.settings?.playoff_teams||0),
      activeSlots:(league.roster_positions||[]).filter(x=>!["BN","IR","TAXI"].includes(x)),
      scoringSettingsAvailable:!!league.scoring_settings},
    coverage:{completedWeeks:history.length,tradeWeeks:transactions.length,
      completeHistory:me.allPlay.comparableToRecord},
    diagnosis,stance,
    me:{
      ...me,
      // Avoid redundant full league roster payload in the top-level team list.
      roster:me.depth.players,
    },
    teams:teams.map(t=>({
      rosterId:t.rosterId,name:t.name,isMe:t.isMe,standing:t.standing,
      wins:t.wins,losses:t.losses,pointsFor:t.pointsFor,pointsPerGame:t.pointsPerGame,
      pfRank:t.pfRank,potentialRank:t.potentialRank,allPlayRank:t.allPlayRank,
      allPlay:t.allPlay,needs:t.needs,
      depth:t.depth.total,availableDepth:t.depth.active,tradeCount:t.tradeCount,
    })),
    tradePartners,
    tradeInventory,
    tradeSimulations,
    freeAgents,
    limitations:[
      "Sleeper scores and ownership are observed data. All-play expected wins are a counterfactual round-robin result, not a prediction of next week.",
      "Computed standing sorts by wins and points for; Sleeper league-specific tiebreakers or divisions may produce a different official seed.",
      "Potential points are an optimistic lineup ceiling, not proof every bench point was attainable with information available before kickoff.",
      "Trade partner fits compare position depth and observed activity. Player-only trade simulations use War Room estimates and verify ownership but not the reliability of projected gains.",
      "Recent player averages include only completed weeks when that player appears on a league roster; they are not independent rest-of-season forecasts.",
      "Injury tags from player metadata may lag official reports. Verify practice status and game locks before acting.",
      "This audit does not incorporate current external news, betting lines or updated expert projections. They must be checked separately."
    ],
  };
}
