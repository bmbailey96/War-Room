export const ROSTER_ACTIONS_CACHE_VERSION="v7";

export function rosterActionsCacheKey(leagueId){
  return `roster_actions_${ROSTER_ACTIONS_CACHE_VERSION}_${leagueId}`;
}

export function rosterActionsLockKey(leagueId){
  return `roster_actions_refresh_${ROSTER_ACTIONS_CACHE_VERSION}_${leagueId}`;
}

// The move board can be fairly stable Tue-Sat, but Sunday is a live market:
// injuries happen, depth charts change, and Sleeper add velocity can explode.
// Times are UTC so the behavior is stable regardless of the Netlify region.
export function rosterActionsFreshnessMs(nowMs=Date.now()){
  const d=new Date(nowMs),day=d.getUTCDay(),hour=d.getUTCHours();

  // Sunday 9 AM-ish Mountain through the end of Sunday Night Football.
  const sundaySlate=(day===0&&hour>=15)||(day===1&&hour<=5);
  if(sundaySlate)return 6*60*1000;

  // Monday/Thursday primetime windows get a modestly faster board too.
  const primetime=
    (day===1&&hour>=22)||(day===2&&hour<=5)||
    (day===4&&hour>=22)||(day===5&&hour<=5);
  if(primetime)return 30*60*1000;

  return 4*60*60*1000;
}

export function rosterFreshnessLabel(nowMs=Date.now()){
  const ms=rosterActionsFreshnessMs(nowMs);
  if(ms<=10*60*1000)return "SUNDAY_PULSE";
  if(ms<=30*60*1000)return "PRIMETIME";
  return "NORMAL";
}
