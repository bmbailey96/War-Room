// PREGAME SWEEP. Runs frequently on game days (Sun/Mon/Thu mornings and
// midday). Checks MY starters against the freshest injury and inactive news,
// and if a starter is newly Out/Doubtful/inactive, pushes a phone alert with
// the best bench pivot at that position. This is the single highest-value
// in-season safety net: the difference between winning and losing a week is
// often a Sunday-morning inactive nobody caught.

import {
  blobs, resolveLeague, getPlayersTrim, callClaude,
  MY_USER_ID, STARTER_NEEDS,
} from "./lib/ocho.mjs";

const NV = "https://github.com/nflverse/nflverse-data/releases/download";

async function notify(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { title, tags: "rotating_light,football", priority: "high", "content-type": "text/plain" },
      body: message.slice(0, 700),
    });
  } catch (e) { /* best effort */ }
}

async function csv(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }
}

function parseInjuries(text) {
  // nflverse injuries csv: columns include full_name, report_status, game_status
  if (!text) return {};
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",").map(h => h.replace(/"/g, ""));
  const iName = header.indexOf("full_name");
  const iStatus = header.findIndex(h => h === "report_status" || h === "game_status");
  const map = {};
  for (const line of lines) {
    const c = line.split(",").map(x => x.replace(/^"|"$/g, ""));
    const name = c[iName], status = c[iStatus];
    if (name && status) map[name.toLowerCase().replace(/[^a-z ]/g, "").trim()] = status;
  }
  return map;
}

export default async () => {
  const store = blobs();
  const nflState = await fetch("https://api.sleeper.app/v1/state/nfl").then(r => r.json()).catch(() => ({}));
  const week = nflState.week || 0;
  const inSeason = nflState.season_type === "regular" && week >= 1;
  if (!inSeason) {
    return new Response(JSON.stringify({ ok: true, skipped: "offseason, no lineups to protect" }));
  }

  const leagueId = await resolveLeague();
  const [playersDB, rosters, injText] = await Promise.all([
    getPlayersTrim(),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()).catch(() => []),
    csv(`${NV}/injuries/injuries_${nflState.season}.csv`),
  ]);
  const myRoster = (rosters || []).find(r => r.owner_id === MY_USER_ID);
  if (!myRoster) return new Response(JSON.stringify({ ok: false, reason: "my roster not found" }));

  const injuries = parseInjuries(injText);
  const norm = s => (s || "").toLowerCase().replace(/[^a-z ]/g, "").trim();
  const OUT_STATUSES = /^(out|doubtful|inactive|ir|injured reserve|did not participate)/i;

  // My current starters are the players Sleeper has in the starting slots
  const starters = (myRoster.starters || []).filter(pid => pid && pid !== "0");
  const bench = (myRoster.players || []).filter(pid => !starters.includes(pid) && pid !== "0");

  const flagged = [];
  for (const pid of starters) {
    const info = playersDB[pid];
    if (!info) continue;
    const status = injuries[norm(info.n)];
    if (status && OUT_STATUSES.test(status)) {
      // best bench pivot at same position
      const alt = bench
        .map(bpid => playersDB[bpid])
        .filter(b => b && b.p === info.p && !(injuries[norm(b.n)] && OUT_STATUSES.test(injuries[norm(b.n)])))
        .sort((a, b) => (b.a ? 0 : 0)); // no per-week proj here; first healthy same-pos option
      flagged.push({
        starter: info.n, pos: info.p, status,
        pivot: alt.length ? alt[0].n : null,
      });
    }
  }

  // Only alert on NEW flags (don't re-nag about the same player all day)
  const prev = (await store.get("pregame_flagged", { type: "json" })) || { week: 0, names: [] };
  const seen = prev.week === week ? new Set(prev.names) : new Set();
  const fresh = flagged.filter(f => !seen.has(f.starter));

  if (fresh.length) {
    const lines = fresh.map(f => `${f.starter} (${f.pos}) is ${f.status}. ${f.pivot ? `Start ${f.pivot} instead.` : `No healthy ${f.pos} on your bench, check waivers.`}`);
    await notify(`Lineup alert, week ${week}`, lines.join("\n"));
  }
  await store.setJSON("pregame_flagged", { week, names: flagged.map(f => f.starter), at: Date.now(), detail: flagged });

  return new Response(JSON.stringify({ ok: true, week, flagged: flagged.length, fresh: fresh.length, detail: flagged }), {
    headers: { "content-type": "application/json" },
  });
};

// Game-day sweeps: Thu 4pm/6pm, Sun 8am-1pm hourly-ish, Mon 4pm/6pm ET.
// Cron is UTC. Sun 12:00-18:00 UTC covers 8am-2pm ET pregame window.
export const config = { schedule: "0 12,14,16,17 * * 0,1,4" };
