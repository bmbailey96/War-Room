const round1=x=>Math.round(Number(x||0)*10)/10;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

function games(t){return Math.max(0,Number(t?.wins||0)+Number(t?.losses||0))}
function perGame(v,g){return g>0?Number(v||0)/g:0}
function rankHigh(value,values){
  const clean=(values||[]).filter(Number.isFinite);
  if(!clean.length)return null;
  return 1+clean.filter(x=>x>value+1e-9).length;
}
function ordinal(n){
  const x=Number(n)||0,mod=x%100;
  if(mod>=11&&mod<=13)return `${x}th`;
  return `${x}${x%10===1?"st":x%10===2?"nd":x%10===3?"rd":"th"}`;
}
function matchupScore(row){
  if(row?.points!=null&&Number.isFinite(Number(row.points)))return Number(row.points);
  if(row?.custom_points!=null&&Number.isFinite(Number(row.custom_points)))return Number(row.custom_points);
  return null;
}

export function buildAllPlayMetrics(weeks=[],rosterId=null,actualWins=0){
  if(rosterId==null)return null;
  let expectedWins=0,pairWins=0,pairTies=0,pairGames=0,scoredWeeks=0;

  for(const week of weeks||[]){
    const rows=Array.isArray(week)?week:(week?.rows||[]);
    const mine=rows.find(r=>Number(r?.roster_id)===Number(rosterId));
    const mineScore=matchupScore(mine);
    if(mineScore==null)continue;
    const others=rows.filter(r=>Number(r?.roster_id)!==Number(rosterId))
      .map(r=>matchupScore(r)).filter(Number.isFinite);
    if(!others.length)continue;

    let wins=0,ties=0;
    for(const score of others){
      if(mineScore>score)wins++;
      else if(Math.abs(mineScore-score)<1e-9)ties++;
    }
    expectedWins+=(wins+ties*.5)/others.length;
    pairWins+=wins;
    pairTies+=ties;
    pairGames+=others.length;
    scoredWeeks++;
  }

  if(!scoredWeeks||!pairGames)return null;
  const actual=Number(actualWins||0);
  return {
    weeks:scoredWeeks,
    expectedWins:round1(expectedWins),
    actualWins:actual,
    luckWins:round1(actual-expectedWins),
    allPlayWinPct:round1((pairWins+pairTies*.5)/pairGames*100),
  };
}

