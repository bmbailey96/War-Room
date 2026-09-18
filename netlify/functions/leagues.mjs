import { USERNAME, MY_USER_ID } from "./lib/ocho.mjs";

async function j(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function getMyLeagues() {
  const user = await j(`https://api.sleeper.app/v1/user/${USERNAME}`);
  const state = await j("https://api.sleeper.app/v1/state/nfl").catch(() => ({}));
  const seasons = [...new Set([
    Number(state.season) || new Date().getFullYear(),
    new Date().getFullYear(),
    new Date().getFullYear() - 1,
  ])];

  const found = new Map();
  for (const season of seasons) {
    const rows = await j(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${season}`).catch(() => []);
    for (const league of rows || []) {
      if (found.has(league.league_id)) continue;
      const rosters = await j(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).catch(() => []);
      const mine = rosters.find(r => r.owner_id === MY_USER_ID);
      if (!mine) continue;
      found.set(league.league_id, {
        id: league.league_id,
        name: league.name || "Unnamed league",
        season: Number(league.season) || season,
        status: league.status || null,
        totalRosters: league.total_rosters || rosters.length,
        rosterId: mine.roster_id,
      });
    }
    if (found.size >= 2) break;
  }
  return [...found.values()].sort((a,b) => a.name.localeCompare(b.name));
}

export default async () => {
  try {
    const leagues = await getMyLeagues();
    return new Response(JSON.stringify({ leagues }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502, headers: { "content-type": "application/json" },
    });
  }
};
