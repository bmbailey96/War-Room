export const ROSTER_ACTIONS_CACHE_VERSION="v5";

export function rosterActionsCacheKey(leagueId){
  return `roster_actions_${ROSTER_ACTIONS_CACHE_VERSION}_${leagueId}`;
}

export function rosterActionsLockKey(leagueId){
  return `roster_actions_refresh_${ROSTER_ACTIONS_CACHE_VERSION}_${leagueId}`;
}
