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

export function diagnoseTeamState(teams=[],me=null){
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
  const scoringStrong=pfRank!=null&&pfRank<=half;
  const hardSchedule=pointsAgainstRank!=null&&pointsAgainstRank<=topThird;
  const rankLeak=pfRank!=null&&potentialRank!=null?pfRank-potentialRank:0;
  const lineupLeak=strongUnderlying && rankLeak>=2 && executionRate<.94;

  let code,label,aggression,tradePosture;
  if(played<2){
    code="EARLY_SAMPLE";label="EARLY SAMPLE";
    aggression=1;tradePosture="neutral";
  }else if(lineupLeak){
    code="LINEUP_LEAK";label="LINEUP EXECUTION";
    aggression=.95;tradePosture="fix_lineup";
  }else if(strongUnderlying&&losing&&hardSchedule){
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
    injuries,
    summary:`${rankText}. ${directive}`
  };
}
