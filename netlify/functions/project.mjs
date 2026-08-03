// WEEK PROJECTION. Runs Thu/Sat/Sun in season and on demand.
//
// Sleeper publishes a Rotowire projection for every player every week. That
// number knows nothing about who the defense is, whether the offense has
// changed shape in the last three games, or which way a snap share is moving.
// This takes it as the base and adjusts it with the evidence the app already
// computes. All of it is arithmetic, not a model, so the number cannot be
// hallucinated and every adjustment is shown with its reason.
//
// It also solves the optimal legal lineup from the full roster and reports any
// bench player who out-projects a current starter, which is the actual
// sit/start answer, and stores projected vs actual so the projection can be
// scored against reality later.

import {
  blobs, resolveLeague, projectPlayer, teamProjection, winProbability, scoreProjection,
  winProbOptimalLineup, vacancyMap, DEFAULT_WEIGHTS,
} from "./lib/ocho.mjs";

const j = async (url, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
};

// Fill fixed slots best-first, then flex from what's left.
function optimalLineup(rows, rosterPositions) {
  const pool = rows.filter(r => r.adjusted != null).sort((a, b) => b.adjusted - a.adjusted);
  const used = new Set();
  const take = test => {
    for (const r of pool) {
      if (used.has(r.key)) continue;
      if (test(r)) { used.add(r.key); return r; }
    }
    return null;
  };
  const FLEXABLE = ["RB", "WR", "TE"];
  const lineup = [];
  const flexSlots = [];
  for (const slot of rosterPositions) {
    if (slot === "BN" || slot === "IR") continue;
    if (slot === "FLEX" || slot === "SUPER_FLEX" || slot === "REC_FLEX") { flexSlots.push(slot); continue; }
    const pick = take(r => r.slot === slot);
    if (pick) lineup.push({ slot, player: pick });
  }
  for (const slot of flexSlots) {
    const pick = take(r => FLEXABLE.includes(r.slot));
    if (pick) lineup.push({ slot: "FLEX", player: pick });
  }
  return lineup;
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "no snapshot yet" }), { status: 409 });
  }
  const statsDigest = await store.get("stats_digest", { type: "json" });
  const gameContext = await store.get("game_context", { type: "json" });
  const calibration = await store.get("calibration", { type: "json" });
  const weights = { ...DEFAULT_WEIGHTS, ...((calibration && calibration.weights) || {}) };
  const vacancies = vacancyMap(snapshot, statsDigest);
  const leagueId = snapshot.leagueId || await resolveLeague();
  const week = snapshot.week || (snapshot.nflState || {}).week || 1;
  const season = snapshot.season;

  const me = snapshot.teams.find(t => t.isMe);
  if (!me) return new Response(JSON.stringify({ error: "my roster not found" }), { status: 500 });

  const matchups = await j(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
  if (!matchups) return new Response(JSON.stringify({ error: "no matchups" }), { status: 502 });

  const positions = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]
    .map(p => `position%5B%5D=${p}`).join("&");
  const projRows = await j(
    `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${positions}&order_by=ppr`
  ) || [];
  // Score every projection under THIS league's rules rather than trusting the
  // generic pts_ppr field. Verified to reproduce Sleeper's own matchup screen
  // to the cent, including IDP.
  const scoring = snapshot.scoringSettings;
  const byPid = {};
  for (const r of projRows) {
    const stats = r.stats || {};
    const league = scoring ? scoreProjection(stats, scoring) : null;
    const pts = league != null ? league : stats.pts_ppr;
    if (pts == null) continue;
    byPid[r.player_id] = { pts, sleeper: pts, opp: r.opponent, team: r.team };
  }

  const myRow = matchups.find(r => r.roster_id === me.rosterId);
  const oppMatchId = myRow && myRow.matchup_id;
  const oppRow = matchups.find(r => r.matchup_id === oppMatchId && r.roster_id !== me.rosterId);
  const opp = oppRow ? snapshot.teams.find(t => t.rosterId === oppRow.roster_id) : null;

  const projPlayer = (p, pr) => projectPlayer(p, {
    baseProj: pr.pts || 0, oppTeam: pr.opp || null, statsDigest, weights,
    gameContext: (gameContext && gameContext.teams && p.team) ? gameContext.teams[p.team] : null,
    vacancy: vacancies[p.pid] || null,
  });
  const rowsFor = (team, pids) => (pids || []).filter(x => x && x !== "0").map(pid => {
    const p = (team.players || []).find(x => x.pid === pid) || { name: pid, slot: "?" };
    return { key: pid, ...projPlayer(p, byPid[pid] || {}) };
  });

  const starters = rowsFor(me, myRow && myRow.starters);
  const theirStarters = opp && oppRow ? rowsFor(opp, oppRow.starters) : [];
  const mine = teamProjection(starters);
  const theirs = teamProjection(theirStarters);
  const winProb = theirStarters.length ? winProbability(mine, theirs) : null;

  // Every player I could legally start, then the best legal lineup from them.
  const allMine = (me.players || []).map(p => {
    const pr = byPid[p.pid] || {};
    return { key: p.pid, onIR: p.onIR, ...projPlayer(p, pr) };
  }).filter(r => !r.onIR);
  const lineupSlots = (snapshot.rosterPositions || []).filter(x => x !== "BN" && x !== "IR");
  const startingKeys = new Set((myRow && myRow.starters) || []);
  const best = optimalLineup(allMine, snapshot.rosterPositions || []);

  // Compare SLOT BY SLOT, not best-bench-against-worst-starter. The old
  // pairing produced "start Burden over Kraft, worth +7.0" when the real
  // change is Fannin into TE and Burden into the flex McConkey was holding,
  // for +4.3 total. It named a swap that could not actually be made and
  // overstated it by nearly three points.
  const currentBySlot = ((myRow && myRow.starters) || []).map((pid, i) => ({
    slot: lineupSlots[i] || "?",
    player: starters.find(r => r.key === pid) || null,
  }));
  const bestBySlot = [];
  const bestPool = [...best];
  for (const slot of lineupSlots) {
    const wanted = slot === "FLEX" ? "FLEX" : slot;
    const idx = bestPool.findIndex(b => b.slot === wanted);
    bestBySlot.push({ slot, player: idx >= 0 ? bestPool.splice(idx, 1)[0].player : null });
  }

  // What actually matters is WHICH PLAYERS start, not which slot they sit in.
  // Moving McConkey from FLEX to WR while London goes the other way scores
  // identically, so reporting it as a swap invented gains that do not exist:
  // three "swaps" summing to 7.5 against a real total of 5.0. Compare the sets.
  const bestKeys = new Set(bestBySlot.map(b => b.player && b.player.key).filter(Boolean));
  const comingIn = bestBySlot
    .filter(b => b.player && !startingKeys.has(b.player.key))
    .map(b => ({ slot: b.slot, player: b.player }))
    .sort((a, b) => b.player.adjusted - a.player.adjusted);
  const goingOut = starters
    .filter(r => r.adjusted != null && !bestKeys.has(r.key))
    .sort((a, b) => b.adjusted - a.adjusted);

  // Pair them purely for readability. The per-line number is the difference
  // between the two named players; the honest figure is the total below.
  const benchSwaps = comingIn.map((entry, i) => {
    const out = goingOut[i] || null;
    return {
      slot: entry.slot,
      in: entry.player,
      out,
      gain: out ? Math.round((entry.player.adjusted - out.adjusted) * 10) / 10 : null,
    };
  }).filter(x => x.out);

  const optimalTotal = teamProjection(bestBySlot.map(b => b.player).filter(Boolean));
  const totalGain = Math.round((optimalTotal.total - mine.total) * 10) / 10;

  // And the lineup that wins the week most often, which is not always the one
  // that scores the most.
  let winFirst = null;
  if (theirStarters.length) {
    const seeded = bestBySlot.filter(b => b.player);
    const res = winProbOptimalLineup(allMine, lineupSlots, seeded, theirs);
    const seededKeys = new Set(seeded.map(x => x.player && x.player.key).filter(Boolean));
    const changed = res.lineup
      .filter(x => x.player && !seededKeys.has(x.player.key))
      .map(x => ({ slot: x.slot, in: x.player }));
    winFirst = {
      total: res.total,
      winProb: res.winProb,
      differsFromPointsOptimal: changed.length > 0,
      changes: changed,
      stance: theirs.total > optimalTotal.total ? "underdog, variance helps" : "favoured, floor helps",
    };
  }

  // Points are not the objective, winning the week is. Report what the change
  // does to win probability so a 4-point gain in a game we already win by 20
  // reads as what it is.
  const optimalWinProb = theirStarters.length ? winProbability(optimalTotal, theirs) : null;

  // What they are capable of if they fix their own lineup, which is their
  // ceiling and the number worth planning against.
  let opponentOptimal = null;
  if (opp) {
    const allTheirs = (opp.players || []).filter(p => !p.onIR)
      .map(p => ({ key: p.pid, ...projPlayer(p, byPid[p.pid] || {}) }));
    const theirBest = optimalLineup(allTheirs, snapshot.rosterPositions || []);
    opponentOptimal = teamProjection(theirBest.map(b => b.player));
  }

  const dataNote = statsDigest
    ? (statsDigest.seasonIsCurrent
      ? `defense and form from ${statsDigest.season} live data`
      : `defense and form from ${statsDigest.season}, the last completed season, because no games have been played yet this year; snap-share adjustments are switched off until real games exist`)
    : "no stats digest available, base projections only";

  const projection = {
    at: Date.now(), week, season,
    opponentName: opp ? opp.name : null,
    opponentOwner: opp ? opp.ownerName : null,
    starters, theirStarters, mine, theirs, winProb,
    benchSwaps, dataNote,
    optimalTotal: optimalTotal.total, totalGain, optimalWinProb,
    winFirst, weights, calibrated: !!(calibration && calibration.weights),
    vacancyCount: Object.keys(vacancies).length,
    contextAt: gameContext ? gameContext.at : null,
    opponentOptimal: opponentOptimal ? opponentOptimal.total : null,
    bench: allMine.filter(r => !startingKeys.has(r.key)).sort((a, b) => (b.adjusted || 0) - (a.adjusted || 0)),
  };
  await store.setJSON("projection", projection);

  // Keep a history so projected can be scored against actual later.
  // Per-player log: base, adjusted, and each factor's contribution, so the
  // damping weights can be fitted against real results instead of guessed.
  const playerLog = (await store.get("projection_player_log", { type: "json" })) || [];
  const stamped = starters.filter(r => r.adjusted != null);
  const hist = (await store.get("projection_history", { type: "json" })) || [];
  const existing = hist.findIndex(h => h.week === week && h.season === season);
  const entry = {
    season, week, at: Date.now(),
    projected: mine.total, opponentProjected: theirs.total,
    opponent: projection.opponentName, winProb,
    actual: null, opponentActual: null,
  };
  if (existing >= 0) hist[existing] = { ...hist[existing], ...entry };
  else hist.push(entry);

  // Backfill actuals for any completed week we already logged.
  for (const h of hist) {
    if (h.actual != null || h.week >= week) continue;
    const past = await j(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${h.week}`);
    if (!past) continue;
    const minePast = past.find(r => r.roster_id === me.rosterId);
    if (!minePast || !minePast.points) continue;
    const oppPast = past.find(r => r.matchup_id === minePast.matchup_id && r.roster_id !== me.rosterId);
    h.actual = Math.round(minePast.points * 10) / 10;
    h.opponentActual = oppPast ? Math.round((oppPast.points || 0) * 10) / 10 : null;
    h.error = h.projected != null ? Math.round((h.actual - h.projected) * 10) / 10 : null;
  }
  await store.setJSON("projection_history", hist.slice(-40));

  const already = playerLog.some(e => e.season === season && e.week === week);
  if (!already) {
    playerLog.push({
      season, week, at: Date.now(),
      players: stamped.map(r => ({
        key: r.key, name: r.name, slot: r.slot, team: r.team,
        base: r.base, adjusted: r.adjusted, reasons: r.reasons, actual: null,
      })),
    });
  }
  await store.setJSON("projection_player_log", playerLog.slice(-20));

  return new Response(JSON.stringify({
    ok: true, week,
    projected: mine.total, opponent: projection.opponentName, opponentProjected: theirs.total,
    winProb, swaps: benchSwaps.length, totalGain, optimalTotal: optimalTotal.total,
    opponentOptimal: opponentOptimal ? opponentOptimal.total : null,
    unprojected: mine.excluded,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 13 * * 0,4,6" };
