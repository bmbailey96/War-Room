import { normName, normTeam } from "./war-v2.mjs";

const n=v=>v==null||v===""||v==="NA"||Number.isNaN(+v)?0:+v;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const round=x=>Math.round(x*10)/10;

function weighted(rows,getter){
  if(!rows?.length)return null;
  let num=0,den=0;
  rows.forEach((r,i)=>{
    const v=getter(r);
    if(v==null||!Number.isFinite(Number(v)))return;
    const w=Math.pow(.82,rows.length-1-i);
    num+=Number(v)*w;den+=w;
  });
  return den?num/den:null;
}

function weeklyRbCarries(rows,maxWeek=null){
  const totals={};
  for(const r of rows||[]){
    const wk=n(r.week);
    if(!wk || (maxWeek!=null&&wk>=maxWeek))continue;
    if(String(r.position||"").toUpperCase()!=="RB")continue;
    const team=normTeam(r.team);
    if(!team)continue;
    const key=`${team}|${wk}`;
    totals[key]=(totals[key]||0)+n(r.carries);
  }
  return totals;
}

function rowsByName(rows,maxWeek=null){
  const out={};
  for(const r of rows||[]){
    const wk=n(r.week);
    if(maxWeek!=null&&wk>=maxWeek)continue;
    const key=normName(r.player_display_name);
    if(!key)continue;
    (out[key]=out[key]||[]).push(r);
  }
  for(const a of Object.values(out))a.sort((x,y)=>n(x.week)-n(y.week));
  return out;
}

function blend(cur,prev,curGames){
  if(cur==null)return prev??null;
  if(prev==null)return cur;
  const cw=Math.min(.82,.28+curGames*.16);
  return cur*cw+prev*(1-cw);
}

function profileFromRows(current,prior,currentCarryTotals,priorCarryTotals){
  const c=(current||[]).slice(-4),p=(prior||[]).slice(-6);
  const last=c.at(-1)||p.at(-1);
  if(!last)return null;
  const team=normTeam(last.team),pos=String(last.position||"").toUpperCase();

  const targetShare=rows=>weighted(rows,r=>{
    const v=Number(r.target_share);
    return Number.isFinite(v)&&v>=0?v:null;
  });
  const carryShare=(rows,totals)=>weighted(rows,r=>{
    if(String(r.position||"").toUpperCase()!=="RB")return null;
    const team=normTeam(r.team),wk=n(r.week),den=totals[`${team}|${wk}`]||0;
    return den>0?n(r.carries)/den:null;
  });
  const adot=rows=>{
    let air=0,targets=0;
    for(const r of rows||[]){
      const t=n(r.targets),a=n(r.receiving_air_yards);
      if(t<=0)continue;
      targets+=t;air+=a;
    }
    return targets?air/targets:null;
  };
  const targetVolume=rows=>(rows||[]).reduce((s,r)=>s+n(r.targets),0);

  const cTs=targetShare(c),pTs=targetShare(p);
  const cCs=carryShare(c,currentCarryTotals),pCs=carryShare(p,priorCarryTotals);
  const cAdot=adot(c),pAdot=adot(p);
  const cTargets=targetVolume(c),pTargets=targetVolume(p);

  return {
    name:String(last.player_display_name||""),
    key:normName(last.player_display_name),
    team,pos,currentGames:c.length,
    targetShare:blend(cTs,pTs,c.length),
    carryShare:blend(cCs,pCs,c.length),
    aDot:blend(cAdot,pAdot,c.length),
    currentTargets:cTargets,priorTargets:pTargets,
    effectiveTargets:cTargets+pTargets*.35,
  };
}

export function buildOpportunityProfiles(currentRows,priorRows,week){
  const cur=rowsByName(currentRows,week),prev=rowsByName(priorRows,null);
  const curCarries=weeklyRbCarries(currentRows,week);
  const prevCarries=weeklyRbCarries(priorRows,null);
  const names=new Set([...Object.keys(cur),...Object.keys(prev)]);
  const out={};
  for(const key of names){
    const p=profileFromRows(cur[key],prev[key],curCarries,prevCarries);
    if(p)out[key]=p;
  }
  return out;
}

