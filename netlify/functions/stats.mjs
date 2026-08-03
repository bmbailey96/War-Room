// Runs daily. Pulls nflverse's free structured NFL data (updated nightly
// in season) and computes the deep-analytics digest that every AI prompt
// reasons over:
//   - per-team run/pass lean, EPA, explosiveness (season aggregate)
//   - FORM: how a team has played the last 3 games vs its season average.
//     A coordinator change or a QB change shows up here and nowhere else.
//   - DEFENSE VS POSITION: PPR points allowed per game by each defense to
//     QB/RB/WR/TE. This is the matchup half the app used to be blind to.
//   - USAGE: snap share, target share and touches for EVERY player rostered
//     in the league plus unrostered movers. Was previously my players only,
//     which meant pickup advice had no usage evidence behind it.
//   - official injury report entries for every league-rostered player
//
// Offseason: current-season files don't exist yet, so it falls back to the
// most recent season and flags seasonIsCurrent=false. Every block that
// consumes this labels itself stale rather than passing last year's numbers
// off as this week's.

import { blobs, normName } from "./lib/ocho.mjs";

const NV = "https://github.com/nflverse/nflverse-data/releases/download";

async function tryCsv(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    return res.text();
  } catch (e) {
    return null;
  }
}

function splitLine(line) {
  const cells = [];
  let field = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cells.push(field); field = ""; }
    else field += c;
  }
  cells.push(field);
  return cells;
}

// Column-selective CSV reader. The weekly player file is ~8MB across 130
// columns; materialising a full object per row blows memory for no reason.
function parseCsvCols(text, wanted) {
  const out = [];
  const lines = text.split(/\r?\n/);
  if (!lines.length) return out;
  const header = splitLine(lines[0]);
  const idx = {};
  for (const w of wanted) {
    const i = header.indexOf(w);
    if (i >= 0) idx[w] = i;
  }
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const cells = splitLine(line);
    const row = {};
    for (const k in idx) row[k] = cells[idx[k]];
    out.push(row);
  }
  return out;
}

const n = v => (v === undefined || v === null || v === "" || v === "NA") ? 0 : (+v || 0);
const r1 = v => Math.round(v * 10) / 10;

