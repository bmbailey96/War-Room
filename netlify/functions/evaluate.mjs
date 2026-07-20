// TRADE EVALUATOR. On demand. Brandon describes a trade someone offered him
// (or one he's considering), and this grades it: accept / decline / counter,
// with a specific counter if warranted. This is the missing half of the
// trade game: the app could propose trades but not judge incoming ones.
//
// Output includes the same <TRADES_JSON> structured block the trades tab
// uses, so the app renders it as the same visual card.

import {
  blobs, leagueContextBlock, myRosterBlock, callClaude, trendBlock,
} from "./lib/ocho.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let offer = "";
  try {
    const body = await req.json();
    offer = (body.offer || "").slice(0, 1200);
  } catch (e) { /* empty */ }
  if (!offer.trim()) {
    return new Response(JSON.stringify({ error: "describe the trade to evaluate" }), { status: 400 });
  }

  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ error: "no snapshot yet" }), { status: 409 });
  const [newsDigest, statsDigest, trends] = await Promise.all([
    store.get("news_digest", { type: "json" }),
    store.get("stats_digest", { type: "json" }),
    store.get("trends", { type: "json" }),
  ]);

  const newsLine = (newsDigest?.items || []).filter(i => i.score >= 40).slice(0, 12)
    .map(i => `- ${i.title}`).join("\n");
  const trendLine = trendBlock(trends);

  const prompt = `You are my dynasty trade evaluator. Someone in my league has offered me a trade (or I'm considering one). Judge it honestly and tell me accept, decline, or counter. Use web search for current dynasty values, injuries, and news on the players involved.

${leagueContextBlock(snapshot)}

MY FULL ROSTER (The Nightmen):
${myRosterBlock(snapshot)}
${newsLine ? `\nRELEVANT RECENT HEADLINES:\n${newsLine}` : ""}${trendLine}

THE TRADE ON THE TABLE (as I described it):
"${offer}"

First, if I didn't clearly specify which side gets what, infer it sensibly and state your assumption in one line.

OUTPUT FORMAT: emit a <TRADES_JSON> ... </TRADES_JSON> block with a SINGLE-element array in this shape:
[{"partner":"other manager/team","iSend":[{"name":"...","type":"player"|"pick","pos":"RB"|null,"value":0-100}],"iGet":[...],"verdict":"ACCEPT / DECLINE / COUNTER + one line why","confidence":"High"|"Medium"|"Low","leanScore":-100 to 100 (positive favors me),"caseAgainst":"one line"}]
Values are dynasty trade value 0-100 from your research. Then in prose:
1. Your verdict (accept/decline/counter) and the real reason, tied to MY roster needs and this player's current outlook.
2. If COUNTER: the exact counter-offer I should send back, and why it's still fair to them (so they'll take it).
3. Fit note: does this fix a hole of mine or open one.

MANDATORY FINAL SECTION: end with "## THE MOVE" and one directive (accept as-is, send this counter, or walk away).`;

  try {
    const text = await callClaude(prompt, { maxTokens: 2800 });
    await store.setJSON("last_evaluation", { at: Date.now(), offer, text });
    return new Response(JSON.stringify({ ok: true, text }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
};
