import { normName } from "./war-v2.mjs";

const PLAYERS_URL="https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const PICKS_URL="https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-picks.csv";

async function text(url){
  const r=await fetch(url,{redirect:"follow"});
  if(!r.ok)return null;
  return r.text();
}
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
function parseCsv(value){
  if(!value)return[];
  const lines=value.split(/\r?\n/).filter(Boolean);
  if(!lines.length)return[];
  const head=splitLine(lines.shift());
  return lines.map(line=>{
    const cells=splitLine(line),row={};
    head.forEach((h,i)=>row[h]=cells[i]);
    return row;
  });
}
const num=v=>v==null||v===""||Number.isNaN(+v)?0:+v;

export function pickTierFactor(tier){
  return tier==="early"?1.18:tier==="late"?.84:1;
}

export async function getDynastyMarket(s){
  const cached=await s.get("dynasty_market",{type:"json"}).catch(()=>null);
  if(cached&&Date.now()-(cached.at||0)<12*60*60*1000)return cached;

  const [playerText,pickText]=await Promise.all([text(PLAYERS_URL),text(PICKS_URL)]);
  if(!playerText)return {at:Date.now(),scrapeDate:null,players:{},picks:{}};

  const rows=parseCsv(playerText);
  const rawMax=Math.max(...rows.map(r=>num(r.value_1qb)),1);
  const players={},ladder=[];
  let scrapeDate=null;
  for(const r of rows){
    const raw=num(r.value_1qb),ecr=num(r.ecr_1qb);
    if(!r.player||raw<=0)continue;
    players[normName(r.player)]={
      value:Math.round(raw/rawMax*100),
      pos:r.pos||null,team:r.team||null,age:num(r.age)||null,
    };
    if(ecr>0)ladder.push({ecr,raw});
    scrapeDate=r.scrape_date||scrapeDate;
  }
  ladder.sort((a,b)=>a.ecr-b.ecr);
  const valueAtEcr=ecr=>{
    if(!ladder.length)return 0;
    if(ecr<=ladder[0].ecr)return ladder[0].raw;
    if(ecr>=ladder.at(-1).ecr)return ladder.at(-1).raw;
    for(let i=0;i<ladder.length-1;i++){
      const a=ladder[i],b=ladder[i+1];
      if(a.ecr<=ecr&&b.ecr>=ecr){
        const f=(ecr-a.ecr)/Math.max(1,b.ecr-a.ecr);
        return a.raw+f*(b.raw-a.raw);
      }
    }
    return 0;
  };

  const buckets={};
  for(const r of parseCsv(pickText)){
    const ecr=num(r.ecr_1qb);
    if(!ecr||!r.player)continue;
    const m=String(r.player).match(/(20\d\d).*?(\d)(?:\.(\d\d)|st|nd|rd|th)/i);
    if(!m)continue;
    const key=`${Number(m[1])}|${Number(m[2])}`;
    const value=Math.round(valueAtEcr(ecr)/rawMax*100);
    (buckets[key]=buckets[key]||[]).push(value);
  }
  const picks={};
  for(const [key,values] of Object.entries(buckets)){
    picks[key]=Math.round(values.reduce((a,b)=>a+b,0)/values.length);
  }

  const out={at:Date.now(),scrapeDate,players,picks};
  await s.setJSON("dynasty_market",out).catch(()=>{});
  return out;
}

export function pickValue(pick,market,tier="mid"){
  if(!pick||!market)return null;
  const base=market.picks?.[`${pick.season}|${pick.round}`];
  if(base==null)return null;
  const years=Math.max(0,Number(pick.season)-new Date().getFullYear()-1);
  return Math.round(base*pickTierFactor(tier)*Math.pow(.92,years));
}