export function buildVacatedOpportunity(profiles,unavailableNames=new Set()){
  const out={};
  const unavailable=unavailableNames||new Set();
  for(const p of Object.values(profiles||{})){
    if(!p?.team||!["WR","TE","RB"].includes(p.pos))continue;
    const t=out[p.team]||(out[p.team]={
      activeTargetShare:0,vacatedTargetShare:0,
      activeRbCarryShare:0,vacatedRbCarryShare:0,
      vacatedNames:[],activeNames:[]
    });
    const isOut=unavailable.has(p.key);
    if(p.targetShare!=null){
      if(isOut)t.vacatedTargetShare+=Math.max(0,p.targetShare);
      else t.activeTargetShare+=Math.max(0,p.targetShare);
    }
    if(p.pos==="RB"&&p.carryShare!=null){
      if(isOut)t.vacatedRbCarryShare+=Math.max(0,p.carryShare);
      else t.activeRbCarryShare+=Math.max(0,p.carryShare);
    }
    (isOut?t.vacatedNames:t.activeNames).push(p.name);
  }
  for(const t of Object.values(out)){
    t.vacatedTargetShare=clamp(t.vacatedTargetShare,0,.65);
    t.vacatedRbCarryShare=clamp(t.vacatedRbCarryShare,0,.9);
  }
  return out;
}

export function vacatedOpportunityEdge(profile,teamContext){
  if(!profile||!teamContext||!["WR","TE","RB"].includes(profile.pos))return null;
  const names=teamContext.vacatedNames||[];
  if(!names.length)return null;

  let edge=0,extraTarget=0,extraCarry=0;
  const ownTs=Math.max(0,Number(profile.targetShare||0));
  const activeTs=Math.max(.01,Number(teamContext.activeTargetShare||0));
  const vacTs=Math.max(0,Number(teamContext.vacatedTargetShare||0));

  if((profile.pos==="WR"||profile.pos==="TE")&&ownTs>.025&&vacTs>=.04){
    const capture=clamp(ownTs/activeTs,.08,.7);
    extraTarget=vacTs*.55*capture;
    const relative=extraTarget/Math.max(.08,ownTs);
    edge+=clamp(relative*.25,0,.075);
  }

  if(profile.pos==="RB"){
    const ownCarry=Math.max(0,Number(profile.carryShare||0));
    const activeCarry=Math.max(.01,Number(teamContext.activeRbCarryShare||0));
    const vacCarry=Math.max(0,Number(teamContext.vacatedRbCarryShare||0));
    if(ownCarry>.04&&vacCarry>=.06){
      const capture=clamp(ownCarry/activeCarry,.08,.82);
      extraCarry=vacCarry*.72*capture;
      const relative=extraCarry/Math.max(.1,ownCarry);
      edge+=clamp(relative*.2,0,.075);
    }
    if(ownTs>.015&&vacTs>=.04){
      const capture=clamp(ownTs/activeTs,.05,.65);
      extraTarget=vacTs*.42*capture;
      edge+=clamp((extraTarget/Math.max(.06,ownTs))*.08,0,.025);
    }
  }

  edge=clamp(edge,0,.09);
  if(edge<.004)return null;
  const reliability=clamp(
    (Number(profile.effectiveTargets||0)/24)+
    (profile.pos==="RB" && profile.carryShare!=null ? .18 : 0),
    .15,1
  );
  return {
    edgePct:round(edge*100),
    multiplier:1+edge,
    reliability:round(reliability*100),
    confidence:reliability>=.45?"MEDIUM":"LOW",
    vacatedTargetPct:round(vacTs*100),
    vacatedCarryPct:round(Number(teamContext.vacatedRbCarryShare||0)*100),
    extraTargetPct:round(extraTarget*100),
    extraCarryPct:round(extraCarry*100),
    names:names.slice(0,4),
    source:"vacated_opportunity",
  };
}

export function receiverArchetype(aDot){
  if(aDot==null||!Number.isFinite(Number(aDot)))return null;
  const x=Number(aDot);
  if(x<7.5)return "underneath";
  if(x<13.5)return "intermediate";
  return "vertical";
}

