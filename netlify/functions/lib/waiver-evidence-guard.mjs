// Conservative redraft waiver guard: prevent dropping a newly emerged
// high-volume player for a speculative bench stash, and stop expensive
// backup-QB claims when a 1-QB league already has a healthy starter.
// This is based on observed recent usage and lineup structure, not news.
const n=x=>x!=null&&Number.isFinite(Number(x))?Number(x):null;
const recentNumeric=(values=[])=>Array.isArray(values)?values.map(n).filter(x=>x!=null):[];
const injuryUnavailable=v=>/^(out|ir|pup|nfi|sus|suspended|inactive)$/i.test(String(v||""));

export function waiverEvidenceGuard({mode="REDRAFT",action={},add=null,drop=null,
  weeklyDelta=null,activeSlots=[],roster=[]}={}) {
  const reasons=[];
  if(mode!=="REDRAFT")return {block:false,reasons};
  const delta=n(weeklyDelta);
  if(delta==null)return {block:true,reasons:["Missing verified starting-lineup delta; do not issue a waiver claim without the simulated result."]};

  if(drop?.pos==="RB"&&delta<2) {
    const seq=recentNumeric(drop.recentCarrySequence);
    const last=seq.at(-1);
    const earlier=seq.slice(0,-1);
    const previous=earlier.length?earlier.reduce((a,b)=>a+b,0)/earlier.length:null;
    const sharpNewWorkload=last!=null&&last>=18&&(previous==null||last>=previous*1.35);
    const recent=n(drop.recentCarries),prior=n(drop.baselineCarries);
    const stableRisingWorkload=recent!=null&&recent>=12&&prior!=null&&prior>=0&&recent>=prior*1.3;
    if(sharpNewWorkload||stableRisingWorkload)
      reasons.push("Proposed cut has a substantial recent carry-volume surge ("+
        (last!=null?last+" in latest recorded game":recent+" per recent game")+
        "). Do not cut for a speculative bench stash until the workload and injury status are rechecked.");
  }

  const singleQb=activeSlots.filter(slot=>slot==="QB").length===1
    && !activeSlots.includes("SUPER_FLEX");
  const healthyQb=roster.filter(p=>p.pos==="QB"&&!injuryUnavailable(p.injury)).length;
  const faab=n(action.faabPct);
  if(singleQb&&add?.pos==="QB"&&healthyQb>=1&&delta<.75&&faab!=null&&faab>=8)
    reasons.push("Backup QB bid of "+faab+"% FAAB with a healthy starting QB and no immediate lineup gain. Reserve FAAB for scarce starters.");

  return {block:reasons.length>0,reasons,observedOnly:true};
}
