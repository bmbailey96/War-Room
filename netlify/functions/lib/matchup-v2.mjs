import { normName, normTeam } from "./war-v2.mjs";

const n=v=>v==null||v===""||v==="NA"||Number.isNaN(+v)?0:+v;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const round=x=>Math.round(x*10)/10;

function splitLine(line){
  const out=[];let field="",q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(q){
      if(c==='"'){if(line[i+1]==='"'){field+='"';i++;}else q=false;}
      else field+=c;
    }else if(c==='"')q=true;
    else if(c===","){out.push(field);field="";}
    else field+=c;
  }
  out.push(field);return out;
}

export function parseAllCsv(text){
  if(!text)return [];
  const lines=text.split(/\r?\n/).filter(Boolean);
  if(!lines.length)return [];
  const headers=splitLine(lines[0]);
  return lines.slice(1).map(line=>{
    const cells=splitLine(line),row={};
    headers.forEach((h,i)=>row[h]=cells[i]);
    return row;
  });
}

const first=(row,keys)=>{
  for(const k of keys){
    const v=row?.[k];
    if(v!=null&&String(v).trim()!=="")return v;
  }
  return null;
};
const posText=r=>[
  first(r,["pos_grp","position_group"]),
  first(r,["pos_name","position_name"]),
  first(r,["pos_abb","position","depth_position"]),
].filter(Boolean).join(" ").toUpperCase();

function depthName(r){
  return String(first(r,["player_name","full_name","football_name"])||
    [r.first_name,r.last_name].filter(Boolean).join(" ")).trim();
}
function depthTeam(r){return normTeam(first(r,["team","club_code","depth_team_code"]));}
function depthRank(r){
  const v=first(r,["pos_rank","depth_team","rank","depth"]);
  const x=Number(v);
  return Number.isFinite(x)&&x>0?x:99;
}
function depthRole(r){
  const s=posText(r);
  if(/NICKEL|SLOT|\bNB\b|\bSCB\b/.test(s))return "slot";
  if(/CORNER|\bCB\b|\bLCB\b|\bRCB\b/.test(s))return "outside";
  return "db";
}
function depthSide(r){
  const s=posText(r);
  if(/\bLCB\b|LEFT CORNER/.test(s))return "left";
  if(/\bRCB\b|RIGHT CORNER/.test(s))return "right";
  return null;
}
function isCorner(r){
  const s=posText(r);
  return /CORNER|\bCB\b|\bLCB\b|\bRCB\b|NICKEL|\bNB\b|\bSCB\b/.test(s);
}

export function buildDepthSecondaries(csvText,week=99){
  const rows=parseAllCsv(csvText);
  const byTeam={};

  // ESPN-era files are daily snapshots (2025+). Keep only the newest date
  // for each team. Legacy files are weekly, so keep the newest week <= now.
  const maxStamp={};
  for(const r of rows){
    const team=depthTeam(r);
    if(!team)continue;
    const dt=first(r,["dt","date"]);
    const wk=Number(first(r,["week","game_week"]));
    if(Number.isFinite(wk)&&wk>week)continue;
    const stamp=dt?Date.parse(dt):(Number.isFinite(wk)?wk:0);
    if(Number.isFinite(stamp))maxStamp[team]=Math.max(maxStamp[team]??-Infinity,stamp);
  }

  for(const r of rows){
    const team=depthTeam(r),name=depthName(r);
    if(!team||!name||!isCorner(r))continue;
    const dt=first(r,["dt","date"]);
    const wk=Number(first(r,["week","game_week"]));
    if(Number.isFinite(wk)&&wk>week)continue;
    const stamp=dt?Date.parse(dt):(Number.isFinite(wk)?wk:0);
    if(Number.isFinite(stamp)&&maxStamp[team]!=null&&stamp!==maxStamp[team])continue;
    const rec={
      name,team,role:depthRole(r),side:depthSide(r),rank:depthRank(r),
      slot:Number(first(r,["pos_slot"]))||null,
      pos:String(first(r,["pos_abb","position","depth_position"])||"CB"),
    };
    (byTeam[team]=byTeam[team]||[]).push(rec);
  }
  for(const arr of Object.values(byTeam)){
    arr.sort((a,b)=>(a.rank-b.rank)||((a.role==="slot"?1:0)-(b.role==="slot"?1:0))||a.name.localeCompare(b.name));
  }
  return byTeam;
}

