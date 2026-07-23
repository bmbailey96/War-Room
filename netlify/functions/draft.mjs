// DRAFT WAR ROOM. Runs daily and on demand during the draft. Only does real
// work when the league is in pre_draft or drafting. Handles BOTH draft types:
//   STARTUP (empty rosters, whole player pool available) — the v22 brain.
//   ROOKIE (continuing league, rosters kept) — pool is ONLY unrostered
//   players, which in practice means incoming rookies plus true free agents.
// Rostered players are never candidates. This is what was wrong before:
// the board suggested Ja'Marr Chase in a rookie draft because it never
// checked who was already on a roster.

import {
  blobs, resolveLeague, getPlayersTrim, callClaude,
  myRosterBlock, leagueStateBlock, MY_USER_ID,
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
  const [playersDB, playerValues, rosters] = await Promise.all([
    getPlayersTrim(),
    store.get("player_values", { type: "json" }),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()).catch(() => []),
  ]);

  // ---- Rostered players are OFF the board. Track by pid and by name so a
  // values-list entry can't slip through when its pid lookup misses. ----
  const rosteredIds = new Set();
  const rosteredNames = new Set();
  for (const r of rosters || []) {
    for (const pid of r.players || []) {
      rosteredIds.add(pid);
      const n = (playersDB[pid] || {}).n;
      if (n) rosteredNames.add(norm(n));
    }
  }
  // Populated rosters + a draft = rookie draft. Empty rosters = startup.
  const isRookieDraft = rosteredIds.size > 0;

  // ---- Live draft state: who is gone, what I have, what rivals are stacking ----
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

  // ---- Candidate pool: AVAILABLE players only (not rostered, not drafted) ----
  const pv = (playerValues && playerValues.players) || {};
  const idByNorm = {};
  for (const [pid, info] of Object.entries(playersDB)) {
    if (info.n) idByNorm[norm(info.n)] = pid;
  }
  const pool = [];
  for (const [nm, info] of Object.entries(pv)) {
    const pid = idByNorm[nm];
    if (pid && (draftedIds.has(pid) || rosteredIds.has(pid))) continue;
    if (rosteredNames.has(nm)) continue; // name-level guard when pid lookup missed
    if (!["QB", "RB", "WR", "TE"].includes(info.pos)) continue;
    pool.push({
      name: (playersDB[pid] || {}).n || nm,
      pos: info.pos, age: info.age, team: info.team, value: info.v,
    });
  }
  pool.sort((a, b) => b.value - a.value);
  const candidates = pool.slice(0, 30);
  const fullBoard = pool.slice(0, 90);

  if (!pool.length) {
    await store.setJSON("draft_board", {
      at: Date.now(), status, draftStarted: picksMade > 0, picksMade,
      myDraftedByPos, pick: null, why: "", backup: "", prioritize: "",
      board: [], read: "", isRookieDraft,
      error: "No available players found in the values data. If this is a rookie draft, DynastyProcess may not have this year's class loaded yet; check back after the values function runs, or the class may still be thin this early.",
      draftId: draftInfo ? draftInfo.draft_id : null,
      mySlot: draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] || null : null,
    });
    return new Response(JSON.stringify({ ok: true, status, pool: 0, isRookieDraft }));
  }

  // ---- Positional run detection ----
  const last8 = recentPicksPos.slice(-8);
  const runCounts = last8.reduce((m, p) => (m[p] = (m[p] || 0) + 1, m), {});
  const runLine = Object.entries(runCounts)
    .filter(([, n]) => n >= 3)
    .map(([p, n]) => `${p} (${n} of the last ${last8.length} picks)`)
    .join(", ");

  // ---- Rival tendencies so far ----
  const rivalLine = Object.entries(rivalByPos)
    .map(([slot, c]) => `a rival has taken ${["QB","RB","WR","TE"].filter(p => c[p]).map(p => `${c[p]} ${p}`).join(", ")}`)
    .slice(0, 8).join("; ");

  // ---- Picks until my next turn (snake math, verified all 8 slots) ----
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
  const aheadLine = (untilNext != null)
    ? `PICKS UNTIL MY NEXT TURN AFTER THIS ONE: about ${untilNext}. So roughly the next ${untilNext} best-available players will be gone before I pick again. Reason about which TIERS survive that gap.`
    : "";

  // ---- The dynasty brain, framed for the right draft type ----
  const stateLine = leagueStateBlock(snapshot, playerValues);
  const filled = Object.entries(myDraftedByPos).filter(([, n]) => n > 0).map(([p, n]) => `${p} x${n}`).join(", ") || "nothing yet";

  const framing = isRookieDraft
    ? `This is a ROOKIE DRAFT in a continuing dynasty league. Every player on the available list below is either an incoming rookie or an unrostered free agent; everyone else in the NFL is already on a league roster and CANNOT be drafted. Rookie draft strategy: this is about long-term upside and my roster's future shape, not this week. Rookies with no listed age are the incoming class; treat them as young and high-upside. A veteran free agent on this list is only worth a pick if he clearly beats the best rookie available, which is rare outside the late rounds.`
    : `This is a DYNASTY STARTUP draft; the whole player pool is available and I keep this roster for years, so age and long-term value matter as much as this-year production.`;

  const prompt = `You are my dynasty draft strategist. ${framing} Be as rigorous as a top dynasty analyst. Pick the single best player for ME to draft next and explain why in a few tight sentences.

${myRosterBlock(snapshot)}
${stateLine}

MY DRAFT SO FAR: ${filled}. Overall picks made: ${picksMade}.
${myDraftedNames.length ? `Players I have drafted: ${myDraftedNames.join(", ")}.` : ""}

BEST AVAILABLE RIGHT NOW (name, position, age, market value 0-100), rostered and already-drafted players removed:
${candidates.map((p, i) => `${i + 1}. ${p.name} ${p.pos}${p.age ? " age " + p.age : " (incoming rookie, treat as young/high-upside)"} val ${p.value}`).join("\n")}

${runLine ? `LIVE POSITIONAL RUN: ${runLine} just went. That position is drying up.` : ""}
${rivalLine ? `WHAT RIVALS HAVE STACKED THIS DRAFT: ${rivalLine}.` : ""}
${aheadLine}

Reason like a dynasty strategist:
1. Value is the floor, but do NOT just take the highest number. Younger at equal value wins in dynasty.
2. Weigh positional scarcity in THIS league (league state above) and any live run.
3. ${untilNext != null ? "THINK AHEAD to my next pick: which tiers survive the gap and which do not. Take what will NOT survive." : "Weigh which positions will thin out fastest in this class."}
4. Weigh my roster construction: ${isRookieDraft ? "what my EXISTING roster needs long-term, since these picks join it" : "what I still need for a startable, deep lineup"}, and my contention window.
5. If two players are close, pick the one who fits my window and my holes.

Output EXACTLY this, no preamble:
PICK: <one player name from the list>
WHY: <2-3 sentences: value, age, fit, and the look-ahead logic, concretely>
BACKUP: <one other name worth taking if my pick gets sniped, and one phrase why>
PRIORITIZE: <one position I should target over the next few picks and why, one sentence>`;

  let brain = "";
  try {
    brain = await callClaude(prompt, { maxTokens: 700, useSearch: false });
  } catch (e) { brain = ""; }

  const pickMatch = brain.match(/PICK:\s*(.+)/i);
  const whyMatch = brain.match(/WHY:\s*([\s\S]*?)(?:\nBACKUP:|\nPRIORITIZE:|$)/i);
  const backupMatch = brain.match(/BACKUP:\s*(.+)/i);
  const prioritizeMatch = brain.match(/PRIORITIZE:\s*(.+)/i);

  const pickName = pickMatch ? pickMatch[1].trim() : (candidates[0] ? candidates[0].name : null);
  const pickCard = fullBoard.find(p => norm(p.name) === norm(pickName)) || candidates[0] || null;

  await store.setJSON("draft_board", {
    at: Date.now(), status,
    draftStarted: picksMade > 0,
    picksMade,
    myDraftedByPos,
    pick: pickCard,
    why: whyMatch ? whyMatch[1].trim() : "",
    backup: backupMatch ? backupMatch[1].trim() : "",
    prioritize: prioritizeMatch ? prioritizeMatch[1].trim() : "",
    board: fullBoard,
    read: brain,
    isRookieDraft,
    draftId: draftInfo ? draftInfo.draft_id : null,
    mySlot: draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] || null : null,
  });

  return new Response(JSON.stringify({
    ok: true, status, picksMade, isRookieDraft,
    poolSize: pool.length, pick: pickCard ? pickCard.name : null,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 14 * * *" };
