// Runs daily at 13:00 UTC (7am Mountain in summer). Decides which analyses
// are due and kicks them off in the background function, because AI research
// with web search runs 30-90+ seconds and synchronous functions get killed
// at ~26s. Background functions get 15 minutes.

export default async (req) => {
  const base = new URL(req.url).origin;
  const state = await fetch("https://api.sleeper.app/v1/state/nfl").then(r => r.json()).catch(() => ({}));
  const inSeason = state.season_type === "regular" && state.week >= 1;
  const day = new Date().getUTCDay(); // 0 Sun ... 6 Sat

  const tasks = ["trades", "pickups"];
  // Sit/start: Thu(4) Sat(6) Sun(0) in season; Mondays(1) offseason as a roster stress test
  if (inSeason ? [4, 6, 0].includes(day) : day === 1) tasks.push("sitstart");
  // Team-by-team intel book: refresh weekly on Mondays
  if (day === 1) tasks.push("teams");

  // Fire the standalone scheduled helpers too (they self-gate on league state)
  const fire = (fn) => fetch(`${base}/.netlify/functions/${fn}`).catch(() => {});
  await Promise.all([fire("draft")]); // draft board (only acts in pre_draft/drafting)

  // Fire and forget: background function does the heavy lifting
  await fetch(`${base}/.netlify/functions/analyze-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks }),
  });

  return new Response(JSON.stringify({ ok: true, queued: tasks }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "0 13 * * *" };
