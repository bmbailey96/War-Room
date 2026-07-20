// WEEKLY BRIEFING. Runs Sunday nights. Composes a single "State of the
// Nightmen" digest from everything the system knows, stores it, and pushes
// a short version to the phone so the machine comes to Brandon instead of
// him checking tabs.

import {
  blobs, callClaude, leagueContextBlock, myRosterBlock,
} from "./lib/ocho.mjs";

async function notify(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { title, tags: "newspaper,football", "content-type": "text/plain" },
      body: message.slice(0, 700),
    });
  } catch (e) { /* best effort */ }
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ ok: false, reason: "no snapshot" }));

  const [changelog, gradingRecord, tradesA, pickupsA] = await Promise.all([
    store.get("changelog", { type: "json" }),
    store.get("grading_record", { type: "json" }),
    store.get("analysis_trades", { type: "json" }),
    store.get("analysis_pickups", { type: "json" }),
  ]);

  const recentMoves = (changelog || []).slice(-6).map(e => e.desc).join("\n") || "No league moves this week.";
  const track = gradingRecord && gradingRecord.total
    ? `${gradingRecord.hits}/${gradingRecord.total} graded calls hit (${Math.round(gradingRecord.hits / gradingRecord.total * 100)}%)`
    : "not enough graded calls yet";

  const prompt = `You are writing my weekly dynasty fantasy briefing: "State of the Nightmen." Keep it tight, one screen, plain and direct. No filler, no hype.

${leagueContextBlock(snapshot)}

MY ROSTER:
${myRosterBlock(snapshot)}

LEAGUE MOVES THIS WEEK:
${recentMoves}

MY SYSTEM'S RECOMMENDATION TRACK RECORD: ${track}

Write four short sections:
## Where I Stand
Two sentences on my team's position and trajectory.
## What Moved
What changed in the league this week that matters to me, if anything.
## Watch List
2-3 specific players or situations to monitor this week and why.
## THE MOVE
The single most important thing to do this week. One directive.`;

  try {
    const text = await callClaude(prompt, { maxTokens: 1800 });
    await store.setJSON("briefing", { at: Date.now(), text });
    // Push a short teaser: the "THE MOVE" line
    const moveMatch = text.match(/##\s*THE MOVE\s*\n([\s\S]*?)$/i);
    const teaser = moveMatch ? moveMatch[1].trim() : "Your weekly briefing is ready.";
    await notify("State of the Nightmen", teaser);
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 502 });
  }
};

export const config = { schedule: "0 2 * * 1" };