function rowArchetype(r){
  const t=n(r.targets);
  if(t<=0)return null;
  return receiverArchetype(n(r.receiving_air_yards)/t);
}

function archetypeRaw(rows,maxWeek=null){
  const out={};
  for(const r of rows||[]){
    const wk=n(r.week);
    if(maxWeek!=null&&wk>=maxWeek)continue;
    if(String(r.position||"").toUpperCase()!=="WR")continue;
    const def=normTeam(r.opponent_team),type=rowArchetype(r);
    const targets=n(r.targets);
    if(!def||!type||targets<=0)continue;
    const key=`${def}|${type}`;
    const x=out[key]||(out[key]={team:def,type,targets:0,receptions:0,yards:0,tds:0,weeks:new Set()});
    x.targets+=targets;
    x.receptions+=n(r.receptions);
    x.yards+=n(r.receiving_yards);
    x.tds+=n(r.receiving_tds);
    x.weeks.add(wk);
  }
  return out;
}

function pprPerTarget(x){
  if(!x?.targets)return null;
  return (x.receptions+x.yards*.1+x.tds*6)/x.targets;
}

export function buildWrArchetypeDefense(currentRows,priorRows,week){
  const cur=archetypeRaw(currentRows,week),prev=archetypeRaw(priorRows,null);
  const keys=new Set([...Object.keys(cur),...Object.keys(prev)]);
  const blended={};

  for(const key of keys){
    const c=cur[key],p=prev[key];
    const cv=pprPerTarget(c),pv=pprPerTarget(p);
    if(cv==null&&pv==null)continue;
    const curTargets=c?.targets||0,priorTargets=p?.targets||0;
    const cw=cv!=null?clamp(curTargets/(curTargets+35),.12,.72):0;
    const value=cv!=null&&pv!=null?cv*cw+pv*(1-cw):(cv??pv);
    const [team,type]=key.split("|");
    const effectiveTargets=curTargets+priorTargets*.3;
    blended[key]={
      team,type,pprPerTarget:value,
      currentTargets:curTargets,priorTargets,
      reliability:clamp(effectiveTargets/55,.12,1),
      currentWeeks:c?.weeks?.size||0,
    };
  }

  const league={};
  for(const type of ["underneath","intermediate","vertical"]){
    const vals=Object.values(blended).filter(x=>x.type===type).map(x=>x.pprPerTarget).filter(Number.isFinite);
    league[type]=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }

  const out={};
  for(const x of Object.values(blended)){
    const avg=league[x.type];
    if(!avg||!x.pprPerTarget)continue;
    const ratio=clamp(x.pprPerTarget/avg,.72,1.32);
    const raw=clamp((ratio-1)*.075,-.026,.028);
    const edge=raw*x.reliability;
    (out[x.team]=out[x.team]||{})[x.type]={
      archetype:x.type,
      pprPerTarget:round(x.pprPerTarget),
      leaguePprPerTarget:round(avg),
      ratio:round(ratio),
      reliability:round(x.reliability*100),
      currentTargets:x.currentTargets,
      priorTargets:x.priorTargets,
      edgePct:round(edge*100),
      multiplier:1+edge,
      confidence:x.currentTargets>=18?"MEDIUM":"LOW",
      source:"receiver_archetype_defense",
    };
  }
  return out;
}

export function receiverArchetypeEdge(profile,opponent,defense,exposure=1){
  if(!profile||profile.pos!=="WR")return null;
  const type=receiverArchetype(profile.aDot);
  if(!type)return null;
  const row=defense?.[normTeam(opponent)]?.[type];
  if(!row)return null;
  const rel=clamp(Number(row.reliability||0)/100,.12,1);
  const profileRel=clamp(Number(profile.effectiveTargets||0)/28,.18,1);
  const raw=Number(row.edgePct||0)/100;
  const edge=clamp(raw*profileRel*clamp(Number(exposure||1),.45,1.25),-.022,.024);
  return {
    ...row,
    archetype:type,
    aDot:round(profile.aDot),
    profileReliability:round(profileRel*100),
    edgePct:round(edge*100),
    multiplier:1+edge,
    confidence:rel>=.4&&profileRel>=.35?"MEDIUM":"LOW",
  };
}
