// SEASON GAME PLAN. Runs weekly (and on demand). Unlike every other
// analysis that optimizes a single decision, this thinks in MOVES AHEAD:
// the 3-move sequence from where I am now to a championship, given my core,
// my pick capital, the league's shape, and my contention window. It names
// what to sell while its value is high, what to target, and when.

import {
  blobs, leagueContextBlock, myRosterBlock, callClaude, trendBlock, valuesBlock,
} from "./lib/ocho.mjs";

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ error: "no snapshot" }), { status: 409 });

  const [newsDigest, trends, playerValues, grading] = await Promise.all([
    store.get("news_digest", { type: "json" }),
    store.get("trends", { type: "json" }),
    store.get("player_values", { type: "json" }),
    store.get("grading_record", { type: "json" }),
  ]);

  const me = snapshot.teams.find(t => t.isMe) || {};
  const valueLine = valuesBlock(snapshot, playerValues);
  const trendLine = trendBlock(trends);
  const status = snapshot.leagueStatus;

  const prompt = `You are my dynasty fantasy football GM thinking about the WHOLE arc, not this week. Build my season-long game plan: the sequence of moves that takes me from where I am now to a championship. Use web search for current player values and outlook where it matters.

${leagueContextBlock(snapshot)}

MY ROSTER (The Nightmen):
${myRosterBlock(snapshot)}

MY STANCE: ${me.stance ? me.stance.label || me.stance : "unknown"}. MY HOLES: ${(me.holes||[]).join(", ")||"none flagged"}. MY SURPLUS: ${(me.surplus||[]).join(", ")||"none flagged"}. MY PICKS: ${(me.picks||[]).map(p=>`${p.season} R${p.round}`).join(", ")}.
${valueLine}${trendLine}

First, in one line: am I a contender (push now), a fringe team (one or two moves from contention), or a rebuild (sell and stockpile)? Be honest based on my roster and the league.

Then give me my game plan as an ORDERED sequence of 3 to 4 moves, each building on the last:
- MOVE 1 (now): the specific action, who it involves, why now (a value peak, a window, an owner's mood)
- MOVE 2 (next): what it sets up and roughly when (before the draft, at the deadline, next offseason)
- MOVE 3+ (later): the payoff move that these enable
For each move, name real players and picks, not vague categories. Tie it to which owners are realistic partners given their tendencies. Call out the ONE asset I should build around and the ONE I should sell while it is high.

${status === "pre_draft" || status === "drafting" ? "The rookie draft is upcoming or live: fold draft strategy into the plan (which picks to keep, package, or cash in)." : ""}

MANDATORY FINAL SECTION: end with "## THE MOVE" naming the single first action that starts this whole plan in motion.`;

  try {
    const text = await callClaude(prompt, { maxTokens: 3200 });
    await store.setJSON("game_plan", { at: Date.now(), text });
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
};

export const config = { schedule: "0 16 * * 1" };
