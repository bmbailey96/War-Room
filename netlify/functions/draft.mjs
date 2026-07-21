// DRAFT WAR ROOM. Runs daily and on demand during the draft. Only does real
// work when the league is in pre_draft or drafting. This is a DYNASTY draft
// brain, not a value list: it builds the available candidate pool from market
// values (fast, no timeout), then reasons over it like a dynasty strategist,
// weighing value AND age curves AND positional scarcity in THIS league AND my
// contention window AND my roster construction AND what my rivals are stacking
// AND positional runs happening live. Same intelligence the trade tools use.

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
  const [playersDB, playerValues] = await Promise.all([
    getPlayersTrim(),
    store.get("player_values", { type: "json" }),
  ]);

  // ---- Live draft state: who is gone, what I have, what rivals are stacking ----
  let draftedIds = new Set();
  let myDraftedByPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  let myDraftedNames = [];
  let picksMade = 0, draftInfo = null;
  const rivalByPos = {};        // ownerSlot -> {QB,RB,WR,TE}
  const recentPicksPos = [];    // sequence of positions taken, most recent last
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

  // ---- Candidate pool: best available on market value (fast, no web search) ----
  const pv = (playerValues && playerValues.players) || {};
  const idByNorm = {};
  for (const [pid, info] of Object.entries(playersDB)) {
    if (info.n) idByNorm[norm(info.n)] = pid;
  }
  const pool = [];
  for (const [nm, info] of Object.entries(pv)) {
    const pid = idByNorm[nm];
    if (pid && draftedIds.has(pid)) continue;
    if (!["QB", "RB", "WR", "TE"].includes(info.pos)) continue;
    pool.push({
      name: (playersDB[pid] || {}).n || nm,
      pos: info.pos, age: info.age, team: info.team, value: info.v,
    });
  }
  pool.sort((a, b) => b.value - a.value);
  const candidates = pool.slice(0, 30);   // the pool the brain reasons over
  const fullBoard = pool.slice(0, 90);    // stored so the app can show a deep board

  // ---- Positional run detection (live): what is drying up right now ----
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

  // ---- Picks until my next turn (snake draft) so the brain can reason ahead ----
  // In a snake, my slot alternates: in odd rounds I pick at position `slot`,
  // in even rounds at position (teams - slot + 1). The gap between my picks
  // alternates between 2*(teams - slot) + 1 and 2*slot - 1.
  const teams = (snapshot.settings && snapshot.settings.num_teams) || snapshot.teams.length || 8;
  const mySlot = draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] : null;
  let untilNext = null;
  if (mySlot && picksMade >= 0) {
    const roundNow = Math.floor(picksMade / teams);          // 0-indexed round
    const posInRound = picksMade % teams;                    // 0-indexed slot on the clock now
    // My pick index within the current round (snake)
    const myPosThisRound = (roundNow % 2 === 0) ? (mySlot - 1) : (teams - mySlot);
    if (posInRound <= myPosThisRound) {
      untilNext = myPosThisRound - posInRound;               // picks until I'm up this round
    } else {
      // I already picked this round; next is in the following round (snake flips)
      const myPosNextRound = ((roundNow + 1) % 2 === 0) ? (mySlot - 1) : (teams - mySlot);
      untilNext = (teams - posInRound) + myPosNextRound;
    }
  }
  const aheadLine = (untilNext != null)
    ? `PICKS UNTIL MY NEXT TURN AFTER THIS ONE: about ${untilNext}. So roughly the next ${untilNext} best-available players will be gone before I pick again. Reason about which TIERS survive that gap: if a position has enough depth that a comparable player will still be there at my next pick, I can wait on it and take the scarcer position now. If a tier will empty before I pick again, that is the one to grab now even at slightly lower raw value.`
    : "";

  // ---- The dynasty brain ----
  const stateLine = leagueStateBlock(snapshot, playerValues);
  const filled = Object.entries(myDraftedByPos).filter(([, n]) => n > 0).map(([p, n]) => `${p} x${n}`).join(", ") || "nothing yet";

  const prompt = `You are my dynasty startup draft strategist. This is a DYNASTY league (I keep this roster for years), not a redraft, so age and long-term value matter as much as this-year production. Be as rigorous as a top dynasty analyst. Pick the single best player for ME to draft next and explain why in a few tight sentences.

${myRosterBlock(snapshot)}
${stateLine}

MY DRAFT SO FAR: ${filled}. Overall picks made: ${picksMade}.
${myDraftedNames.length ? `Players I have drafted: ${myDraftedNames.join(", ")}.` : ""}

BEST AVAILABLE RIGHT NOW (name, position, age, market value 0-100), already sorted by raw value with drafted players removed:
${candidates.map((p, i) => `${i + 1}. ${p.name} ${p.pos}${p.age ? " age " + p.age : " (incoming rookie, treat as young/high-upside)"} val ${p.value}`).join("\n")}

${runLine ? `LIVE POSITIONAL RUN: ${runLine} just went. That position is drying up, weigh grabbing the best one left before the tier falls off.` : ""}
${rivalLine ? `WHAT RIVALS HAVE STACKED: ${rivalLine}. Use this to read which positions will get scarce.` : ""}
${aheadLine}

Reason like a dynasty strategist, in this order:
1. Value is the floor, but do NOT just take the highest number. A younger player at equal value is worth more in dynasty; an older player must be clearly better to justify the pick.
2. Weigh positional scarcity in THIS league (from the league state above) and any live run: if a scarce tier is about to empty, that raises the pick.
3. THINK AHEAD to my next pick: with the gap above, decide which positional tiers will survive until I pick again and which will not. Take the position that will NOT survive now, and wait on the one that will. This is the core of the decision, do not skip it.
4. Weigh my roster construction: what I already have, what I still need for a startable, deep lineup, and my contention window.
5. If two players are close, pick the one who fits my window and my holes.

Output EXACTLY this, no preamble:
PICK: <one player name from the list>
WHY: <2-3 sentences: value, age, and fit, AND the look-ahead logic (what survives to my next pick vs what does not), concretely>
BACKUP: <one other name worth taking if my pick gets sniped, and one phrase why>
PRIORITIZE: <one position I should target over the next few picks and why, one sentence>`;

  let brain = "";
  try {
    brain = await callClaude(prompt, { maxTokens: 700, useSearch: false });
  } catch (e) { brain = ""; }

  // Parse the brain's pick so the app can headline it. Fall back to top-of-board.
  const pickMatch = brain.match(/PICK:\s*(.+)/i);
  const whyMatch = brain.match(/WHY:\s*([\s\S]*?)(?:\nBACKUP:|\nPRIORITIZE:|$)/i);
  const backupMatch = brain.match(/BACKUP:\s*(.+)/i);
  const prioritizeMatch = brain.match(/PRIORITIZE:\s*(.+)/i);

  const pickName = pickMatch ? pickMatch[1].trim() : (candidates[0] ? candidates[0].name : null);
  // find the picked player's card in the pool for the headline
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
    draftId: draftInfo ? draftInfo.draft_id : null,
    mySlot: draftInfo ? (draftInfo.draft_order || {})[MY_USER_ID] || null : null,
  });

  return new Response(JSON.stringify({ ok: true, status, picksMade, pick: pickCard ? pickCard.name : null }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "0 14 * * *" };
