const n=v=>v==null||v===""||Number.isNaN(Number(v))?0:Number(v);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const round=x=>Math.round(Number(x||0)*10)/10;

function first(row,keys){
  for(const key of keys){
    const v=row?.[key];
    if(v!=null&&v!==""&&Number.isFinite(Number(v)))return Number(v);
  }
  return 0;
}

export function normalizeSleeperWeekStats(raw){
  const out={};
  if(Array.isArray(raw)){
    for(const row of raw){
      const pid=String(row?.player_id??row?.player?.player_id??row?.player?.id??"");
      if(!pid)continue;
      out[pid]=row?.stats&&typeof row.stats==="object"?row.stats:row;
    }
    return out;
  }
  if(raw&&typeof raw==="object"){
    for(const [pid,row] of Object.entries(raw)){
      if(!pid||!row)continue;
      out[String(pid)]=row?.stats&&typeof row.stats==="object"?row.stats:row;
    }
  }
  return out;
}

export function liveGameProgress(kickoffAt,nowMs=Date.now()){
  if(!kickoffAt)return 0;
  const ko=new Date(kickoffAt).getTime();
  if(!Number.isFinite(ko)||nowMs<=ko)return 0;
  return clamp((nowMs-ko)/(4*60*60*1000),0,1);
}

export function liveRoleEmergence({
  pos="UNK",stats={},progress=0,baselineTargets=0,baselineCarries=0
}={}){
  const p=clamp(Number(progress||0),0,1);
  if(p<=0)return null;

  const targets=first(stats,["targets","rec_tgt","receiving_targets","tgt"]);
  const carries=first(stats,["carries","rush_att","rushing_attempts","rush_attempts"]);
  const receptions=first(stats,["receptions","rec"]);
  const offSnaps=first(stats,["off_snp","offense_snaps","off_snaps"]);
  const teamOffSnaps=first(stats,["tm_off_snp","team_offense_snaps","team_off_snaps"]);
  const snapShare=teamOffSnaps>0?offSnaps/teamOffSnaps:null;
  const paceDen=Math.max(.28,p);
  const targetPace=targets/paceDen;
  const carryPace=carries/paceDen;
  const touchPace=(targets+carries)/paceDen;
  const baseT=Math.max(0,Number(baselineTargets||0));
  const baseC=Math.max(0,Number(baselineCarries||0));
  const reasons=[];
  let volume=false,dominant=false;

  if(["WR","TE"].includes(String(pos).toUpperCase())){
    const threshold=Math.max(7,baseT*1.2);
    volume=(targets>=4&&targetPace>=threshold)||targets>=7;
    dominant=targets>=6&&targetPace>=Math.max(8.5,baseT*1.35);
    if(volume)reasons.push(`${targets} targets // ${round(targetPace)} target pace`);
  }else if(String(pos).toUpperCase()==="RB"){
    const carryThreshold=Math.max(11,baseC*1.15);
    volume=(carries>=6&&carryPace>=carryThreshold)||(targets>=3&&targetPace>=4.5);
    dominant=(carries+targets)>=9&&touchPace>=Math.max(14,(baseC+baseT)*1.2);
    if(volume)reasons.push(`${carries} carries + ${targets} targets // ${round(touchPace)} touch pace`);
  }else{
    return null;
  }

  const snapSignal=snapShare!=null&&offSnaps>=16&&snapShare>=.62;
  if(snapSignal)reasons.push(`${Math.round(snapShare*100)}% offensive snaps`);
  const strong=dominant||(volume&&snapSignal)||(volume&&p>=.55);
  if(!volume&&!snapSignal)return null;

  return {
    targets,carries,receptions,
    offSnaps,teamOffSnaps,
    snapShare:snapShare==null?null:round(snapShare*100),
    targetPace:round(targetPace),carryPace:round(carryPace),touchPace:round(touchPace),
    progress:round(p*100),
    volume,dominant,snapSignal,strong,
    score:(dominant?3:0)+(volume?2:0)+(snapSignal?2:0),
    reasons
  };
}
