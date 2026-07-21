// LEAGUE MEMORY. Runs weekly. Mines the full transaction history across all
// tracked seasons to learn THIS league's specific tendencies over time, the
// stuff a static behavior file can't capture: who actually completes trades
// vs who only talks, which owners deal with which other owners (trade
// partnerships), who churns their roster (lots of adds/drops) vs who sits
// still, and seasonal timing (who sells in the back half). This gets folded
// into the trade prompts so the AI knows not just what an owner wants, but
// how they actually behave.

import {
  blobs, resolveLeague, OWNER_HISTORY,
} from "./lib/ocho.mjs";

async function allSeasonLeagueIds(currentId) {
  // walk previous_league_id chain
  const ids = [];
  let id = currentId;
  for (let i = 0; i < 6 && id; i++) {
    try {
      const lg = await fetch(`https://api.sleeper.app/v1/league/${id}`).then(r => r.json());
      ids.push({ id, season: lg.season });
      id = lg.previous_league_id;
    } catch (e) { break; }
  }
  return ids;
}

async function fetchTxns(leagueId) {
  const all = [];
  for (let w = 1; w <= 18; w++) {
    try {
      const t = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`).then(r => r.json());
      if (Array.isArray(t)) all.push(...t);
    } catch (e) { /* skip */ }
  }
  return all;
}

export default async () => {
  const store = blobs();
  const currentId = await resolveLeague();

  // Map roster_id -> owner_id per season can shift; we track by owner via rosters
  const seasons = await allSeasonLeagueIds(currentId);
  const partnerCounts = {};   // "ownerA|ownerB" -> completed trades
  const tradeCount = {};      // owner -> completed trades
  const churn = {};           // owner -> adds+drops (waiver/free agent activity)
  const bySeasonHalf = {};    // owner -> {early, late} trade counts

  for (const { id, season } of seasons) {
    // roster_id -> owner_id for this season
    let rosterOwner = {};
    try {
      const rosters = await fetch(`https://api.sleeper.app/v1/league/${id}/rosters`).then(r => r.json());
      for (const r of rosters) rosterOwner[r.roster_id] = r.owner_id;
    } catch (e) { continue; }

    const txns = await fetchTxns(id);
    for (const t of txns) {
      if (t.status !== "complete") continue;
      const owners = (t.roster_ids || []).map(rid => rosterOwner[rid]).filter(Boolean);
      const wk = t.leg || 0;
      if (t.type === "trade" && owners.length === 2) {
        for (const o of owners) {
          tradeCount[o] = (tradeCount[o] || 0) + 1;
          bySeasonHalf[o] = bySeasonHalf[o] || { early: 0, late: 0 };
          if (wk <= 7) bySeasonHalf[o].early++; else bySeasonHalf[o].late++;
        }
        const key = [owners[0], owners[1]].sort().join("|");
        partnerCounts[key] = (partnerCounts[key] || 0) + 1;
      } else if (t.type === "waiver" || t.type === "free_agent") {
        for (const o of owners) churn[o] = (churn[o] || 0) + 1;
      }
    }
  }

  // Build per-owner tendency lines
  const tendencies = {};
  for (const [oid, h] of Object.entries(OWNER_HISTORY)) {
    const tc = tradeCount[oid] || 0;
    const ch = churn[oid] || 0;
    const half = bySeasonHalf[oid] || { early: 0, late: 0 };
    const partners = Object.entries(partnerCounts)
      .filter(([k]) => k.split("|").includes(oid))
      .map(([k, n]) => {
        const other = k.split("|").find(x => x !== oid);
        return { name: (OWNER_HISTORY[other] || {}).display_name || other, n };
      })
      .sort((a, b) => b.n - a.n)
      .slice(0, 2);
    tendencies[oid] = {
      name: h.display_name,
      completedTrades: tc,
      churn: ch,
      churnLevel: ch >= 60 ? "high" : ch >= 25 ? "moderate" : "low",
      timing: half.late > half.early * 1.3 ? "deals more in the back half (deadline seller)" : half.early > half.late * 1.3 ? "deals early, quiet late" : "deals evenly across the season",
      favoritePartners: partners,
    };
  }

  await store.setJSON("league_memory", { at: Date.now(), seasons: seasons.map(s => s.season), tendencies });

  return new Response(JSON.stringify({ ok: true, seasons: seasons.length, owners: Object.keys(tendencies).length }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "30 15 * * 3" };
