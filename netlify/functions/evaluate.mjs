// TRADE EVALUATOR dispatcher. The real work runs in evaluate-background.mjs,
// because sync functions die at ~26s and a full-context evaluation takes
// 25-45s, which was the source of the 504s. This queues it; the frontend
// polls get-data for evaluation_result.

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  const body = await req.text();
  const base = new URL(req.url).origin;
  await fetch(`${base}/.netlify/functions/evaluate-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(JSON.stringify({ ok: true, queued: true }), {
    headers: { "content-type": "application/json" },
  });
};