export function buildSleeperSecondaries(playersDB={}){
  const byTeam={};
  for(const p of Object.values(playersDB||{})){
    const team=normTeam(p?.t),name=String(p?.n||"").trim();
    const pos=String(p?.p||"").toUpperCase();
    const fps=Array.isArray(p?.fp)?p.fp.map(x=>String(x).toUpperCase()):[];
    if(!team||!name)continue;
    if(!(pos==="CB"||pos==="DB"||fps.includes("DB")))continue;
    const rawDepth=String(p?.dp??"").toUpperCase();
    const role=/SLOT|NICKEL|\bNB\b|\bSCB\b/.test(rawDepth)?"slot":"outside";
    const side=/LCB|LEFT/.test(rawDepth)?"left":/RCB|RIGHT/.test(rawDepth)?"right":null;
    const rank=Number(p?.do);
    (byTeam[team]=byTeam[team]||[]).push({
      name,team,role,side,rank:Number.isFinite(rank)&&rank>0?rank:99,
      pos:rawDepth||pos||"CB",source:"sleeper_depth",
    });
  }
  for(const arr of Object.values(byTeam)){
    arr.sort((a,b)=>(a.rank-b.rank)||((a.role==="slot"?1:0)-(b.role==="slot"?1:0))||a.name.localeCompare(b.name));
  }
  return byTeam;
}

function defenderName(r){
  return String(first(r,["pfr_player_name","player","player_name","name"])||"").trim();
}

function coverageRaw(rows){
  if(!rows?.length)return null;
  let targets=0,comps=0,yards=0,tds=0,prNum=0,prDen=0;
  for(const r of rows){
    const t=n(first(r,["def_targets","targets","tgt","pass_targets"]));
    const cmp=n(first(r,["def_completions_allowed","completions","cmp","receptions_allowed","rec"]));
    const y=n(first(r,["def_yards_allowed","yards","yds","receiving_yards","rec_yards"]));
    const td=n(first(r,["def_receiving_td_allowed","touchdowns","td","tds","receiving_tds"]));
    const pr=Number(first(r,["def_passer_rating_allowed","passer_rating","rating","pass_rating"]));
    targets+=t;comps+=cmp;yards+=y;tds+=td;
    if(Number.isFinite(pr)&&t>0){prNum+=pr*t;prDen+=t;}
  }
  if(targets<1)return null;
  const cmpPct=comps/targets,ypt=yards/targets,tdRate=tds/targets;
  const passer=prDen?prNum/prDen:null;
  let score=0,weight=0;
  if(passer!=null){score+=clamp((95-passer)/25,-1.5,1.5)*.45;weight+=.45;}
  score+=clamp((8-ypt)/2.5,-1.5,1.5)*.30;weight+=.30;
  score+=clamp((.65-cmpPct)/.15,-1.5,1.5)*.15;weight+=.15;
  score+=clamp((.05-tdRate)/.05,-1.5,1.5)*.10;weight+=.10;
  return {
    targets,completions:comps,yards,tds,
    cmpPct:round(cmpPct*100),ypt:round(ypt),
    passerRating:passer==null?null:round(passer),
    score:weight?score/weight:0,
  };
}

function groupDef(rows,maxWeek=null){
  const out={};
  for(const r of rows){
    const gt=String(first(r,["game_type","season_type"])||"REG").toUpperCase();
    if(gt&&gt!=="REG")continue;
    const wk=Number(first(r,["week"]));
    if(maxWeek!=null&&Number.isFinite(wk)&&wk>=maxWeek)continue;
    const name=defenderName(r),key=normName(name);
    if(!key)continue;
    (out[key]=out[key]||[]).push(r);
  }
  return out;
}

