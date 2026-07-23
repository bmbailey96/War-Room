// THE GRADER. Runs weekly (Tuesdays). Closes the loop: it finds the
// players the AI has recommended in past analyses, pulls their actual
// fantasy scoring since the recommendation, and grades whether each call
// worked. Builds a running track record + hit rate that gets fed back
// into future analysis prompts so the model can see when it's been right
// or wrong and calibrate.
//
// How it identifies recommendations: when an analysis is stored, the
// analyzer also stores a lightweight "picks" list (player names it named
// in a GRAB/target/start context). The grader reads those, matches to
// Sleeper player ids, and scores rest-of-period points.

import { blobs, resolveLeague, getPlayersTrim, normName, pickValueOf } from "./lib/ocho.mjs";

async function scoringSince(leagueId, sinceWeek, playerIds) {
  // Sum each player's points across weeks sinceWeek..18 from Sleeper matchups
  const totals = {};
  for (const pid of playerIds) totals[pid] = { pts: 0, weeks: 0 };
  for (let w = sinceWeek; w <= 18; w++) {
    let data;
    try {
      data = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${w}`).then(r => r.json());
    } catch (e) { continue; }
    if (!data || !data.length) continue;
    for (const entry of data) {
      const pp = entry.players_points || {};
      for (const pid of playerIds) {
        if (pp[pid] != null) { totals[pid].pts += pp[pid]; totals[pid].weeks++; }
      }
    }
  }
  return totals;
}

function nameToId(playersDB, name) {
  const target = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  for (const [pid, p] of Object.entries(playersDB)) {
    if ((p.n || "").toLowerCase().replace(/[^a-z ]/g, "").trim() === target) return pid;
  }
  return null;
}
// Re-price every trade older than 6 weeks using today's market values.
// Runs year-round, including the offseason, because dynasty value moves
// hardest between February and August.
async function gradeTrades(store) {
  const ledger = (await store.get("trade_ledger", { type: "json" })) || [];
  const playerValues = await store.get("player_values", { type: "json" });
  if (!ledger.length || !playerValues || !playerValues.players) return { added: 0, total: 0 };

  const grades = (await store.get("trade_grades", { type: "json" })) || { trades: [] };
  const done = new Set(grades.trades.map(g => g.id));
  const MATURE_MS = 1000 * 60 * 60 * 24 * 42;
  let added = 0;

  for (const e of ledger) {
    if (done.has(e.id)) continue;
    const elapsed = Date.now() - e.at;
    if (elapsed < MATURE_MS) continue;
    const sides = e.sides.map(s => {
      const then =
        s.got.reduce((a, g) => a + (g.value || 0), 0) +
        s.picks.reduce((a, p) => a + (p.value || 0), 0);
      const now =
        s.got.reduce((a, g) => a + ((playerValues.players[normName(g.name)] || {}).v || 0), 0) +
        s.picks.reduce((a, p) => a + (pickValueOf(playerValues, p.season, p.round, null) || 0), 0);
      return { team: s.team, isMe: s.isMe, then, now, delta: now - then };
    });
    grades.trades.push({
      id: e.id, at: e.at, gradedAt: Date.now(),
      daysElapsed: Math.round(elapsed / 86400000),
      sides,
    });
    added++;
  }
  while (grades.trades.length > 40) grades.trades.shift();
  if (added) await store.setJSON("trade_grades", grades);
  return { added, total: grades.trades.length };
}
export default async () => {
  const store = blobs();
  const nflState = await fetch("https://api.sleeper.app/v1/state/nfl").then(r => r.json()).catch(() => ({}));
  const curWeek = nflState.week || 0;
  const inSeason = nflState.season_type === "regular" && curWeek >= 2;

  // Trade grading runs year-round; player-scoring grading needs games.
  const tradeResult = await gradeTrades(store);

  if (!inSeason) {
    return new Response(JSON.stringify({
      ok: true, tradesGraded: tradeResult.added, tradeTotal: tradeResult.total,
      skipped: "offseason or week 1, no player scoring to grade yet",
    }), { headers: { "content-type": "application/json" } });
  }

  const leagueId = await resolveLeague();
  const playersDB = await getPlayersTrim();
  const pending = (await store.get("grading_pending", { type: "json" })) || [];
  const record = (await store.get("grading_record", { type: "json" })) || { calls: [], hits: 0, total: 0 };

  // Grade any pending calls that are now at least 2 weeks old
  const stillPending = [];
  const idsToScore = [];
  for (const call of pending) {
    if (curWeek - call.week >= 2) idsToScore.push(...call.playerIds);
    else stillPending.push(call);
  }
  const uniqueIds = [...new Set(idsToScore)];
  const scores = uniqueIds.length ? await scoringSince(leagueId, Math.min(...pending.map(c => c.week + 1)), uniqueIds) : {};

  for (const call of pending) {
    if (curWeek - call.week < 2) continue;
    for (const pid of call.playerIds) {
      const s = scores[pid];
      if (!s || !s.weeks) continue;
      const ppg = s.pts / s.weeks;
      const pos = (playersDB[pid] || {}).p;
      const threshold = { QB: 16, RB: 10, WR: 10, TE: 7, K: 7, DEF: 6 }[pos] || 8;
      const hit = ppg >= threshold;
      const cat = call.action || call.task || "other";
      record.calls.push({
        at: call.at, week: call.week, task: call.task,
        player: (playersDB[pid] || {}).n || pid, action: call.action, cat,
        ppgSince: Math.round(ppg * 10) / 10, threshold, hit,
      });
      record.total++;
      if (hit) record.hits++;
      // per-category tallies
      record.byCat = record.byCat || {};
      record.byCat[cat] = record.byCat[cat] || { hits: 0, total: 0 };
      record.byCat[cat].total++;
      if (hit) record.byCat[cat].hits++;
    }
  }
  while (record.calls.length > 120) record.calls.shift();

  await store.setJSON("grading_pending", stillPending);
  await store.setJSON("grading_record", record);

  const hitRate = record.total ? Math.round(record.hits / record.total * 100) : null;
  return new Response(JSON.stringify({
    ok: true, graded: record.total, hitRate: hitRate != null ? hitRate + "%" : "n/a",
    stillPending: stillPending.length,
    tradesGraded: tradeResult.added, tradeTotal: tradeResult.total,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 15 * * 2" };
