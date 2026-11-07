// Independent GM-review input and validation. Pure functions, no API access.
// The reviewer may reason about audited evidence but may not add new assets,
// change Sleeper ownership, or represent news as independently verified.
const short = (value,max=550) => String(value||"").replace(/[\u0000-\u001f]/g," ").trim().slice(0,max);
const metrics = {
  record:"Observed Sleeper win-loss record",
  pointsFor:"League points-for ranking",
  allPlay:"Counterfactual all-play results, if season coverage is complete",
  positionalDepth:"Observed available roster positions",
  availablePlayers:"Ownership-checked waiver candidates, possibly stale",
  candidateTrades:"Ownership-checked player trade simulations",
  managerNeeds:"Current coverage shortages and active depth before/after trades for each roster",
  managerBehavior:"Actual completed trades and inferred competitive direction; no claim of stated preferences",
  pickHoldings:"Reconstructed dynasty picks, when pick endpoint was available",
  forecastAccuracy:"Pre-kickoff model error and comparable baseline",
  informationGaps:"Audit limitations, freshness, and missing source data"
};
export const evidenceFields=Object.keys(metrics);

export function buildReviewRequest(audit) {
  if(!audit?.league?.id||!audit?.me||!audit?.tradeInventory)
    throw new Error("Complete GM audit required");
  if(audit.cache?.fresh===false)throw new Error("Stale audit cannot be sent for review");
  const choices=[
    {id:"HOLD",type:"HOLD",title:"Hold assets pending stronger evidence",source:"No transaction"},
    ...(audit.freeAgents?.verified?(audit.freeAgents.candidates||[]).slice(0,5).map((x,i)=>({
      id:"WAIVER:"+i,type:"WAIVER",title:"Investigate adding "+x.name+(x.drop?" instead of "+x.drop:""),
      source:"Ownership-verified Sleeper free-agent scan",
      candidate:{name:x.name,pos:x.pos,drop:x.drop,weeklyModelGain:x.potentialWeeklyGain}
    })):[]),
    ...(audit.tradeSimulations||[]).slice(0,5).map((x,i)=>({
      id:"TRADE:"+i,type:"TRADE",
      title:"Study "+x.partner+": send "+x.send.map(p=>p.name).join(" + ")+" for "+x.get.name,
      source:"Ownership-checked existing model simulation",
      candidate:{partner:x.partner,send:x.send.map(p=>p.name),get:x.get.name,
        myWeeklyModelDelta:x.myWeeklyModelDelta,
        theirWeeklyModelDelta:x.theirWeeklyModelDelta,
        marketModelDelta:x.dynastyModelValueDelta,
        structuralFit:x.twoSidedFit?{
          status:x.twoSidedFit.status,
          myNeedsAddressed:x.twoSidedFit.yourReasons||[],
          otherOwnerNeedsAddressed:x.twoSidedFit.theirReasons||[],
          myNewShortages:x.twoSidedFit.yourRisks||[],
          otherOwnerNewShortages:x.twoSidedFit.theirRisks||[],
          otherOwnerCurrentDirection:x.twoSidedFit.inferredOtherDirection||"Unknown",
          observedBehavior:x.twoSidedFit.why||[],
          wishesVerified:false
        }:null}
    }))
  ];
  const safe={
    league:{id:audit.league.id,name:audit.league.name,mode:audit.league.mode,
      week:audit.league.week,teamCount:audit.league.teamCount,
      playoffTeams:audit.league.playoffTeams},
    auditAt:audit.at,
    me:{
      name:audit.me.name,wins:audit.me.wins,losses:audit.me.losses,
      standing:audit.me.standing,pfRank:audit.me.pfRank,
      potentialRank:audit.me.potentialRank,allPlay:audit.me.allPlay,
      needs:audit.me.needs,
      activeDepth:audit.me.depth?.active,
      roster:(audit.me.depth?.players||[]).map(p=>({
        id:p.id,name:p.name,pos:p.pos,injury:p.injury,age:p.age,onReserve:p.onReserve
      })),
      picks:audit.coverage?.pickLedgerVerified===false?null:(audit.me.picks||[]).map(p=>({
        season:p.season,round:p.round,originalTeam:p.originalTeam
      })),
    },
    otherTeams:(audit.teams||[]).filter(t=>!t.isMe).map(t=>({
      name:t.name,standing:t.standing,pfRank:t.pfRank,allPlay:t.allPlay,
      needs:t.needs,availableDepth:t.availableDepth,tradeCount:t.tradeCount,
      observedPositionsAcquired:t.tradeHistory?.positionsAcquired||{},
      historicalPicksAcquired:t.tradeHistory?.futurePicksAcquired||0
    })),
    modelValidation:audit.validation?{
      verdict:audit.validation.verdict,overall:audit.validation.overall,
      samples:audit.validation.evaluatedSamples
    }:null,
    coverage:audit.coverage,
    diagnosis:audit.diagnosis,
    limitations:audit.limitations,
    choices
  };
  return {choices,context:safe,evidenceFields};
}

