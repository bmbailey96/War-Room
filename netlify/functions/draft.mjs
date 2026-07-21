// DRAFT WAR ROOM. Runs daily, and on demand during the draft. Only does real
// work when the league is in pre_draft or drafting. Builds a startup/rookie
// WATCH BOARD tuned to my roster needs from the market-value data (no web
// search, so it never times out), reads who has already been drafted and
// removes them live, and stores a structured list the app renders as a
// queue-ready board plus a short strategic read.

import {
  blobs, resolveLeague, getPlayersTrim, callClaude,
  myRosterBlock, MY_USER_ID, STARTER_NEEDS,
} from "./lib/ocho.mjs";

const norm = s => (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ ok: false, reason: "no snapshot" }));

  const status = snapshot.leagueStatus;
  if (status !== "pre_draft" && status !== "drafting") {
    return new Response(JSON.stringify({ ok: true, skipped: `league status is ${status}, draft mode idle` }));
  }

  const leagueId = await resolveLeague();
  const [playersDB, playerValues] = await Promise.all([
    getPlayersTrim(),
    store.get("player_values", { type: "json" }),
  ]);

  // Who is already drafted, and what have I drafted so far (for need weighting)?
  let draftedIds = new Set();
  let myDraftedByPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  let picksMade = 0, myRosterId = null, onTheClock = null, draftInfo = null;
  try {
    const drafts = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json());
    if (drafts && drafts.length) {
      draftInfo = drafts[0];
      // find my draft slot from draft_order (user_id -> slot)
      const order = draftInfo.draft_order || {};
      const mySlot = order[MY_USER_ID];
      const picks = await fetch(`https://api.sleeper.app/v1/draft/${draftInfo.draft_id}/picks`).then(r => r.json());
      picksMade = (picks || []).length;
      for (const p of picks || []) {
        draftedIds.add(p.player_id);
        if (p.picked_by === MY_USER_ID) {
          const pos = (playersDB[p.player_id] || {}).p;
          if (myDraftedByPos[pos] != null) myDraftedByPos[pos]++;
        }
      }
    }
  } catch (e) { /* draft not created yet */ }

  // Build the available board from market values, best first, drop drafted.
  const pv = (playerValues && playerValues.players) || {};
  // map value keys (normalized names) back to Sleeper ids for drafted-removal
  const idByNorm = {};
  for (const [pid, info] of Object.entries(playersDB)) {
    if (info.n) idByNorm[norm(info.n)] = pid;
  }

  // Roster-need weighting: startup lineup wants QB1, ~2 RB, ~2-3 WR, 1 TE plus
  // flex/bench. Under-filled positions get a small bump so the board leans
  // toward what I still need without ignoring elite talent.
  const targetByPos = { QB: 2, RB: 6, WR: 7, TE: 3 };
  const needBump = (pos) => {
    const have = myDraftedByPos[pos] || 0;
    const target = targetByPos[pos] || 3;
    if (have >= target) return 0.85;      // already stocked, slight fade
    if (have === 0) return 1.12;          // nothing here yet, nudge up
    return 1.0;
  };

  const board = [];
  for (const [nm, info] of Object.entries(pv)) {
    const pid = idByNorm[nm];
    if (pid && draftedIds.has(pid)) continue;      // gone
    if (!["QB","RB","WR","TE"].includes(info.pos)) continue; // skip K/DEF/IDP noise on a startup board
    const adjusted = info.v * needBump(info.pos);
    board.push({
      name: (playersDB[pid] || {}).n || nm,
      pos: info.pos, team: info.team, age: info.age,
      value: info.v,
      fitScore: Math.round(adjusted),
    });
  }
  board.sort((a, b) => b.fitScore - a.fitScore);
  const top = board.slice(0, 40);

  // A short strategic read from the model. NO web search (keeps it fast and
  // inside the function timeout). It reasons from the board + my roster.
  const filled = Object.entries(myDraftedByPos).filter(([, n]) => n > 0).map(([p, n]) => `${p} x${n}`).join(", ") || "nothing yet";
  const prompt = `You are my dynasty startup draft assistant. Below is the best-available board right now, already sorted by value and lightly weighted to my roster needs, with players already drafted removed. Give me a SHORT strategic read for who to QUEUE next, in 4-6 sentences max. No fluff.

MY ROSTER SO FAR: ${filled}. Picks made in the draft overall: ${picksMade}.

BEST AVAILABLE (name, pos, age, value 0-100, fit):
${top.slice(0, 20).map((p, i) => `${i + 1}. ${p.name} ${p.pos}${p.age ? " " + p.age : ""} val ${p.value} fit ${p.fitScore}`).join("\n")}

Tell me: (1) the 2-3 names to queue right now and why, weighing value against what my roster still needs; (2) one position I should prioritize soon before it dries up; (3) one name likely to fall that is worth waiting on. Be specific and brief.`;

  let read = "";
  try {
    read = await callClaude(prompt, { maxTokens: 900, useSearch: false });
  } catch (e) { read = ""; }

  await store.setJSON("draft_board", {
    at: Date.now(), status,
    draftStarted: picksMade > 0,
    picksMade,
    myDraftedByPos,
    board: top,
    read,
  });

  return new Response(JSON.stringify({ ok: true, status, picksMade, boardSize: top.length }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "0 14 * * *" };
