const USERNAME="sigourneybeaver";
const MY_USER_ID="863128676391383040";

async function j(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const state=await j("https://api.sleeper.app/v1/state/nfl");
const user=await j(`https://api.sleeper.app/v1/user/${USERNAME}`);
const leagues=await j(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${state.season}`);
const players=await j("https://api.sleeper.app/v1/players/nfl");
const laportaEntry=Object.entries(players).find(([,p])=>p?.full_name==="Sam LaPorta");
const laportaPid=laportaEntry?.[0]||null;

const mine=[];
for(const league of leagues||[]){
  const rosters=await j(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
  const roster=rosters.find(r=>r.owner_id===MY_USER_ID);
  if(!roster)continue;
  const matchups=await j(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/${state.week}`);
  const row=matchups.find(m=>m.roster_id===roster.roster_id);
  const starterIndex=laportaPid ? (row?.starters||[]).indexOf(laportaPid) : -1;
  mine.push({
    id:league.league_id,
    name:league.name,
    season:league.season,
    status:league.status,
    rosterPositions:league.roster_positions,
    scoringSettings:league.scoring_settings,
    myRosterId:roster.roster_id,
    week:state.week,
    laporta:{
      playerId:laportaPid,
      rostered:laportaPid ? (roster.players||[]).includes(laportaPid) : false,
      starter:starterIndex>=0,
      starterIndex,
      actual:laportaPid && row?.players_points ? row.players_points[laportaPid] ?? null : null,
    },
  });
}

console.log(JSON.stringify({
  nfl:{season:state.season,week:state.week,season_type:state.season_type},
  user:{username:USERNAME,userId:user.user_id},
  leagues:mine,
},null,2));

if(mine.length<2){
  throw new Error(`Expected at least two current Sleeper leagues for ${USERNAME}, found ${mine.length}`);
}