// Standard PPR, 1QB.
function pprPoints(r) {
  return n(r.passing_yards) * 0.04
    + n(r.passing_tds) * 4
    - n(r.passing_interceptions) * 2
    + n(r.rushing_yards) * 0.1
    + n(r.rushing_tds) * 6
    + n(r.receptions) * 1
    + n(r.receiving_yards) * 0.1
    + n(r.receiving_tds) * 6
    - n(r.rushing_fumbles_lost) * 2
    - n(r.receiving_fumbles_lost) * 2;
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  const nowYear = new Date().getFullYear();

  let season = null, teamCsv = null;
  for (const yr of [nowYear, nowYear - 1]) {
    teamCsv = await tryCsv(`${NV}/stats_team/stats_team_reg_${yr}.csv`);
    if (teamCsv) { season = yr; break; }
  }
  if (!teamCsv) {
    return new Response(JSON.stringify({ error: "no nflverse team stats available" }), { status: 502 });
  }

  // ---- Season-long team tendencies ----
  const tendencies = {};
  for (const r of parseCsvCols(teamCsv, [
    "team", "games", "attempts", "carries", "passing_epa", "rushing_epa", "passing_40", "sacks_suffered",
  ])) {
    const att = n(r.attempts), car = n(r.carries);
    const plays = att + car;
    if (!plays || !r.team) continue;
    tendencies[r.team] = {
      passRate: r1(att / plays * 100),
      playsPerGame: r1(plays / Math.max(n(r.games), 1)),
      passEpa: r1(n(r.passing_epa)),
      rushEpa: r1(n(r.rushing_epa)),
      explosivePass40: n(r.passing_40),
      sacksAllowed: n(r.sacks_suffered),
    };
  }

  // ---- FORM: last 3 games vs season ----
  const form = {};
  const teamWeekCsv = await tryCsv(`${NV}/stats_team/stats_team_week_${season}.csv`);
  if (teamWeekCsv) {
    const byTeam = {};
    for (const r of parseCsvCols(teamWeekCsv, ["team", "week", "attempts", "carries", "season_type"])) {
      if (!r.team) continue;
      if (r.season_type && r.season_type !== "REG") continue;
      (byTeam[r.team] = byTeam[r.team] || []).push({ week: n(r.week), att: n(r.attempts), car: n(r.carries) });
    }
    for (const [team, weeks] of Object.entries(byTeam)) {
      weeks.sort((a, b) => a.week - b.week);
      const recent = weeks.slice(-3);
      const sum = arr => arr.reduce((acc, w) => ({ att: acc.att + w.att, car: acc.car + w.car }), { att: 0, car: 0 });
      const rs = sum(recent), ss = sum(weeks);
      const rp = rs.att + rs.car, sp = ss.att + ss.car;
      if (!rp || !sp) continue;
      form[team] = {
        recentPassRate: r1(rs.att / rp * 100),
        seasonPassRate: r1(ss.att / sp * 100),
        recentPlays: r1(rp / recent.length),
        gamesUsed: recent.length,
        throughWeek: weeks.at(-1).week,
      };
    }
  }

  // ---- Who is rostered where ----
  const rosteredNames = new Set();
  const myNames = new Set();
  if (snapshot) {
    for (const t of snapshot.teams) {
      for (const p of t.players) {
        if (!p.name) continue;
        rosteredNames.add(normName(p.name));
        if (t.isMe) myNames.add(normName(p.name));
      }
    }
  }

  // ---- Injuries for league-rostered players ----
  const injuries = [];
  const injCsv = await tryCsv(`${NV}/injuries/injuries_${season}.csv`);
  if (injCsv) {
    const rows = parseCsvCols(injCsv, [
      "full_name", "team", "week", "report_status", "practice_status",
      "report_primary_injury", "practice_primary_injury",
    ]);
    let maxWeek = 0;
    for (const r of rows) maxWeek = Math.max(maxWeek, n(r.week));
    for (const r of rows) {
      if (n(r.week) < maxWeek - 1) continue;
      const key = normName(r.full_name || "");
      if (!rosteredNames.has(key)) continue;
      injuries.push({
        player: r.full_name, team: r.team, week: n(r.week),
        status: r.report_status || r.practice_status || "",
        injury: r.report_primary_injury || r.practice_primary_injury || "",
        mine: myNames.has(key),
      });
    }
  }

  // ---- DEFENSE VS POSITION + target share / touches ----
  // The 8MB weekly player file is fetched once and used for both.
  const defense = {};
  const playerAgg = {};
  const playerWeekCsv = await tryCsv(`${NV}/stats_player/stats_player_week_${season}.csv`);
  if (playerWeekCsv) {
    const rows = parseCsvCols(playerWeekCsv, [
      "player_display_name", "position", "week", "team", "opponent_team", "season_type",
      "passing_yards", "passing_tds", "passing_interceptions",
      "rushing_yards", "rushing_tds", "rushing_fumbles_lost", "carries",
      "receptions", "receiving_yards", "receiving_tds", "receiving_fumbles_lost",
      "targets", "target_share",
    ]);
    let maxWeek = 0;
    for (const r of rows) {
      if (r.season_type && r.season_type !== "REG") continue;
      maxWeek = Math.max(maxWeek, n(r.week));
    }
    const allowed = {};
    for (const r of rows) {
      if (r.season_type && r.season_type !== "REG") continue;
      const pos = r.position;
      const def = r.opponent_team;
      if (def && (pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE")) {
        const d = (allowed[def] = allowed[def] || {});
        const slot = (d[pos] = d[pos] || { pts: 0, weeks: new Set() });
        slot.pts += pprPoints(r);
        slot.weeks.add(n(r.week));
      }
      const key = normName(r.player_display_name || "");
      if (!key) continue;
      const wk = n(r.week);
      const bucket = wk > maxWeek - 3 ? "recent" : (wk > maxWeek - 6 ? "prior" : null);
      if (!bucket) continue;
      const a = (playerAgg[key] = playerAgg[key] || {
        name: r.player_display_name, team: r.team,
        recent: { g: 0, tgtShare: 0, touches: 0 }, prior: { g: 0, tgtShare: 0, touches: 0 },
      });
      a.team = r.team || a.team;
      const b = a[bucket];
      b.g++;
      b.tgtShare += n(r.target_share) * 100;
      b.touches += n(r.carries) + n(r.receptions);
    }
    for (const [def, positions] of Object.entries(allowed)) {
      defense[def] = {};
      for (const [pos, v] of Object.entries(positions)) {
        defense[def][pos] = r1(v.pts / (v.weeks.size || 1));
      }
    }
  }

  // ---- USAGE: snap share for everyone who matters ----
  let usage = [];
  const snapCsv = await tryCsv(`${NV}/snap_counts/snap_counts_${season}.csv`);
  if (snapCsv) {
    const rows = parseCsvCols(snapCsv, ["player", "position", "team", "week", "offense_pct", "game_type"]);
    let maxWeek = 0;
    for (const r of rows) {
      if (r.game_type && r.game_type !== "REG") continue;
      maxWeek = Math.max(maxWeek, n(r.week));
    }
    const byPlayer = {};
    for (const r of rows) {
      if (r.game_type && r.game_type !== "REG") continue;
      if (!["QB", "RB", "WR", "TE", "FB"].includes(r.position)) continue;
      const key = normName(r.player || "");
      if (!key) continue;
      const p = (byPlayer[key] = byPlayer[key] || { name: r.player, team: r.team, weeks: [] });
      p.team = r.team || p.team;
      p.weeks.push({ week: n(r.week), pct: Math.round(n(r.offense_pct) * 100) });
    }
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    for (const [key, p] of Object.entries(byPlayer)) {
      p.weeks.sort((a, b) => a.week - b.week);
      const recent = p.weeks.filter(w => w.week > maxWeek - 3).map(w => w.pct);
      const prior = p.weeks.filter(w => w.week <= maxWeek - 3 && w.week > maxWeek - 6).map(w => w.pct);
      if (!recent.length) continue;
      const agg = playerAgg[key];
      const rec = agg && agg.recent.g ? agg.recent : null;
      usage.push({
        player: p.name,
        team: p.team,
        recentGames: recent.length,
        recentSnapPct: avg(recent),
        priorSnapPct: avg(prior),
        lastWeekSeen: p.weeks.at(-1).week,
        tgtShare: rec ? r1(rec.tgtShare / rec.g) : null,
        touches: rec ? r1(rec.touches / rec.g) : null,
        mine: myNames.has(key),
        rostered: rosteredNames.has(key),
      });
    }
    // Bounded: everything rostered in the league, plus the biggest snap-share
    // risers among free agents. That second group is where pickups come from.
    const rostered = usage.filter(u => u.rostered);
    // Quality gate on the free-agent movers. Without it the list fills with
    // backups who played one meaningless game: a week-18 spike is not a
    // pickup signal. Require real snaps across at least two of the last
    // three games plus actual volume.
    const freeAgents = usage
      .filter(u => !u.rostered && u.recentSnapPct != null && u.priorSnapPct != null)
      .filter(u => u.recentGames >= 2 && u.recentSnapPct >= 40)
      .filter(u => (u.touches != null && u.touches >= 3) || (u.tgtShare != null && u.tgtShare >= 8))
      .sort((a, b) => (b.recentSnapPct - b.priorSnapPct) - (a.recentSnapPct - a.priorSnapPct))
      .slice(0, 40);
    usage = [...rostered, ...freeAgents];
  }

  await store.setJSON("stats_digest", {
    at: Date.now(), season,
    seasonIsCurrent: season === nowYear,
    tendencies, form, defense, injuries: injuries.slice(0, 80), usage,
  });

  return new Response(JSON.stringify({
    ok: true, season, seasonIsCurrent: season === nowYear,
    teams: Object.keys(tendencies).length,
    form: Object.keys(form).length,
    defenses: Object.keys(defense).length,
    injuries: injuries.length,
    usageTracked: usage.length,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "30 11 * * *" };
