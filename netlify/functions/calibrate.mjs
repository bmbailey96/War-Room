// CALIBRATION. Runs Tuesday mornings, after the week is final.
//
// The damping weights in DEFAULT_WEIGHTS are guesses. They exist because the
// base projection already accounts for the opponent, so applying a full
// matchup adjustment on top double counts, and 0.5 was a hedge, not a
// measurement.
//
// This fits them. It pulls the actual points every logged player scored,
// compares three candidates for each week (the raw Sleeper base, the adjusted
// number, and the adjusted number at various damping levels), and grid
// searches for the global damping multiplier that minimises mean absolute
// error. If the raw base beats every adjusted version, it says so and sets the
// weights to zero rather than defending the machinery.
//
// Nothing here fires until there are at least three completed weeks, because
// fitting six parameters to one week of noise is worse than not fitting.

import { blobs, resolveLeague, DEFAULT_WEIGHTS, scoreProjection } from "./lib/ocho.mjs";

const MIN_WEEKS = 3;

const j = async (url) => {
  try {
    const r = await fetch(url);
    return r.ok ? r.json() : null;
  } catch (e) { return null; }
};

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  const playerLog = (await store.get("projection_player_log", { type: "json" })) || [];
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "no snapshot" }), { status: 409 });
  }
  const leagueId = snapshot.leagueId || await resolveLeague();
  const season = snapshot.season;
  const currentWeek = snapshot.week || 1;

  // Backfill actual points for any logged week that has finished.
  let filled = 0;
  for (const entry of playerLog) {
    if (entry.week >= currentWeek) continue;
    if (entry.players.every(p => p.actual != null)) continue;
    const stats = await j(
      `https://api.sleeper.app/stats/nfl/${entry.season}/${entry.week}?season_type=regular&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE&position%5B%5D=K&position%5B%5D=DEF&position%5B%5D=DL&order_by=ppr`
    );
    if (!stats) continue;
    const byPid = {};
    for (const row of stats) byPid[row.player_id] = row.stats || {};
    for (const p of entry.players) {
      const raw = byPid[p.key];
      if (!raw) continue;
      const scored = snapshot.scoringSettings ? scoreProjection(raw, snapshot.scoringSettings) : raw.pts_ppr;
      if (scored != null) { p.actual = scored; filled++; }
    }
  }
  await store.setJSON("projection_player_log", playerLog);

  const usable = playerLog.filter(e =>
    e.week < currentWeek && e.players.some(p => p.actual != null)
  );
  if (usable.length < MIN_WEEKS) {
    return new Response(JSON.stringify({
      ok: true, fitted: false, filled,
      weeksAvailable: usable.length, weeksNeeded: MIN_WEEKS,
      note: "not enough completed weeks to fit against; still using the default damping",
    }), { headers: { "content-type": "application/json" } });
  }

  // Each logged player carries base, adjusted and actual. The adjusted number
  // is base * M where M is the combined multiplier, so scaling the whole
  // adjustment by k gives base * (1 + k * (M - 1)). Grid search k.
  const samples = [];
  for (const e of usable) {
    for (const p of e.players) {
      if (p.actual == null || !p.base) continue;
      samples.push({ base: p.base, m: p.adjusted / p.base, actual: p.actual });
    }
  }
  if (samples.length < 40) {
    return new Response(JSON.stringify({
      ok: true, fitted: false, samples: samples.length,
      note: "too few player-weeks to fit against yet",
    }), { headers: { "content-type": "application/json" } });
  }

  const mae = k => samples.reduce((acc, s) =>
    acc + Math.abs(s.base * (1 + k * (s.m - 1)) - s.actual), 0) / samples.length;

  let bestK = 0, bestErr = Infinity;
  for (let k = 0; k <= 2.001; k += 0.05) {
    const err = mae(k);
    if (err < bestErr) { bestErr = err; bestK = Math.round(k * 100) / 100; }
  }
  const baseErr = mae(0);        // Sleeper's raw number, no adjustment at all
  const currentErr = mae(1);     // the adjustments exactly as currently shipped

  // Scale every factor by the fitted multiplier, keeping their relative sizes.
  const weights = {};
  for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) {
    if (typeof value === "number") weights[key] = Math.round(value * bestK * 100) / 100;
  }
  weights.calibrated = true;

  const verdict = bestK < 0.15
    ? "the adjustments are not beating Sleeper's raw projection; damping them to near zero"
    : bestK < 0.9
      ? "the adjustments help but were overshooting; damping them down"
      : bestK > 1.1
        ? "the adjustments were too timid; pushing them harder"
        : "the current damping is about right";

  await store.setJSON("calibration", {
    at: Date.now(), season,
    weeksUsed: usable.map(e => e.week),
    samples: samples.length,
    scale: bestK, weights,
    maeAdjusted: Math.round(bestErr * 100) / 100,
    maeSleeperRaw: Math.round(baseErr * 100) / 100,
    maeAsShipped: Math.round(currentErr * 100) / 100,
    verdict,
  });

  return new Response(JSON.stringify({
    ok: true, fitted: true, filled, samples: samples.length,
    scale: bestK, weights, verdict,
    maeAdjusted: Math.round(bestErr * 100) / 100,
    maeSleeperRaw: Math.round(baseErr * 100) / 100,
    improvementOverSleeper: Math.round((baseErr - bestErr) * 100) / 100,
  }, null, 2), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 14 * * 2" };
