// DRAFT WAR ROOM. Runs daily, but only does real work when the league is
// in pre_draft or drafting status. Builds a rookie/startup big board tuned
// to MY roster needs, with live research on the class, and (during a live
// draft) a "best available for you right now" read.
//
// Sleeper exposes the draft and its picks once it exists, so mid-draft this
// can see who's already gone and recompute best-available in real time.

import {
  blobs, resolveLeague, getPlayersTrim, callClaude,
  leagueContextBlock, myRosterBlock,
} from "./lib/ocho.mjs";

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ ok: false, reason: "no snapshot" }));

  const status = snapshot.leagueStatus;
  if (status !== "pre_draft" && status !== "drafting") {
    // Clear any stale board so the UI hides the tab when not drafting
    return new Response(JSON.stringify({ ok: true, skipped: `league status is ${status}, draft mode idle` }));
  }

  const leagueId = await resolveLeague();
  const playersDB = await getPlayersTrim();

  // Pull the draft + picks already made, if a draft exists
  let alreadyDrafted = [];
  let draftInfo = null;
  try {
    const drafts = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json());
    if (drafts && drafts.length) {
      draftInfo = drafts[0];
      const picks = await fetch(`https://api.sleeper.app/v1/draft/${draftInfo.draft_id}/picks`).then(r => r.json());
      alreadyDrafted = (picks || []).map(p => {
        const info = playersDB[p.player_id] || {};
        return `${info.n || p.player_id} (${info.p || "?"}) - pick ${p.pick_no}`;
      });
    }
  } catch (e) { /* draft not created yet */ }

  const me = snapshot.teams.find(t => t.isMe) || {};
  const draftedNote = alreadyDrafted.length
    ? `\n\nALREADY DRAFTED (do NOT recommend these, they are gone):\n${alreadyDrafted.join("\n")}`
    : "\n\nThe draft has not started yet; this is pre-draft prep.";

  const prompt = `You are my dynasty draft war room. Use web search heavily for the current incoming rookie class: consensus rankings, landing spots, depth charts, camp buzz, and dynasty rookie ADP. ${status === "drafting" ? "A draft is LIVE right now." : "The rookie draft is coming up soon."}

${leagueContextBlock(snapshot)}

MY ROSTER (The Nightmen):
${myRosterBlock(snapshot)}

MY FLAGGED HOLES: ${(me.holes || []).join("; ") || "none"}
MY SURPLUS: ${(me.surplus || []).join("; ") || "none"}
MY FUTURE PICKS: ${(me.picks || []).map(p => `${p.season} R${p.round}`).join(", ")}
${draftedNote}

Build my draft board:
1. TOP TARGETS FOR ME: rank the 8-12 incoming rookies/players I should most want, tuned to MY roster needs (weight my holes heavily, but take elite talent that falls regardless). For each: position, landing spot, why they fit MY team specifically, and rough dynasty ADP so I know when to expect them.
2. AVOID FOR ME: 2-3 hyped players who don't fit my roster or whose situation is a trap.
3. PICK STRATEGY: given my picks and needs, should I trade up, down, or stand pat? Package suggestions if a move makes sense.
${status === "drafting" ? "4. BEST AVAILABLE RIGHT NOW: given who's already gone above, the single best pick for me if I'm on the clock." : ""}

Confidence (High/Medium/Low) on each target, and a one-line "Case against" on your top target.

MANDATORY FINAL SECTION: end with "## THE MOVE" and one directive for my draft approach.`;

  try {
    const text = await callClaude(prompt, { maxTokens: 3800 });
    await store.setJSON("draft_board", {
      at: Date.now(), status, text,
      draftStarted: alreadyDrafted.length > 0,
      picksMade: alreadyDrafted.length,
    });
  } catch (err) {
    await store.setJSON("draft_board", { at: Date.now(), status, error: err.message });
  }

  return new Response(JSON.stringify({ ok: true, status, picksMade: alreadyDrafted.length }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "0 14 * * *" };
