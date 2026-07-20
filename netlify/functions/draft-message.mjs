// MESSAGE DRAFTER. On demand: takes a recommendation (usually a trade) and
// writes the actual message Brandon would paste into the Sleeper league chat
// to propose it. Natural, human, no corporate tone, no em dashes. This turns
// advice into a one-tap action.

import { blobs, callClaude } from "./lib/ocho.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let recommendation = "";
  try {
    const body = await req.json();
    recommendation = body.recommendation || "";
  } catch (e) { /* empty */ }

  const store = blobs();
  // If no explicit recommendation passed, pull the freshest trade analysis
  if (!recommendation) {
    const trades = await store.get("analysis_trades", { type: "json" });
    if (trades && trades.text) recommendation = trades.text.slice(0, 2500);
  }
  // Strip the machine-readable JSON block; the drafter only needs the prose
  recommendation = recommendation.replace(/<TRADES_JSON>[\s\S]*?<\/TRADES_JSON>/i, "").trim();
  if (!recommendation) {
    return new Response(JSON.stringify({ error: "no recommendation available to draft from" }), { status: 409 });
  }

  const prompt = `Write the actual message I would paste into my fantasy league's group chat to propose the trade described below. Rules:
- Sound like a real person texting a league mate, not a formal proposal. Casual, direct, a little personality.
- Do NOT use em dashes.
- No corporate or salesy tone. Don't oversell it. Lead with the offer, give a quick honest reason it makes sense for them, leave room to counter.
- Keep it short, 2 to 4 sentences.
- If the trade involves a specific person, address them naturally.
- Do not invent details not in the recommendation.

If the recommendation is a trade, write the proposal message. If it is a pickup or lineup call (not a trade with another manager), instead write nothing and return the single word: NOMESSAGE.

RECOMMENDATION:
${recommendation}

Return ONLY the message text (or NOMESSAGE), nothing else.`;

  try {
    const text = await callClaude(prompt, { maxTokens: 500, useSearch: false });
    const clean = text.trim();
    return new Response(JSON.stringify({
      ok: true,
      message: clean === "NOMESSAGE" ? null : clean,
    }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
};
