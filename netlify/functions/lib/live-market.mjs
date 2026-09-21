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

export function liveUsageCounts(stats={}){
  return {
    targets:first(stats,["targets","rec_tgt","receiving_targets","tgt"]),
    carries:first(stats,["carries","rush_att","rushing_attempts","rush_attempts"]),
    receptions:first(stats,["receptions","rec"]),
    offSnaps:first(stats,["off_snp","offense_snaps","off_snaps"]),
    teamOffSnaps:first(stats,["tm_off_snp","team_offense_snaps","team_off_snaps"]),
    routes:first(stats,["routes_run","routes","route_run","rec_routes"]),
    teamRoutes:first(stats,["tm_routes_run","team_routes_run","team_routes","tm_routes"]),
  };
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
  pos="UNK",stats={},progress=0,
  baselineTargets=0,baselineCarries=0,
  baselineTargetShare=null,baselineCarryShare=null,baselineRouteParticipation=null,
  teamTargets=0,teamRbCarries=0,teamRoutes=0
}={}){
  const p=clamp(Number(progress||0),0,1);
  if(p<=0)return null;

  const counts=liveUsageCounts(stats);
  const {targets,carries,receptions,offSnaps,teamOffSnaps,routes}=counts;
  const resolvedTeamRoutes=Number(teamRoutes||counts.teamRoutes||0);
  const snapShare=teamOffSnaps>0?offSnaps/teamOffSnaps:null;
  const routeParticipation=resolvedTeamRoutes>0?routes/resolvedTeamRoutes:null;
  const paceDen=Math.max(.28,p);
  const targetPace=targets/paceDen;
  const carryPace=carries/paceDen;
  const touchPace=(targets+carries)/paceDen;
  const baseT=Math.max(0,Number(baselineTargets||0));
  const baseC=Math.max(0,Number(baselineCarries||0));
  const baseTs=baselineTargetShare==null?null:clamp(Number(baselineTargetShare||0),0,1);
  const baseCs=baselineCarryShare==null?null:clamp(Number(baselineCarryShare||0),0,1);
  const baseRp=baselineRouteParticipation==null?null:clamp(Number(baselineRouteParticipation||0),0,1);
  const liveTargetShare=Number(teamTargets||0)>=8?targets/Number(teamTargets):null;
  const liveCarryShare=Number(teamRbCarries||0)>=7?carries/Number(teamRbCarries):null;
  const reasons=[];
  let volume=false,dominant=false,shareSignal=false,routeSignal=false;

  if(["WR","TE"].includes(String(pos).toUpperCase())){
    const threshold=Math.max(7,baseT*1.2);
    volume=(targets>=4&&targetPace>=threshold)||targets>=7;
    const shareFloor=Math.max(.24,(baseTs??.16)+.08);
    shareSignal=
      liveTargetShare!=null && Number(teamTargets)>=10 && targets>=4 &&
      liveTargetShare>=shareFloor;
    dominant=
      (targets>=6&&targetPace>=Math.max(8.5,baseT*1.35)) ||
      (liveTargetShare!=null&&Number(teamTargets)>=12&&targets>=5&&liveTargetShare>=.34);
    const routeFloor=Math.max(.72,(baseRp??.58)+.10);
    routeSignal=
      routeParticipation!=null && resolvedTeamRoutes>=20 && routes>=14 &&
      routeParticipation>=routeFloor;
    if(volume)reasons.push(`${targets} targets // ${round(targetPace)} target pace`);
    if(shareSignal){
      reasons.push(
        `${Math.round(liveTargetShare*100)}% live target share`+
        (baseTs!=null?` vs ${Math.round(baseTs*100)}% baseline`:"")
      );
    }
    if(routeSignal){
      reasons.push(
        `${Math.round(routeParticipation*100)}% live route participation`+
        (baseRp!=null?` vs ${Math.round(baseRp*100)}% baseline`:"")
      );
    }
  }else if(String(pos).toUpperCase()==="RB"){
    const carryThreshold=Math.max(11,baseC*1.15);
    volume=(carries>=6&&carryPace>=carryThreshold)||(targets>=3&&targetPace>=4.5);
    const shareFloor=Math.max(.48,(baseCs??.32)+.12);
    shareSignal=
      liveCarryShare!=null && Number(teamRbCarries)>=9 && carries>=5 &&
      liveCarryShare>=shareFloor;
    dominant=
      ((carries+targets)>=9&&touchPace>=Math.max(14,(baseC+baseT)*1.2)) ||
      (liveCarryShare!=null&&Number(teamRbCarries)>=12&&carries>=7&&liveCarryShare>=.62);
    if(volume)reasons.push(`${carries} carries + ${targets} targets // ${round(touchPace)} touch pace`);
    if(shareSignal){
      reasons.push(
        `${Math.round(liveCarryShare*100)}% live RB carries`+
        (baseCs!=null?` vs ${Math.round(baseCs*100)}% baseline`:"")
      );
    }
  }else{
    return null;
  }

  const snapSignal=snapShare!=null&&offSnaps>=16&&snapShare>=.62;
  if(snapSignal)reasons.push(`${Math.round(snapShare*100)}% offensive snaps`);
  const strong=
    dominant ||
    (volume&&snapSignal) ||
    (shareSignal&&(snapSignal||routeSignal||p>=.4)) ||
    (routeSignal&&(shareSignal||p>=.4)) ||
    (volume&&p>=.55);
  if(!volume&&!shareSignal&&!snapSignal&&!routeSignal)return null;

  return {
    targets,carries,receptions,
    offSnaps,teamOffSnaps,
    snapShare:snapShare==null?null:round(snapShare*100),
    routes,teamRoutes:resolvedTeamRoutes,
    routeParticipation:routeParticipation==null?null:round(routeParticipation*100),
    liveTargetShare:liveTargetShare==null?null:round(liveTargetShare*100),
    liveCarryShare:liveCarryShare==null?null:round(liveCarryShare*100),
    baselineTargetShare:baseTs==null?null:round(baseTs*100),
    baselineCarryShare:baseCs==null?null:round(baseCs*100),
    baselineRouteParticipation:baseRp==null?null:round(baseRp*100),
    targetPace:round(targetPace),carryPace:round(carryPace),touchPace:round(touchPace),
    progress:round(p*100),
    volume,dominant,shareSignal,routeSignal,snapSignal,strong,
    score:(dominant?3:0)+(volume?2:0)+(shareSignal?2:0)+(routeSignal?2:0)+(snapSignal?2:0),
    reasons
  };
}
