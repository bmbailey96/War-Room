import { normName, slotPos } from "./war-v2.mjs";

export function detectLeagueMode(league={}) {
  const s=league.settings||{};
  const type=Number(s.type);
  const pickTrading=Number(s.pick_trading||0);
  const rounds=Number(s.draft_rounds||0);
  const dynasty=type===2 || (pickTrading>0 && rounds>0 && rounds<=6);
  return dynasty ? "DYNASTY" : "REDRAFT";
}

const OCHO_LEAGUE_ID="1205222463223365632";
const DAY_NAMES=["SUN","MON","TUE","WED","THU","FRI","SAT"];

export function leagueRuleProfile(league={}) {
  const id=String(league.league_id||league.id||"");
  const name=String(league.name||"");

  // Prefer the stable Sleeper league id. The name fallback keeps older/test
  // fixtures working if the id is absent, but renaming the live league no
  // longer changes transaction behavior.
  if(id===OCHO_LEAGUE_ID || /\bocho\b/i.test(name)){
    return {
      acquisitionMode:"OPEN_FA",
      canAddStartedPlayers:true,
      source:id===OCHO_LEAGUE_ID?"USER_CONFIRMED_ID":"USER_CONFIRMED_OCHO_NAME"
    };
  }

  // This private War Room currently has one other active league, and the user
  // confirmed that league uses waivers. Keep this explicit rather than trying
  // to infer transaction legality from loosely documented numeric settings.
  return {
    acquisitionMode:"WAIVERS",
    canAddStartedPlayers:false,
    source:"USER_CONFIRMED_WAIVER_LEAGUE"
  };
}

export function acquisitionPolicy(league={}) {
  const rules=leagueRuleProfile(league);
  return {
    mode:rules.acquisitionMode,
    canAddStartedPlayers:rules.canAddStartedPlayers,
    label:rules.acquisitionMode==="OPEN_FA"?"OPEN FREE AGENCY":"WAIVERS",
    source:rules.source
  };
}

export function waiverScheduleFromSettings(settings={}) {
  const dayRaw=Number(settings.waiver_day_of_week);
  const hasDay=Number.isInteger(dayRaw)&&dayRaw>=0&&dayRaw<=6;
  const afterGameDay=hasDay?DAY_NAMES[dayRaw]:null;
  const afterGameProcessDay=hasDay?DAY_NAMES[(dayRaw+1)%7]:null;
  const hourRaw=Number(settings.daily_waivers_hour);
  const processHour=Number.isInteger(hourRaw)&&hourRaw>=0&&hourRaw<=23?hourRaw:null;
  const dropRaw=Number(settings.waiver_clear_days);
  const dropClearDays=Number.isFinite(dropRaw)&&dropRaw>=0?dropRaw:null;
  const dailyEnabled=Number(settings.daily_waivers||0)===1;

  return {
    afterGameDayIndex:hasDay?dayRaw:null,
    afterGameDay,
    afterGameProcessDay,
    afterGameLabel:hasDay?(afterGameDay+" AFTER DAY → "+afterGameProcessDay):null,
    dailyEnabled,
    dailyWaiversDays:settings.daily_waivers_days??null,
    processHour,
    dropClearDays,
    raw:{
      waiver_day_of_week:settings.waiver_day_of_week??null,
      daily_waivers:settings.daily_waivers??null,
      daily_waivers_days:settings.daily_waivers_days??null,
      daily_waivers_hour:settings.daily_waivers_hour??null,
      waiver_clear_days:settings.waiver_clear_days??null,
    }
  };
}
export function teamNameMap(users=[]) {
  return Object.fromEntries(users.map(u=>[
    u.user_id,
    u.metadata?.team_name || u.display_name || u.user_id
  ]));
}

export function strengthRank(rosters=[]) {
  const rows=rosters.map(r=>{
    const s=r.settings||{};
    const wins=Number(s.wins||0), losses=Number(s.losses||0);
    const fpts=Number(s.fpts||0)+(Number(s.fpts_decimal||0)/100);
    return {rosterId:r.roster_id,wins,losses,fpts};
  }).sort((a,b)=>(b.wins-a.wins)||(b.fpts-a.fpts));
  const out={};
  rows.forEach((r,i)=>out[r.rosterId]=i+1);
  return out;
}

export function pickTier(originRosterId, ranks={}, teamCount=12) {
  const rank=ranks[originRosterId];
  if(!rank)return "mid";
  const third=Math.max(1,Math.ceil(teamCount/3));
  // Strong team -> late rookie pick. Weak team -> early rookie pick.
  if(rank<=third)return "late";
  if(rank>teamCount-third)return "early";
  return "mid";
}

