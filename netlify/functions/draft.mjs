// DRAFT WAR ROOM, board builder. Runs daily and on demand during the draft.
// Builds the available-player board fast with no AI so the live draft watcher
// stays responsive, then fires draft-brain-background for the reasoning pass
// (which uses web search and takes too long for a sync function).

import { blobs, resolveLeague, getPlayersTrim, MY_USER_ID, normName } from "./lib/ocho.mjs";

const norm = normName;

export default async (req) => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ ok: false, reason: "no snapshot" }));

  const status = snapshot.leagueStatus;
  if (status !== "pre_draft" && status !== "drafting") {
    return new Response(JSON.stringify({ ok: true, skipped: `league status is ${status}, draft mode idle` }));
  }

  const leagueId = await resolveLeague();
  const [playersDB, playerValues, rosters] = await Promise.all([
    getPlayersTrim(),
    store.get("player_values", { type: "json" }),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()).catch(() => []),
  ]);

  // Rostered players are OFF the board.
  const rosteredIds = new Set();
  const rosteredNames = new Set();
  for (const r of rosters || []) {
    for (const pid of r.players || []) {
      rosteredIds.add(pid);
      const n = (playersDB[pid] || {}).n;
      if (n) rosteredNames.add(norm(n));
    }
  }
  const isRookieDraft = rosteredIds.size > 0;

  // Live draft state.
  let draftedIds = new Set();
  let myDraftedByPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  let myDraftedNames = [];
  let picksMade = 0, draftInfo = null;
  const rivalByPos = {};
  const recentPicksPos = [];
  try {
    const drafts = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json());
    if (drafts && drafts.length) {
      draftInfo = drafts[0];
      const picks = await fetch(`https://api.sleeper.app/v1/draft/${draftInfo.draft_id}/picks`).then(r => r.json());
      picksMade = (picks || []).length;
      for (const p of picks || []) {
        draftedIds.add(p.player_id);
        const pos = (playersDB[p.player_id] || {}).p;
        if (pos) recentPicksPos.push(pos);
        if (p.picked_by === MY_USER_ID) {
          if (myDraftedByPos[pos] != null) myDraftedByPos[pos]++;
          const nm = (playersDB[p.player_id] || {}).n;
          if (nm) myDraftedNames.push(`${nm} (${pos})`);
        } else {
          const slot = p.picked_by || p.roster_id || "?";
          rivalByPos[slot] = rivalByPos[slot] || { QB: 0, RB: 0, WR: 0, TE: 0 };
          if (rivalByPos[slot][pos] != null) rivalByPos[slot][pos]++;
        }
      }
    }
  } catch (e) { /* draft not created yet */ }

  // Candidate pool: available players only.
  const pv = (playerValues && playerValues.players) || {};
  const idByNorm = {};
  for (const [pid, info] of Object.entries(playersDB)) {
    if (info.n) idByNorm[norm(info.n)] = pid;
  }
  const pool = [];
  for (const [nm, info] of Object.entries(pv)) {
    const pid = idByNorm[nm];
    if (pid && (draftedIds.has(pid) || rosteredIds.has(pid))) continue;
    if (rosteredNames.has(nm)) continue;
    if (!["QB", "RB", "WR", "TE"].includes(info.pos)) continue;
    pool.push({
      name: (playersDB[pid] || {}).n || nm,
      pos: info.pos, age: info.age, team: info.team, value: info.v,
    });
  }
  pool.sort((a, b) => b.value - a.value);
  const fullBoard = pool.slice(0, 90);

  if (!pool.length) {
    await store.setJSON("draft_board", {
      at: Date.now(), status, draftStarted: picksMade > 0, picksMade,
      myDraftedByPos, pick: null, why: "", backup: "", prioritize: "",
      board: [], read: "", isRookieDraft, reasoning: { status: "none" },
      error: "No available players found in the values data. If this is a rookie draft, DynastyProcess may not have this year's class loaded yet.",
      draftId: draftInfo ? draftInfo.draft_id : null,
      mySlot: draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] || null : null,
    });
    return new Response(JSON.stringify({ ok: true, status, pool: 0, isRookieDraft }));
  }

  // Positional run detection.
  const last8 = recentPicksPos.slice(-8);
  const runCounts = last8.reduce((m, p) => (m[p] = (m[p] || 0) + 1, m), {});
  const runLine = Object.entries(runCounts)
    .filter(([, n]) => n >= 3)
    .map(([p, n]) => `${p} (${n} of the last ${last8.length} picks)`)
    .join(", ");

  const rivalLine = Object.entries(rivalByPos)
    .map(([, c]) => `a rival has taken ${["QB","RB","WR","TE"].filter(p => c[p]).map(p => `${c[p]} ${p}`).join(", ")}`)
    .slice(0, 8).join("; ");

  // Snake math: picks until my next turn.
  const teams = (snapshot.settings && snapshot.settings.num_teams) || snapshot.teams.length || 8;
  const mySlot = draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] : null;
  let untilNext = null;
  if (mySlot && picksMade >= 0) {
    const roundNow = Math.floor(picksMade / teams);
    const posInRound = picksMade % teams;
    const myPosThisRound = (roundNow % 2 === 0) ? (mySlot - 1) : (teams - mySlot);
    if (posInRound <= myPosThisRound) {
      untilNext = myPosThisRound - posInRound;
    } else {
      const myPosNextRound = ((roundNow + 1) % 2 === 0) ? (mySlot - 1) : (teams - mySlot);
      untilNext = (teams - posInRound) + myPosNextRound;
    }
  }

  // Carry the previous AI ranking forward, minus anyone who has since been
  // drafted or rostered, so the board does not blank out for the minute the
  // reasoning pass takes to rerun.
  const prior = await store.get("draft_board", { type: "json" });
  const availableNames = new Set(fullBoard.map(x => norm(x.name)));
  const keptAi = (prior && Array.isArray(prior.aiBoard))
    ? prior.aiBoard.filter(x => availableNames.has(norm(x.name)))
    : [];

  const keepPick = keptAi[0] || (prior && prior.pick && fullBoard.find(x => norm(x.name) === norm(prior.pick.name)));

  await store.setJSON("draft_board", {
    at: Date.now(), status,
    draftStarted: picksMade > 0,
    picksMade,
    myDraftedByPos,
    myDraftedNames,
    pick: keepPick || fullBoard[0],
    why: keepPick && prior ? (prior.why || "") : "",
    backup: keepPick && prior ? (prior.backup || "") : "",
    prioritize: keepPick && prior ? (prior.prioritize || "") : "",
    board: fullBoard,
    aiBoard: keptAi,
    read: "",
    isRookieDraft,
    ctx: { runLine, rivalLine, untilNext, teams },
    reasoning: { status: "running", startedAt: Date.now() },
    draftId: draftInfo ? draftInfo.draft_id : null,
    mySlot: mySlot || null,
  });

  // Fire the reasoning pass. It writes back into the same blob when done.
  try {
    const base = new URL(req.url).origin;
    await fetch(`${base}/.netlify/functions/draft-brain-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch (e) { /* board still works without reasoning */ }

  return new Response(JSON.stringify({
    ok: true, status, picksMade, isRookieDraft,
    poolSize: pool.length, pick: fullBoard[0] ? fullBoard[0].name : null,
    reasoning: "queued",
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 14 * * *" };