// Manual trigger: the UI's "run fresh analysis" buttons POST here.
// Optionally refreshes the snapshot first, then queues the background run.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  const base = new URL(req.url).origin;
  let task = "trades";
  try {
    const body = await req.json();
    if (body.task) task = body.task;
  } catch (e) { /* default */ }

  // Fresh snapshot + news harvest so the analysis sees the league and the wire
  // as of right now. These go through run.mjs: snapshot.mjs and news.mjs are
  // scheduled functions, and Netlify answers 403 to a direct HTTP call, so the
  // old direct fetches here never actually refreshed anything.
  await fetch(`${base}/.netlify/functions/run?job=snapshot,news`).catch(() => {});

  // Queue the long-running work
  await fetch(`${base}/.netlify/functions/analyze-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: [task] }),
  });

  return new Response(JSON.stringify({ ok: true, queued: task }), {
    headers: { "content-type": "application/json" },
  });
};