export function buildDefenderCoverage(currentCsv,priorCsv,week){
  const cur=groupDef(parseAllCsv(currentCsv),week);
  const prior=groupDef(parseAllCsv(priorCsv),null);
  const names=new Set([...Object.keys(cur),...Object.keys(prior)]);
  const out={};
  for(const key of names){
    const c=coverageRaw(cur[key]||[]),p=coverageRaw(prior[key]||[]);
    if(!c&&!p)continue;
    const curTargets=c?.targets||0,priorTargets=p?.targets||0;
    const currentWeight=c?clamp(curTargets/(curTargets+18),.18,.78):0;
    const score=c&&p?c.score*currentWeight+p.score*(1-currentWeight):(c?.score??p.score);
    const effectiveTargets=curTargets+priorTargets*.3;
    out[key]={
      name:defenderName((cur[key]||prior[key]||[])[0]),
      score:round(score),
      reliability:round(clamp(effectiveTargets/28,.12,1)),
      currentTargets:curTargets,priorTargets,
      targets:curTargets+priorTargets,
      passerRating:c?.passerRating??p?.passerRating??null,
      ypt:c?.ypt??p?.ypt??null,
      cmpPct:c?.cmpPct??p?.cmpPct??null,
    };
  }
  return out;
}

function cbCandidates(team,secondaries,coverage,unavailableNames){
  const unavailable=unavailableNames||new Set();
  return (secondaries[normTeam(team)]||[])
    .filter(x=>!unavailable.has(normName(x.name)))
    .map(x=>({...x,coverage:coverage[normName(x.name)]||null}));
}

export function inferWrCoverage({
  opponent,receiverRank=1,receiverRole=null,receiverSide=null,
  secondaries={},coverage={},unavailableNames=new Set()
}={}){
  const teamKey=normTeam(opponent);
  const original=secondaries[teamKey]||[];
  const unavailable=unavailableNames||new Set();
  const unavailableStarters=original.filter(x=>x.rank===1&&unavailable.has(normName(x.name))).length;
  const all=cbCandidates(opponent,secondaries,coverage,unavailableNames);
  if(!all.length)return null;
  const slot=all.filter(x=>x.role==="slot");
  const outside=all.filter(x=>x.role!=="slot");
  let pool,assignmentConfidence,assignment;

  if(receiverRole==="slot"&&slot.length){
    pool=slot;assignmentConfidence=.74;assignment="likely slot matchup";
  }else if(receiverRole==="outside"){
    const oppositeSide=receiverSide==="left"?"right":receiverSide==="right"?"left":null;
    const sided=oppositeSide?outside.filter(x=>x.side===oppositeSide):[];
    pool=sided.length?sided:(outside.length?outside:all);
    assignmentConfidence=sided.length?.62:.54;
    assignment=sided.length?"likely side-specific outside matchup":"likely outside matchup";
  }else if(receiverRank>=3&&slot.length){
    pool=slot;assignmentConfidence=.58;assignment="possible slot matchup";
  }else{
    pool=outside.length?outside:all;
    assignmentConfidence=receiverRank===1?.46:.38;
    assignment=receiverRank===1?"likely primary outside matchup":"likely outside matchup";
  }

  // If there is no confirmed shadow information, use the strongest likely
  // starter in the relevant coverage pool as the matchup defender and keep
  // confidence intentionally modest.
  pool=[...pool].sort((a,b)=>{
    const ar=a.coverage?.score??0,br=b.coverage?.score??0;
    return (a.rank-b.rank)||(br-ar);
  });
  const defender=pool[0];
  if(!defender)return null;
  const cov=defender.coverage;
  const rel=cov?.reliability??.15;
  const rawScore=cov?.score??0;
  const attritionEdge=Math.min(.02,unavailableStarters*.012)*assignmentConfidence;
  const edge=clamp(-rawScore*rel*assignmentConfidence*.055+attritionEdge,-.04,.05);
  return {
    defender:defender.name,
    defenderRole:defender.role,
    assignment,
    assignmentConfidence:round(assignmentConfidence*100),
    defenderCoverageScore:cov?.score??null,
    defenderTargets:cov?.currentTargets??0,
    defenderPasserRating:cov?.passerRating??null,
    defenderYpt:cov?.ypt??null,
    coverageReliability:round(rel*100),
    unavailableStartingCorners:unavailableStarters,
    edgePct:round(edge*100),
    multiplier:1+edge,
    source:"depth_chart_inference",
  };
}

