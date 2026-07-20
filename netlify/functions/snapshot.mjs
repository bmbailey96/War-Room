// Runs every 2 hours. Pulls the full league state, computes the survey,
// diffs transactions against what we've already seen, and appends
// human-readable changelog entries. Sets a "dirty" flag when the league
// actually changed so the next analysis run knows to dig in.

import {
  blobs, resolveLeague, fetchLeagueCore, getPlayersTrim,
  computeSnapshot, describeTransaction,
} from "./lib/ocho.mjs";

async function notify(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { title, "content-type": "text/plain" },
      body: message.slice(0, 500),
    });
  } catch (e) { /* best effort */ }
}

export default async (req) => {
  const store = blobs();
  const leagueId = await resolveLeague();
  const core = await fetchLeagueCore(leagueId);
  const playersDB = await getPlayersTrim();
  const snapshot = computeSnapshot(core, playersDB);

  // Transaction diff
  const seen = (await store.get("seen_txn_ids", { type: "json" })) || [];
  const seenSet = new Set(seen);
  const newTxns = [];
  for (const week of core.txnWeeks) {
    for (const t of week || []) {
      if (t.status === "complete" && t.transaction_id && !seenSet.has(t.transaction_id)) {
        newTxns.push(t);
        seenSet.add(t.transaction_id);
      }
    }
  }
  newTxns.sort((a, b) => (a.created || 0) - (b.created || 0));

  const changelog = (await store.get("changelog", { type: "json" })) || [];
  const firstRun = seen.length === 0;
  if (!firstRun) {
    for (const t of newTxns) {
      changelog.push({
        at: t.created || Date.now(),
        type: t.type,
        desc: describeTransaction(t, snapshot, playersDB),
      });
    }
  }
  // Keep the most recent 60 entries
  while (changelog.length > 60) changelog.shift();

  const dirty = !firstRun && newTxns.length > 0;
  await store.setJSON("snapshot", snapshot);
  await store.setJSON("seen_txn_ids", [...seenSet]);
  await store.setJSON("changelog", changelog);
  if (dirty) await store.setJSON("dirty", { at: Date.now(), count: newTxns.length });

  // Stash the trending block inputs so analysis doesn't refetch
  await store.setJSON("trending_raw", core.trending || []);
  await store.setJSON("rosters_raw", core.rosters.map(r => ({ roster_id: r.roster_id, players: r.players || [] })));

  // TREND ENGINE: keep one lightweight datapoint per team per DAY so we can
  // compute what's changing over time (roster moves, depth shifts, injury
  // counts, standing). Snapshot runs every 2h; we only append a new day's
  // point once per calendar day to keep the history compact.
  const trends = (await store.get("trends", { type: "json" })) || { days: [] };
  const today = new Date().toISOString().slice(0, 10);
  const lastDay = trends.days.length ? trends.days[trends.days.length - 1].date : null;
  if (lastDay !== today) {
    const point = {
      date: today,
      teams: snapshot.teams.map(t => ({
        name: t.name,
        wins: t.wins, losses: t.losses,
        depth: t.depth,
        injuredCount: (t.injured || []).length,
        avgAge: t.avgAge,
        picks: t.picks.length,
        rosterSize: (t.players || []).length,
        seed: t.projectedSeed,
      })),
    };
    trends.days.push(point);
    while (trends.days.length > 60) trends.days.shift();
    await store.setJSON("trends", trends);
  }

  // React to the league changing, don't just record it
  if (dirty) {
    const tradeHappened = newTxns.some(t => t.type === "trade");
    const summary = newTxns.slice(-3).map(t => describeTransaction(t, snapshot, playersDB)).join("\n");
    await notify(
      tradeHappened ? "TRADE in The Ocho" : "League activity in The Ocho",
      summary
    );
    if (tradeHappened) {
      // A trade reshapes the whole trade market: fire a fresh analysis now
      // instead of waiting for the morning run.
      try {
        const base = new URL(req.url).origin;
        await fetch(`${base}/.netlify/functions/analyze-background`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tasks: ["trades"] }),
        });
      } catch (e) { /* morning run will cover it */ }
    }
  }

  return new Response(JSON.stringify({
    ok: true, leagueId, teams: snapshot.teams.length,
    newTransactions: firstRun ? `first run, ${newTxns.length} baselined` : newTxns.length,
    dirty,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 */2 * * *" };
