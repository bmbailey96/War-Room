import { getStore } from "@netlify/blobs";

export const USERNAME = "sigourneybeaver";
export const MY_USER_ID = "863128676391383040";

const TEAM_ALIASES = {
  LA:"LAR",STL:"LAR",SD:"LAC",OAK:"LV",JAC:"JAX",WSH:"WAS",
  ARZ:"ARI",BLT:"BAL",CLV:"CLE",HST:"HOU"
};

export function store() {
  return getStore("war-room-v2");
}

export async function json(url, tries=3) {
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(url);
      if(r.ok)return r.json();
      last=new Error(`${url} -> ${r.status}`);
    }catch(e){last=e}
    await new Promise(r=>setTimeout(r,350*(i+1)));
  }
  throw last || new Error("request failed");
}

export function normTeam(code) {
  if(!code)return code;
  const up=String(code).toUpperCase();
  return TEAM_ALIASES[up]||up;
}

export function normName(s) {
  return (s||"").toLowerCase()
    .replace(/[^a-z ]/g,"")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"")
    .replace(/\s+/g," ").trim();
}

const SLOT_PRIORITY=["QB","RB","WR","TE","K","DEF","DL","LB","DB"];
export function slotPos(p) {
  const fps=(p&&p.fps)||[];
  for(const s of SLOT_PRIORITY)if(fps.includes(s))return s;
  return (p&&p.pos)||"UNK";
}

export function pInfo(db,pid) {
  const p=db[pid];
  if(!p)return {name:pid,pos:null,fps:[],age:null,team:null,inj:null};
  return {name:p.n,pos:p.p,fps:p.fp||(p.p?[p.p]:[]),age:p.a,team:p.t,inj:p.inj};
}

export async function getPlayersTrim() {
  const s=store();
  const cached=await s.get("players",{type:"json"}).catch(()=>null);
  // Injury status is lineup-critical. A 20-hour cache can survive straight
  // through a Friday/Saturday designation change, so keep this fresh in season.
  if(cached && Date.now()-cached.at < 60*60*1000)return cached.data;
  const full=await json("https://api.sleeper.app/v1/players/nfl");
  const trim={};
  for(const [pid,p] of Object.entries(full||{})){
    if(!p || (!p.position && !p.fantasy_positions))continue;
    trim[pid]={
      n:p.full_name||`${p.first_name||""} ${p.last_name||""}`.trim()||pid,
      p:p.position||null,fp:p.fantasy_positions||null,a:p.age||null,
      t:p.team||null,inj:p.injury_status||null,
    };
  }
  await s.setJSON("players",{at:Date.now(),data:trim});
  return trim;
}

export async function callClaude(prompt,{maxTokens=1600,useSearch=true,model="claude-sonnet-4-6"}={}) {
  if(!process.env.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY is not set");
  const body={model,max_tokens:maxTokens,messages:[{role:"user",content:prompt}]};
  if(useSearch)body.tools=[{type:"web_search_20250305",name:"web_search"}];
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-api-key":process.env.ANTHROPIC_API_KEY,
      "anthropic-version":"2023-06-01",
    },
    body:JSON.stringify(body),
  });
  const data=await r.json();
  if(!r.ok || data.error)throw new Error(data.error?.message||`Anthropic -> ${r.status}`);
  return (data.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n");
}