export function receiverRanks(currentRows,priorRows,week){
  const scoreRows=(rows,maxWeek)=>{
    const by={};
    for(const r of rows||[]){
      const wk=n(r.week);
      if(maxWeek!=null&&wk>=maxWeek)continue;
      if(String(r.position||"").toUpperCase()!=="WR")continue;
      const team=normTeam(r.team),key=normName(r.player_display_name);
      if(!team||!key)continue;
      (by[team]=by[team]||{})[key]=(by[team][key]||[]);
      by[team][key].push(r);
    }
    return by;
  };
  const cur=scoreRows(currentRows,week),prior=scoreRows(priorRows,null),out={};
  const teams=new Set([...Object.keys(cur),...Object.keys(prior)]);
  for(const team of teams){
    const names=new Set([...Object.keys(cur[team]||{}),...Object.keys(prior[team]||{})]);
    const scored=[];
    for(const name of names){
      const c=(cur[team]?.[name]||[]).slice(-4),p=(prior[team]?.[name]||[]).slice(-5);
      const metric=rows=>{
        if(!rows.length)return null;
        let nume=0,den=0;
        rows.forEach((r,i)=>{
          const w=Math.pow(.82,rows.length-1-i);
          const ts=n(r.target_share),wopr=n(r.wopr),tg=n(r.targets);
          const v=wopr>0?wopr:(ts>0?ts*1.8:tg/10);
          nume+=v*w;den+=w;
        });
        return den?nume/den:null;
      };
      const cm=metric(c),pm=metric(p);
      const games=c.length;
      const cw=Math.min(.8,.25+games*.14);
      const value=cm!=null&&pm!=null?cm*cw+pm*(1-cw):(cm??pm??0);
      scored.push({name,value});
    }
    scored.sort((a,b)=>b.value-a.value);
    scored.forEach((x,i)=>out[`${team}|${x.name}`]=i+1);
  }
  return out;
}


function teamPressureRows(rows,maxWeek=null){
  const weekly={};
  for(const r of rows||[]){
    const gt=String(first(r,["game_type","season_type"])||"REG").toUpperCase();
    if(gt&&gt!=="REG")continue;
    const wk=Number(first(r,["week"]));
    if(maxWeek!=null&&Number.isFinite(wk)&&wk>=maxWeek)continue;
    const team=normTeam(first(r,["team","club_code"]));
    if(!team||!Number.isFinite(wk))continue;
    const key=`${team}|${wk}`,x=weekly[key]||(weekly[key]={team,week:wk,pressure:0});
    const direct=Number(first(r,["def_pressures","pressures","pressure"]));
    if(Number.isFinite(direct))x.pressure+=direct;
    else{
      x.pressure+=n(first(r,["def_times_hurried","hurries","qb_hurries","hur"]));
      x.pressure+=n(first(r,["def_times_hitqb","qb_hits","hits","qbkd"]));
      x.pressure+=n(first(r,["def_sacks","sacks","sk"]));
    }
  }
  const byTeam={};
  for(const x of Object.values(weekly))(byTeam[x.team]=byTeam[x.team]||[]).push(x);
  return byTeam;
}

export function buildTeamPassRush(currentCsv,priorCsv,week){
  const cur=teamPressureRows(parseAllCsv(currentCsv),week);
  const prior=teamPressureRows(parseAllCsv(priorCsv),null);
  const teams=new Set([...Object.keys(cur),...Object.keys(prior)]);
  const raw={};
  for(const team of teams){
    const c=cur[team]||[],p=prior[team]||[];
    const cm=c.length?c.reduce((s,x)=>s+x.pressure,0)/c.length:null;
    const pm=p.length?p.reduce((s,x)=>s+x.pressure,0)/p.length:null;
    const cw=Math.min(.75,.18+c.length*.14);
    const value=cm!=null&&pm!=null?cm*cw+pm*(1-cw):(cm??pm);
    if(value!=null)raw[team]={pressurePerGame:value,currentGames:c.length};
  }
  const vals=Object.values(raw).map(x=>x.pressurePerGame).filter(Number.isFinite);
  const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  if(!avg)return {};
  const out={};
  for(const [team,x] of Object.entries(raw)){
    const ratio=clamp(x.pressurePerGame/avg,.65,1.4);
    // This is deliberately small because fantasy points allowed already
    // captures some pass-rush effect. It is a micro edge, not a second model.
    const edge=clamp((1-ratio)*.03,-.015,.015);
    out[team]={
      pressurePerGame:round(x.pressurePerGame),
      leagueAverage:round(avg),
      ratio:round(ratio),
      edgePct:round(edge*100),
      multiplier:1+edge,
      confidence:x.currentGames>=3?"MEDIUM":"LOW",
    };
  }
  return out;
}