export function makePrompt(data) {
  return [
    "You are an independent fantasy football general manager reviewing an evidence packet.",
    "Do NOT echo the existing model's conclusions uncritically. Challenge assumptions.",
    "Only refer to player names and trade assets listed in the packet. Do not invent free agents, trades or draft picks.",
    "Do not claim to have checked live injuries, news or external consensus; NO web search is being performed.",
    "Differentiate historic scoring and modeled projections. All-play is a counterfactual, NOT playoff odds.",
    "Do not recommend automatic trades; these are proposals for a human to investigate.",
    "Assess BOTH managers' needs and gaps, positional scarcity, change in FLEX/startable depth, draft picks, team timelines, roster cuts and available alternatives.",
    "A positive point delta for both teams DOES NOT by itself establish that a trade is desirable or that the other owner wants these assets.",
    "State a plausible reason for the OTHER owner to consider the trade, grounded in observed roster structure or actual transaction history. Past trades are a clue, not proof of preferences.",
    "If no persuasive two-sided incentive is supported by the provided facts, choose HOLD rather than manufacturing a trade rationale.",
    "Choose one single candidate from the provided choices by exact id. HOLD is valid.",
    "Treat uncertain evidence as unresolved. Explain the strongest opposing argument.",
    "Use cited evidence keys from this whitelist ONLY: "+JSON.stringify(evidenceFields)+".",
    'Return ONLY one strict JSON object with keys "stance","summary","choiceId","reason",'+
      '"countercase","whatToVerify","evidenceKeys".',
    'stance must be one of "CONTEND","FRINGE","RETOOL","REBUILD","UNKNOWN".',
    "No Markdown or code fences. Each explanation text is max 400 characters.",
    "Evidence packet:\n"+JSON.stringify(data.context),
  ].join("\n\n");
}

export function validateReview(raw,data) {
  const source=String(raw||"").trim();
  let obj;
  try{obj=JSON.parse(source)}catch{
    const start=source.indexOf("{"),end=source.lastIndexOf("}");
    if(start<0||end<=start)throw new Error("AI response was not valid JSON");
    try{obj=JSON.parse(source.slice(start,end+1))}catch{throw new Error("AI response was not valid JSON")}
  }
  const allowed=new Set((data.choices||[]).map(x=>x.id));
  if(!allowed.has(obj.choiceId))throw new Error("AI proposed an asset not in the verified candidate list");
  const stance=["CONTEND","FRINGE","RETOOL","REBUILD","UNKNOWN"].includes(obj.stance)?obj.stance:"UNKNOWN";
  const keys=[...new Set(Array.isArray(obj.evidenceKeys)?obj.evidenceKeys:[])]
    .filter(x=>evidenceFields.includes(x));
  const chosen=data.choices.find(x=>x.id===obj.choiceId);
  return {
    stance,choiceId:obj.choiceId,
    title:chosen.title,choiceType:chosen.type,
    choiceSource:chosen.source,
    summary:short(obj.summary,400),
    reason:short(obj.reason,400),
    countercase:short(obj.countercase,400),
    whatToVerify:short(obj.whatToVerify,400),
    evidence:keys.map(k=>({id:k,description:metrics[k]})),
    disclaimer:"AI reasoning based only on cached league data. No official player news was independently checked. No trades or waivers were executed."
  };
}
