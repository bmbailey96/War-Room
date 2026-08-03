// Manual runner for the scheduled jobs.
//
// Netlify refuses HTTP invocation of any function that exports a `schedule`
// config; it answers 403 with an empty body. Every data job in this app is
// scheduled, so none of them could be run on demand, and trigger.mjs's
// "refresh the snapshot and the news first" step has been silently 403ing on
// every analysis run. Importing a scheduled module and calling its default
// export is fine, so this file is the door.
//
//   /.netlify/functions/run?job=stats
//   /.netlify/functions/run?job=project
//   /.netlify/functions/run?job=all      (snapshot, values, news, stats, project, in order)

import snapshot from "./snapshot.mjs";
import news from "./news.mjs";
import stats from "./stats.mjs";
import values from "./values.mjs";
import project from "./project.mjs";

const JOBS = { snapshot, news, stats, values, project };

// Order matters: project reads the stats digest, stats reads the snapshot.
const ALL = ["snapshot", "values", "news", "stats", "project"];

async function runJob(name) {
  const fn = JOBS[name];
  if (!fn) return { job: name, ok: false, error: "unknown job" };
  const started = Date.now();
  try {
    const res = await fn();
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { job: name, ok: res.status < 400, status: res.status, ms: Date.now() - started, result: body };
  } catch (e) {
    return { job: name, ok: false, ms: Date.now() - started, error: String(e && e.message || e) };
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const job = (url.searchParams.get("job") || "").toLowerCase();

  if (!job) {
    return new Response(JSON.stringify({
      error: "pass ?job=",
      jobs: Object.keys(JOBS).concat("all"),
    }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const names = job === "all" ? ALL : job.split(",").map(x => x.trim()).filter(Boolean);
  const results = [];
  for (const name of names) results.push(await runJob(name));

  return new Response(JSON.stringify({
    ok: results.every(r => r.ok),
    ran: results,
  }, null, 2), { headers: { "content-type": "application/json" } });
};
