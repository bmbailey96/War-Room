// Runs daily. Pulls nflverse's free structured NFL data (updated nightly
// in season) and computes the deep-analytics digest:
//   - per-team run/pass lean, EPA, explosiveness (from team stats)
//   - official injury report entries for every league-rostered player
//   - usage trends for my players (snap counts)
// Offseason: the current-season files don't exist yet, so it uses the most
// recent season available and labels it as such. In camp/preseason the
// injuries file goes live and this gets sharp automatically.

import { blobs } from "./lib/ocho.mjs";

const NV = "https://github.com/nflverse/nflverse-data/releases/download";

async function tryCsv(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  return res.text();
}

// Minimal CSV parse handling quoted fields
function parseCsv(text, maxRows = 100000) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (rows.length > maxRows) break;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  const nowYear = new Date().getFullYear();

  // Find the freshest season with data (current year first, then last year)
  let season = null, teamCsv = null;
  for (const yr of [nowYear, nowYear - 1]) {
    teamCsv = await tryCsv(`${NV}/stats_team/stats_team_reg_${yr}.csv`);
    if (teamCsv) { season = yr; break; }
  }
  if (!teamCsv) {
    return new Response(JSON.stringify({ error: "no nflverse team stats available" }), { status: 502 });
  }

  // ---- Team tendencies ----
  const teamRows = parseCsv(teamCsv);
  const tendencies = {};
  for (const r of teamRows) {
    const att = +r.attempts || 0, car = +r.carries || 0;
    const plays = att + car;
    if (!plays) continue;
    tendencies[r.team] = {
      passRate: Math.round(att / plays * 1000) / 10,
      playsPerGame: Math.round(plays / Math.max(+r.games || 1, 1) * 10) / 10,
      passEpa: Math.round((+r.passing_epa || 0) * 10) / 10,
      rushEpa: Math.round((+r.rushing_epa || 0) * 10) / 10,
      explosivePass40: +r.passing_40 || 0,
      sacksAllowed: +r.sacks_suffered || 0,
    };
  }

  // ---- Injuries for league-rostered players ----
  const rosteredNames = new Set();
  const myNames = new Set();
  if (snapshot) {
    for (const t of snapshot.teams) {
      for (const p of t.players) {
        if (!p.name) continue;
        rosteredNames.add(p.name.toLowerCase());
        if (t.isMe) myNames.add(p.name.toLowerCase());
      }
    }
  }
  const injuries = [];
  const injCsv = await tryCsv(`${NV}/injuries/injuries_${season}.csv`);
  if (injCsv) {
    const rows = parseCsv(injCsv);
    // keep only the latest week's report rows per player
    let maxWeek = 0;
    for (const r of rows) maxWeek = Math.max(maxWeek, +r.week || 0);
    for (const r of rows) {
      if ((+r.week || 0) < maxWeek - 1) continue;
      const name = (r.full_name || "").toLowerCase();
      if (!rosteredNames.has(name)) continue;
      injuries.push({
        player: r.full_name, team: r.team, week: +r.week,
        status: r.report_status || r.practice_status || "",
        injury: r.report_primary_injury || r.practice_primary_injury || "",
        mine: myNames.has(name),
      });
    }
  }

  // ---- My players' snap trends (last 3 weeks vs prior 3) ----
  const usage = [];
  const snapCsv = await tryCsv(`${NV}/snap_counts/snap_counts_${season}.csv`);
  if (snapCsv && myNames.size) {
    const rows = parseCsv(snapCsv);
    let maxWeek = 0;
    for (const r of rows) maxWeek = Math.max(maxWeek, +r.week || 0);
    const byPlayer = {};
    for (const r of rows) {
      const name = (r.player || "").toLowerCase();
      if (!myNames.has(name)) continue;
      (byPlayer[r.player] = byPlayer[r.player] || []).push({ week: +r.week, pct: Math.round((+r.offense_pct || 0) * 100) });
    }
    for (const [player, weeks] of Object.entries(byPlayer)) {
      weeks.sort((a, b) => a.week - b.week);
      const recent = weeks.filter(w => w.week > maxWeek - 3).map(w => w.pct);
      const prior = weeks.filter(w => w.week <= maxWeek - 3 && w.week > maxWeek - 6).map(w => w.pct);
      const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
      usage.push({ player, recentSnapPct: avg(recent), priorSnapPct: avg(prior), lastWeekSeen: weeks.at(-1)?.week });
    }
  }

  await store.setJSON("stats_digest", {
    at: Date.now(), season,
    seasonIsCurrent: season === nowYear,
    tendencies, injuries: injuries.slice(0, 60), usage,
  });

  return new Response(JSON.stringify({
    ok: true, season, teams: Object.keys(tendencies).length,
    injuries: injuries.length, usageTracked: usage.length,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "30 11 * * *" };