export function diagnoseTeamState(teams=[],me=null,{allPlay=null}={}){
  if(!me)return {
    code:"UNKNOWN",label:"TEAM STATE UNKNOWN",confidence:"LOW",
    aggression:1,tradePosture:"neutral",summary:"Not enough team data yet."
  };

  const played=games(me);
  if(!played){
    return {
      code:"PRESEASON",label:"PRESEASON",confidence:"LOW",
      aggression:1,tradePosture:"neutral",record:"0-0",
      summary:"No real results yet. Do not change strategy from record."
    };
  }

  const eligible=(teams||[]).filter(t=>games(t)>0);
  const rows=eligible.map(t=>{
    const g=games(t);
    const leakage=Math.max(0,Number(t.benchLeakage||0));
    return {
      team:t,
      pf:perGame(t.pointsFor,g),
      pa:perGame(t.pointsAgainst,g),
      potential:perGame(Number(t.pointsFor||0)+leakage,g),
      leakage:perGame(leakage,g),
    };
  });
  const mine=rows.find(x=>x.team?.rosterId===me.rosterId) || {
    team:me,pf:perGame(me.pointsFor,played),pa:perGame(me.pointsAgainst,played),
    potential:perGame(Number(me.pointsFor||0)+Math.max(0,Number(me.benchLeakage||0)),played),
    leakage:perGame(Math.max(0,Number(me.benchLeakage||0)),played),
  };

  const n=Math.max(1,rows.length||teams.length||1);
  const pfRank=rankHigh(mine.pf,rows.map(x=>x.pf));
  const potentialRank=rankHigh(mine.potential,rows.map(x=>x.potential));
  const pointsAgainstRank=rankHigh(mine.pa,rows.map(x=>x.pa));
  const half=Math.ceil(n/2),topThird=Math.max(1,Math.ceil(n/3));
  const executionRate=mine.potential>0?clamp(mine.pf/mine.potential,0,1):1;
  const injuries=Array.isArray(me.injured)?me.injured.length:0;
  const losing=Number(me.losses||0)>Number(me.wins||0);
  const strongUnderlying=potentialRank!=null&&potentialRank<=half;
  const hardSchedule=pointsAgainstRank!=null&&pointsAgainstRank<=topThird;
  const allPlayWeeks=Number(allPlay?.weeks||0);
  const allPlayWinPct=allPlay?.allPlayWinPct==null?null:Number(allPlay.allPlayWinPct);
  const expectedWins=allPlay?.expectedWins==null?null:Number(allPlay.expectedWins);
  const luckWins=allPlay?.luckWins==null?null:Number(allPlay.luckWins);
  const unluckyAllPlay=
    allPlayWeeks>=2 && allPlayWinPct!=null && allPlayWinPct>=50 &&
    luckWins!=null && luckWins<=-.6;
  const rankLeak=pfRank!=null&&potentialRank!=null?pfRank-potentialRank:0;
  const lineupLeak=strongUnderlying && rankLeak>=2 && executionRate<.94;

  let code,label,aggression,tradePosture;
  if(played<2){
    code="EARLY_SAMPLE";label="EARLY SAMPLE";
    aggression=1;tradePosture="neutral";
  }else if(lineupLeak){
    code="LINEUP_LEAK";label="LINEUP EXECUTION";
    aggression=.95;tradePosture="fix_lineup";
  }else if(strongUnderlying&&losing&&(unluckyAllPlay||hardSchedule)){
    code="SCHEDULE_VARIANCE";label="BAD-LUCK SCHEDULE";
    aggression=.86;tradePosture="hold_value";
  }else if(strongUnderlying&&losing){
    code="PROCESS_OK";label="RESULTS LAGGING";
    aggression=.92;tradePosture="hold_value";
  }else if(!strongUnderlying&&injuries>=3){
    code="DEPTH_STRESSED";label="INJURY / DEPTH STRESS";
    aggression=1.10;tradePosture="add_depth";
  }else if(!strongUnderlying){
    code="ROSTER_UPGRADE";label="NEEDS STARTER UPSIDE";
    aggression=1.15;tradePosture="consolidate";
  }else{
    code="CONTENDER";label="PROCESS HEALTHY";
    aggression=1;tradePosture="selective";
  }

  const confidence=played>=5?"HIGH":played>=2?"MEDIUM":"LOW";
  const rankText=pfRank&&potentialRank
    ? `PF ${ordinal(pfRank)}/${n}, potential ${ordinal(potentialRank)}/${n}`
    : "league ranks unavailable";
  const allPlayText=allPlayWeeks>=2&&expectedWins!=null&&allPlayWinPct!=null
    ? ` All-play ${Math.round(allPlayWinPct)}% (${expectedWins.toFixed(1)} expected wins vs ${Number(me.wins||0)} actual).`
    : "";
  let directive;
  if(code==="LINEUP_LEAK")directive="Prioritize start/sit accuracy over roster churn.";
  else if(code==="SCHEDULE_VARIANCE"||code==="PROCESS_OK")directive="Do not sell low because of the record.";
  else if(code==="ROSTER_UPGRADE")directive="Actively hunt starter upgrades and consolidation trades.";
  else if(code==="DEPTH_STRESSED")directive="Repair usable depth before paying for luxury upgrades.";
  else directive="Stay selective and only take clear edges.";

  return {
    code,label,confidence,aggression:round1(aggression),tradePosture,
    record:`${Number(me.wins||0)}-${Number(me.losses||0)}`,
    played,teams:n,
    pfPerGame:round1(mine.pf),potentialPerGame:round1(mine.potential),
    pointsAgainstPerGame:round1(mine.pa),benchLeakPerGame:round1(mine.leakage),
    executionRate:round1(executionRate*100),
    pfRank,potentialRank,pointsAgainstRank,
    allPlayWeeks:allPlayWeeks||0,
    allPlayExpectedWins:expectedWins==null?null:round1(expectedWins),
    allPlayWinPct:allPlayWinPct==null?null:round1(allPlayWinPct),
    scheduleLuckWins:luckWins==null?null:round1(luckWins),
    injuries,
    summary:`${rankText}.${allPlayText} ${directive}`.replace(/\s+/g," ").trim()
  };
}
