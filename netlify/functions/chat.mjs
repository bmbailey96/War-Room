// CHAT. On demand. Ask anything and get an answer grounded in the full
// system context: my roster, the whole league, owner behavior, the news
// wire, team stats, trends, and the grading record. Keeps a short rolling
// conversation so follow-ups make sense.

import {
  blobs, leagueContextBlock, myRosterBlock, callClaude, trendBlock, OWNER_HISTORY,
} from "./lib/ocho.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let question = "", history = [];
  try {
    const body = await req.json();
    question = (body.question || "").slice(0, 800);
    history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  } catch (e) { /* empty */ }
  if (!question.trim()) {
    return new Response(JSON.stringify({ error: "ask a question" }), { status: 400 });
  }

  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ error: "no snapshot yet" }), { status: 409 });
  const [newsDigest, statsDigest, trends, grading] = await Promise.all([
    store.get("news_digest", { type: "json" }),
    store.get("stats_digest", { type: "json" }),
    store.get("trends", { type: "json" }),
    store.get("grading_record", { type: "json" }),
  ]);

  const newsLine = (newsDigest?.items || []).filter(i => i.score >= 35).slice(0, 15)
    .map(i => `- ${i.title}`).join("\n");
  const trendLine = trendBlock(trends);
  const trackLine = grading && grading.total >= 3
    ? `\nMy recommendation track record so far: ${grading.hits}/${grading.total} graded calls hit.` : "";

  const convo = history.map(h => `${h.role === "user" ? "Me" : "You"}: ${h.text}`).join("\n");

  const prompt = `You are my dynasty fantasy football co-manager for the league below. Answer my question directly and honestly, grounded in this context. Use web search when the question needs current news, injuries, or values. Be concise and specific. If I'm about to do something dumb, say so. Never pad.

${leagueContextBlock(snapshot)}

MY FULL ROSTER (The Nightmen):
${myRosterBlock(snapshot)}
${newsLine ? `\nRECENT HEADLINES:\n${newsLine}` : ""}${trendLine}${trackLine}
${convo ? `\nCONVERSATION SO FAR:\n${convo}\n` : ""}
MY QUESTION: ${question}`;

  try {
    const text = await callClaude(prompt, { maxTokens: 1600 });
    return new Response(JSON.stringify({ ok: true, text }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
};
