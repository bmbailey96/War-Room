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

  // Fresh snapshot + news harvest so the analysis sees the league and the wire as of right now
  await Promise.all([
    fetch(`${base}/.netlify/functions/snapshot`).catch(() => {}),
    fetch(`${base}/.netlify/functions/news`).catch(() => {}),
  ]);

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