export function buildPickLedger({league,rosters,users,tradedPicks=[]}) {
  const mode=detectLeagueMode(league);
  if(mode!=="DYNASTY")return {};
  const names=teamNameMap(users);
  const ownerOfRoster=Object.fromEntries(rosters.map(r=>[r.roster_id,r.owner_id]));
  const rounds=Math.max(1,Number(league.settings?.draft_rounds||3));
  const season=Number(league.season)||new Date().getFullYear();
  const draftPending=["pre_draft","drafting"].includes(league.status);
  const seasons=[
    ...(draftPending?[season]:[]),
    season+1,season+2,season+3
  ];
  const ranks=strengthRank(rosters);
  const ledger=Object.fromEntries(rosters.map(r=>[r.roster_id,[]]));
  const moved=new Set();

  for(const p of tradedPicks||[]){
    const yr=Number(p.season);
    if(!seasons.includes(yr))continue;
    const origin=p.roster_id;
    const owner=p.owner_id;
    if(!ledger[owner])ledger[owner]=[];
    ledger[owner].push({
      season:yr,round:Number(p.round),originRosterId:origin,
      originalTeam:names[ownerOfRoster[origin]]||String(origin),
      tier:pickTier(origin,ranks,rosters.length),
    });
    moved.add(`${yr}|${Number(p.round)}|${origin}`);
  }

  for(const yr of seasons){
    for(let round=1;round<=rounds;round++){
      for(const r of rosters){
        const key=`${yr}|${round}|${r.roster_id}`;
        if(moved.has(key))continue;
        ledger[r.roster_id].push({
          season:yr,round,originRosterId:r.roster_id,
          originalTeam:names[r.owner_id]||String(r.roster_id),
          tier:pickTier(r.roster_id,ranks,rosters.length),
        });
      }
    }
  }

  for(const rows of Object.values(ledger)){
    rows.sort((a,b)=>(a.season-b.season)||(a.round-b.round)||a.originalTeam.localeCompare(b.originalTeam));
  }
  return ledger;
}

export function pickLabel(p) {
  if(!p)return "";
  const ord={1:"1st",2:"2nd",3:"3rd",4:"4th",5:"5th",6:"6th"}[p.round]||`R${p.round}`;
  return `${p.season} ${ord} (${p.originalTeam}, ${p.tier})`;
}

export function rosteredSet(rosters=[]) {
  const set=new Set();
  for(const r of rosters)for(const pid of r.players||[])set.add(pid);
  return set;
}

export function positionalDepth(roster,db) {
  const d={QB:0,RB:0,WR:0,TE:0,K:0,DEF:0,DL:0,LB:0,DB:0};
  for(const pid of roster?.players||[]){
    const p=db[pid];
    if(!p)continue;
    const pos=slotPos({pos:p.p,fps:p.fp||(p.p?[p.p]:[])});
    if(d[pos]!=null)d[pos]++;
  }
  return d;
}

export function starterNeeds(rosterPositions=[]) {
  const d={QB:0,RB:0,WR:0,TE:0,K:0,DEF:0,DL:0,LB:0,DB:0,FLEX:0,SUPER_FLEX:0};
  for(const slot of rosterPositions||[]){
    if(d[slot]!=null)d[slot]++;
  }
  return d;
}

export function actionFingerprint(a={}) {
  const asset=x=>typeof x==="string"?x:(x?.name||x?.label||"");
  return [
    a.type||"",
    asset(a.add),asset(a.drop),a.partner||"",
    ...(a.send||[]).map(asset),
    ...(a.receive||[]).map(asset),
  ].map(x=>normName(String(x))).join("|");
}

export function validateActions(actions,{myNames=new Set(),freeNames=new Set(),teamPlayers={},myPicks=new Set(),teamPicks={},dynasty=false}={}) {
  const clean=[];
  for(const raw of Array.isArray(actions)?actions:[]){
    if(!raw || !raw.type)continue;
    const a={...raw};
    const type=String(a.type).toUpperCase();
    a.type=type;

    if(["ADD","WAIVER","ADD_DROP"].includes(type)){
      const add=normName(a.add?.name||a.add||"");
      const drop=normName(a.drop?.name||a.drop||"");
      if(!add || !freeNames.has(add))continue;
      if(drop && !myNames.has(drop))continue;
    }

    if(["TRADE_FOR","SELL"].includes(type)){
      if(!a.partner || !teamPlayers[a.partner])continue;
      const theirs=teamPlayers[a.partner];
      const theirPicks=teamPicks[a.partner]||new Set();
      let valid=true;
      for(const x of a.receive||[]){
        if(x?.type==="pick"){
          if(!dynasty || !theirPicks.has(String(x?.name||x))){valid=false;break;}
          continue;
        }
        if(!theirs.has(normName(x?.name||x))){valid=false;break;}
      }
      for(const x of a.send||[]){
        if(x?.type==="pick"){
          if(!dynasty || !myPicks.has(String(x?.name||x))){valid=false;break;}
        }else if(!myNames.has(normName(x?.name||x))){
          valid=false;break;
        }
      }
      if(!valid)continue;
    }

    if(type==="HOLD" || ["ADD","WAIVER","ADD_DROP","TRADE_FOR","SELL"].includes(type))clean.push(a);
  }
  const seen=new Set();
  return clean.filter(a=>{
    const k=actionFingerprint(a);
    if(seen.has(k))return false;
    seen.add(k);return true;
  }).slice(0,6);
}
