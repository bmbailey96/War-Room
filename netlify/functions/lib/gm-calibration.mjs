// Model scorecard from the last truly pre-kickoff stored player forecasts
// and completed league-scored Sleeper matchup points.
// The independent baseline is a trailing mean of that player's previous
// three available league-scored weeks, requiring at least two samples.
// No hidden postgame projection changes can enter this grade.
const round=x=>Math.round(x*100)/100;
const number=x=>x!=null&&Number.isFinite(Number(x))?Number(x):null;
const key=x=>String(x);
const validPos=new Set(["QB","RB","WR","TE","K","DEF","DL","LB","DB"]);
const normalizePos=(raw,db)=>{
  const p=db||{};
  const fp=p.fp||p.fantasy_positions||[];
  for(const candidate of ["QB","RB","WR","TE","K","DEF","DL","LB","DB"])
    if(fp.includes(candidate))return candidate;
  const pos=String(raw||p.p||p.position||"").toUpperCase();
  if(validPos.has(pos))return pos;
  if(["DE","DT"].includes(pos))return "DL";
  if(["CB","FS","SS","S"].includes(pos))return "DB";
  return "OTHER";
};
const summarize=samples=>{
  if(!samples.length)return {n:0,modelMae:null,naiveMae:null,modelBias:null,modelWinsAgainstNaive:null};
  const m=samples.filter(x=>x.naive!=null);
  const err=samples.reduce((s,x)=>s+Math.abs(x.pred-x.actual),0);
  const bias=samples.reduce((s,x)=>s+(x.pred-x.actual),0);
  return {n:samples.length,modelMae:round(err/samples.length),
    naiveCompared:m.length,naiveMae:m.length?round(m.reduce((s,x)=>s+Math.abs(x.naive-x.actual),0)/m.length):null,
    modelMaeCompared:m.length?round(m.reduce((s,x)=>s+Math.abs(x.pred-x.actual),0)/m.length):null,
    modelWinsAgainstNaive:m.length?round(m.filter(x=>Math.abs(x.pred-x.actual)<Math.abs(x.naive-x.actual)).length/m.length*100):null,
    modelBias:round(bias/samples.length)};
};

export function gradeCapturedProjections(completedWeeks=[],predictionLogs=[],playersDB={}) {
  const seenPrior=new Map();
  const results=[];
  let unsafeOrMissing=0,logged=0;
  const weeks=[...(completedWeeks||[])].sort((a,b)=>a.week-b.week);
  const logs=predictionLogs||{};
  for(const week of weeks) {
    const current={};
    for(const row of week.rows||[])for(const [pid,score] of Object.entries(row?.players_points||{}))
      if(number(score)!=null)current[key(pid)]=Number(score);
    const snapshot=Array.isArray(logs)?logs.find(x=>Number(x?.week)===Number(week.week)):logs[week.week];
    const players=snapshot?.players||{};
    for(const [pid,p] of Object.entries(players)) {
      const currentScore=current[pid],projection=number(p?.projection);
      if(currentScore==null||projection==null)continue;
      logged++;
      // Some legacy snapshots contain refreshes taken during/after games.
      // No kickoff timestamp, or a saved-after-kickoff entry, is gradeable.
      const saved=number(p?.savedAt),kickoff=number(p?.kickoffAt);
      if(saved==null||kickoff==null||saved>kickoff){unsafeOrMissing++;continue}
      if(snapshot?.season!=null&&snapshot?.week!=null&&Number(snapshot.week)!==Number(week.week)){
        unsafeOrMissing++;continue;
      }
      const prev=(seenPrior.get(pid)||[]).slice(-3);
      const naive=prev.length>=2?prev.reduce((a,b)=>a+b,0)/prev.length:null;
      const position=normalizePos(p.slot,playersDB[pid]);
      results.push({week:week.week,pid,name:p.name||playersDB[pid]?.n||pid,position,
        source:p.source||(p.fallback?"sleeper":"custom"),pred:projection,actual:currentScore,naive,
        error:round(projection-currentScore),absoluteError:round(Math.abs(projection-currentScore))});
    }
    for(const [pid,score] of Object.entries(current)){
      const hist=seenPrior.get(pid)||[];
      hist.push(score);seenPrior.set(pid,hist.slice(-3));
    }
  }

  const base=summarize(results);
  const byPosition={};
  for(const p of ["QB","RB","WR","TE","K","DEF","DL","LB","DB","OTHER"]){
    const rows=results.filter(x=>x.position===p);
    if(rows.length)byPosition[p]=summarize(rows);
  }
  const custom=results.filter(x=>["QB","RB","WR","TE"].includes(x.position)&&x.source!=="sleeper");
  const customGrade=summarize(custom);
  const eligible=results.filter(x=>x.naive!=null);
  const trailing=results.filter(x=>x.week>=Math.max(1,Number(weeks.at(-1)?.week||0)-2));
  const verdict=base.n===0?"NO_VERIFIED_PREGAME_SAMPLES"
    :base.naiveCompared<20?"INSUFFICIENT_BASELINE_COMPARISON"
    :base.modelMaeCompared<base.naiveMae-.25?"MODEL_BEATS_NAIVE"
    :base.modelMaeCompared>base.naiveMae+.25?"NAIVE_BEATS_MODEL":"TIE_WITHIN_POINT_25";
  return {
    evaluatedAt:Date.now(),
    completedWeeks:weeks.length,
    savedForecastsMatchedToScores:logged,
    excludedAfterKickoffOrMissingTimestamp:unsafeOrMissing,
    evaluatedSamples:results.length,
    verdict,
    overall:base,
    qbRbWrTeNonSleeper:customGrade,
    byPosition,
    recentModelMisses:trailing.sort((a,b)=>b.absoluteError-a.absoluteError)
      .slice(0,6).map(x=>({week:x.week,name:x.name,position:x.position,
        projection:round(x.pred),actual:round(x.actual),error:x.error,source:x.source})),
    note:"Grades only saved pre-kickoff predictions against actual Sleeper league points. Naive benchmark is previous 2-3 observed league-scored games for the same player; it is not a consensus expert projection. Small samples and survivor/ownership effects limit conclusions."
  };
}
