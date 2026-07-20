// Shared library for all Ocho War Room functions.
// Server-side mirror of the frontend's compute layer.

import { getStore } from "@netlify/blobs";

export const USERNAME = "sigourneybeaver";
export const MY_USER_ID = "863128676391383040";
export const FALLBACK_LEAGUE_ID = "1205222463223365632";
export const LEAGUE_NAME_PATTERN = /ocho|teenypetes/i;

export const STARTER_NEEDS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, DL_eligible: 1 };

// Career history from 4 seasons (2022-2025). Refresh after each season.
export const OWNER_HISTORY = {"460522508903247872":{"display_name":"AverageRedneck","championships":["2023"],"win_pct":0.589,"trades_count":12,"trade_positions_acquired":{"RB":5,"WR":3,"QB":4,"TE":2},"lineup_efficiency_pct":82.2,"avg_bench_leak_per_week":37.0,"dead_starts_4yr":11,"trade_ros_net_pts":167.8},"862447704859635712":{"display_name":"lackeymatt","championships":[],"win_pct":0.536,"trades_count":23,"trade_positions_acquired":{"QB":4,"WR":19,"TE":1,"RB":7,"DL":2},"lineup_efficiency_pct":80.3,"avg_bench_leak_per_week":40.2,"dead_starts_4yr":13,"trade_ros_net_pts":735.1},"862526263095586816":{"display_name":"owmyballs","championships":[],"win_pct":0.268,"trades_count":4,"trade_positions_acquired":{"QB":2,"WR":1},"lineup_efficiency_pct":81.4,"avg_bench_leak_per_week":29.5,"dead_starts_4yr":64,"trade_ros_net_pts":444.3},"863128676391383040":{"display_name":"SigourneyBeaver","championships":[],"win_pct":0.607,"trades_count":26,"trade_positions_acquired":{"TE":3,"RB":5,"WR":9},"lineup_efficiency_pct":84.7,"avg_bench_leak_per_week":32.3,"dead_starts_4yr":10,"trade_ros_net_pts":-1647.1},"863157773284864000":{"display_name":"Birkey","championships":["2024"],"win_pct":0.679,"trades_count":23,"trade_positions_acquired":{"RB":9,"WR":9,"QB":6,"DL":1},"lineup_efficiency_pct":84.9,"avg_bench_leak_per_week":32.6,"dead_starts_4yr":11,"trade_ros_net_pts":-2601.1},"863467130702671872":{"display_name":"MikahH","championships":["2022"],"win_pct":0.464,"trades_count":33,"trade_positions_acquired":{"QB":7,"WR":20,"RB":12,"TE":3},"lineup_efficiency_pct":84.6,"avg_bench_leak_per_week":30.7,"dead_starts_4yr":14,"trade_ros_net_pts":255.6},"994817581137604608":{"display_name":"SexyJexy19","championships":["2025"],"win_pct":0.429,"trades_count":11,"trade_positions_acquired":{"QB":2,"RB":3,"TE":1,"WR":4},"lineup_efficiency_pct":81.7,"avg_bench_leak_per_week":36.8,"dead_starts_4yr":10,"trade_ros_net_pts":699.3},"1027938591684538368":{"display_name":"aaronjy1999","championships":[],"win_pct":0.393,"trades_count":7,"trade_positions_acquired":{"RB":2,"WR":3,"QB":2},"lineup_efficiency_pct":76.9,"avg_bench_leak_per_week":45.4,"dead_starts_4yr":36,"trade_ros_net_pts":516.3},"501533314885087232":{"display_name":"vic2252","championships":[],"win_pct":0.357,"trades_count":3,"trade_positions_acquired":{"RB":1,"QB":2,"WR":1},"lineup_efficiency_pct":85.9,"avg_bench_leak_per_week":28.8,"dead_starts_4yr":3,"trade_ros_net_pts":206.8}};

export function blobs() {
  return getStore("ocho");
}

async function j(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function resolveLeague() {
  const u = await j(`https://api.sleeper.app/v1/user/${USERNAME}`);
  const year = new Date().getFullYear();
  for (const season of [year, year - 1]) {
    try {
      const leagues = await j(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/${season}`);
      const match = (leagues || []).find(l => LEAGUE_NAME_PATTERN.test(l.name || ""));
      if (match) return match.league_id;
    } catch (e) { /* try next */ }
  }
  return FALLBACK_LEAGUE_ID;
}

// Trimmed player DB, cached in blobs with a 20h TTL.
export async function getPlayersTrim() {
  const store = blobs();
  const cached = await store.get("players_trim", { type: "json" });
  if (cached && Date.now() - cached.t < 1000 * 60 * 60 * 20) return cached.d;
  const full = await j("https://api.sleeper.app/v1/players/nfl");
  const trim = {};
  for (const [pid, p] of Object.entries(full)) {
    if (!p || (!p.position && !p.fantasy_positions)) continue;
    trim[pid] = {
      n: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || pid,
      p: p.position || null,
      fp: p.fantasy_positions || null,
      a: p.age || null,
      t: p.team || null,
      inj: p.injury_status || null,
    };
  }
  await store.setJSON("players_trim", { t: Date.now(), d: trim });
  return trim;
}

export function pInfo(playersDB, pid) {
  const p = playersDB[pid];
  if (!p) return { name: pid, pos: null, fps: [], age: null, team: pid, inj: null };
  return { name: p.n, pos: p.p, fps: p.fp || (p.p ? [p.p] : []), age: p.a, team: p.t, inj: p.inj };
}

export async function fetchLeagueCore(leagueId) {
  const [league, rosters, users, tradedPicks, nflState, trending] = await Promise.all([
    j(`https://api.sleeper.app/v1/league/${leagueId}`),
    j(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
    j(`https://api.sleeper.app/v1/league/${leagueId}/users`),
    j(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`),
    j("https://api.sleeper.app/v1/state/nfl"),
    j("https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=40"),
  ]);
  // All 18 transaction weeks in parallel; offseason moves land in week 1.
  const txnWeeks = await Promise.all(
    Array.from({ length: 18 }, (_, i) =>
      j(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${i + 1}`).catch(() => [])
    )
  );
  return { league, rosters, users, tradedPicks, nflState, trending, txnWeeks };
}

export function computeSnapshot(core, playersDB) {
  const { league, rosters, users, tradedPicks } = core;
  const userById = Object.fromEntries(users.map(u => [u.user_id, u]));
  const teamName = ownerId => {
    const u = userById[ownerId] || {};
    return (u.metadata || {}).team_name || u.display_name || ownerId;
  };
  const ridToOwner = Object.fromEntries(rosters.map(r => [r.roster_id, r.owner_id]));

  const draftRounds = (league.settings || {}).draft_rounds || 3;
  const currentSeason = parseInt(league.season, 10);
  const nextSeasons = [String(currentSeason + 1), String(currentSeason + 2)];
  const tradedKeys = new Set();
  const ledger = Object.fromEntries(rosters.map(r => [r.roster_id, []]));
  for (const tp of tradedPicks || []) {
    if (nextSeasons.includes(String(tp.season))) {
      (ledger[tp.owner_id] = ledger[tp.owner_id] || []).push({
        season: tp.season, round: tp.round, original: teamName(ridToOwner[tp.roster_id]),
      });
      tradedKeys.add(`${tp.season}-${tp.round}-${tp.roster_id}`);
    }
  }
  for (const season of nextSeasons) {
    for (let rnd = 1; rnd <= draftRounds; rnd++) {
      for (const r of rosters) {
        if (!tradedKeys.has(`${season}-${rnd}-${r.roster_id}`)) {
          ledger[r.roster_id].push({ season, round: rnd, original: teamName(r.owner_id) });
        }
      }
    }
  }

  const teams = rosters.map(r => {
    const st = r.settings || {};
    const wins = st.wins || 0, losses = st.losses || 0;
    const winPct = wins / Math.max(wins + losses, 1);
    const fpts = (st.fpts || 0) + (st.fpts_decimal || 0) / 100;
    const ppts = (st.ppts || 0) + (st.ppts_decimal || 0) / 100;
    const players = (r.players || []).map(pid => ({ pid, ...pInfo(playersDB, pid) }));
    const ages = players.map(p => p.age).filter(Boolean);
    const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 10) / 10 : null;
    const depth = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, DL_eligible: 0 };
    for (const p of players) {
      if (p.pos && depth.hasOwnProperty(p.pos)) depth[p.pos]++;
      if ((p.fps || []).includes("DL")) depth.DL_eligible++;
    }
    const holes = Object.entries(STARTER_NEEDS)
      .filter(([pos, need]) => (depth[pos] || 0) <= need)
      .map(([pos]) => `${pos.replace("_eligible", " (IDP)")}: only ${depth[pos] || 0} rostered`);
    const surplus = ["RB", "WR", "TE"].filter(p => (depth[p] || 0) >= 8).map(p => `${p}: ${depth[p]} rostered`);
    const injured = players.filter(p => p.inj && p.inj !== "Questionable").map(p => `${p.name} (${p.inj})`);
    let stance;
    if (winPct >= 0.55 && (avgAge || 27) >= 27) stance = "Win-Now";
    else if (winPct >= 0.55) stance = "Ascending";
    else if (winPct < 0.45 && (avgAge || 27) < 26.5) stance = "Rebuilding";
    else if (winPct < 0.45) stance = "Retool Needed";
    else stance = "Middle of Pack";
    return {
      rosterId: r.roster_id, ownerId: r.owner_id,
      name: teamName(r.owner_id),
      ownerName: (OWNER_HISTORY[r.owner_id] || {}).display_name || "",
      wins, losses, winPct: Math.round(winPct * 1000) / 1000, avgAge,
      pointsFor: Math.round(fpts * 10) / 10,
      pointsAgainst: Math.round(((st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100) * 10) / 10,
      benchLeakage: ppts ? Math.round((ppts - fpts) * 10) / 10 : null,
      waiverPosition: st.waiver_position || null,
      depth, holes, surplus, injured,
      players: players.map(p => ({ name: p.name, pos: p.pos, team: p.team, age: p.age, inj: p.inj })),
      picks: ledger[r.roster_id].sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round),
      stance,
      isMe: r.owner_id === MY_USER_ID,
    };
  });

  // Standings projection: rank by wins, then points-for. Seed + in/out of
  // the playoff cut. In-season this is a live picture; preseason it's 0-0
  // so seeds are just points-for order until games happen.
  const ranked = [...teams].sort((a, b) =>
    (b.wins - a.wins) || (b.pointsFor - a.pointsFor) || (b.winPct - a.winPct)
  );
  const playoffTeams = (league.settings || {}).playoff_teams || 6;
  ranked.forEach((t, i) => {
    const orig = teams.find(x => x.rosterId === t.rosterId);
    orig.projectedSeed = i + 1;
    orig.inPlayoffs = i < playoffTeams;
  });

  return {
    at: Date.now(),
    season: league.season,
    leagueId: league.league_id,
    leagueName: league.name,
    rosterPositions: league.roster_positions,
    settings: {
      num_teams: (league.settings || {}).num_teams,
      draft_rounds: draftRounds,
      pick_trading: (league.settings || {}).pick_trading,
    },
    leagueStatus: league.status,
    playoffTeams,
    nflState: {
      week: core.nflState.week, season_type: core.nflState.season_type, season: core.nflState.season,
    },
    teams,
  };
}

export function describeTransaction(t, snapshot, playersDB) {
  const teamOf = rid => {
    const team = snapshot.teams.find(x => x.rosterId === rid);
    return team ? team.name : `roster ${rid}`;
  };
  const pName = pid => pInfo(playersDB, pid).name;
  if (t.type === "trade") {
    const parts = (t.roster_ids || []).map(rid => {
      const got = Object.entries(t.adds || {}).filter(([, r]) => r === rid).map(([pid]) => pName(pid));
      const picks = (t.draft_picks || []).filter(dp => dp.owner_id === rid)
        .map(dp => `${dp.season} R${dp.round}`);
      return `${teamOf(rid)} received ${[...got, ...picks].join(", ") || "(nothing listed)"}`;
    });
    return `TRADE: ${parts.join(" | ")}`;
  }
  const adds = Object.entries(t.adds || {}).map(([pid, rid]) => `${teamOf(rid)} added ${pName(pid)}`);
  const drops = Object.entries(t.drops || {}).map(([pid, rid]) => `${teamOf(rid)} dropped ${pName(pid)}`);
  return [...adds, ...drops].join("; ") || "(empty transaction)";
}

export function leagueContextBlock(snapshot) {
  const lines = snapshot.teams.map(t => {
    const h = OWNER_HISTORY[t.ownerId] || {};
    return [
      `TEAM: ${t.name} (owner: ${h.display_name || t.ownerId})${t.isMe ? " <-- THIS IS ME" : ""}`,
      `  Record ${t.wins}-${t.losses}, avg age ${t.avgAge}, stance: ${t.stance}`,
      `  Depth: QB ${t.depth.QB}, RB ${t.depth.RB}, WR ${t.depth.WR}, TE ${t.depth.TE}, K ${t.depth.K}, DEF ${t.depth.DEF}, DL-eligible ${t.depth.DL_eligible}`,
      `  Holes: ${t.holes.join("; ") || "none flagged"}`,
      `  Surplus: ${t.surplus.join("; ") || "none flagged"}`,
      `  Future picks: ${t.picks.map(p => `${p.season} R${p.round}${p.original !== t.name ? ` (from ${p.original})` : ""}`).join(", ")}`,
      `  Owner: ${h.trades_count ?? "?"} career trades, career win% ${h.win_pct ?? "?"}, titles ${(h.championships || []).join(", ") || "none"}, historically acquires: ${Object.entries(h.trade_positions_acquired || {}).map(([k, v]) => `${k} ${v}x`).join(", ") || "unknown"}`,
      `  Owner management (4yr data): lineup efficiency ${h.lineup_efficiency_pct ?? "?"}% of optimal, ${h.avg_bench_leak_per_week ?? "?"} pts/wk left on bench, ${h.dead_starts_4yr ?? "?"} dead starts (started a <=0pt player with a 5+pt bench option available; high count = inattentive owner who undervalues their assets), trade ROS net ${h.trade_ros_net_pts ?? "?"} pts (NOTE: this metric counts draft picks as 0, so pick-acquirers look artificially bad on it)`,
      `  Injuries: ${t.injured.slice(0, 6).join(", ") || "none flagged"}`,
    ].join("\n");
  }).join("\n\n");
  return `LEAGUE: ${snapshot.leagueName}, ${snapshot.season} season, status: ${snapshot.leagueStatus || "unknown"} (pre_draft means the rookie draft is coming; factor draft prep into every recommendation), ${snapshot.settings.num_teams}-team dynasty, ${snapshot.settings.draft_rounds}-round rookie drafts, pick trading ${snapshot.settings.pick_trading ? "allowed" : "off"}, no FAAB (rolling waivers). Lineup: ${JSON.stringify(snapshot.rosterPositions)}.\n\n${lines}`;
}

export function myRosterBlock(snapshot) {
  const me = snapshot.teams.find(t => t.isMe);
  if (!me) return "My roster not found.";
  const byPos = {};
  for (const p of me.players) {
    const k = p.pos || "UNK";
    (byPos[k] = byPos[k] || []).push(`${p.name} (${p.team || "FA"}, age ${p.age || "?"}${p.inj ? ", INJ: " + p.inj : ""})`);
  }
  return Object.entries(byPos).map(([pos, list]) => `${pos}: ${list.join("; ")}`).join("\n");
}

export function trendingBlock(core, snapshot, playersDB) {
  const rostered = new Set();
  for (const t of snapshot.teams) { /* names only, need pids: use core rosters */ }
  for (const r of core.rosters) for (const pid of r.players || []) rostered.add(pid);
  return (core.trending || [])
    .filter(t => !rostered.has(t.player_id))
    .slice(0, 25)
    .map(t => {
      const p = pInfo(playersDB, t.player_id);
      return `${p.name} (${p.pos || "?"}, ${p.team || "FA"}) - ${t.count} adds league-wide 48h${p.inj ? ", INJ: " + p.inj : ""}`;
    })
    .join("\n");
}

export async function callClaude(prompt, { maxTokens = 3500, useSearch = true, model = "claude-sonnet-4-6" } = {}) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Anthropic API error");
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

// Build a "what's changing" block from the trend history for prompts.
// Compares the most recent trend point to ~7 days prior and surfaces deltas.
export function trendBlock(trends) {
  if (!trends || !trends.days || trends.days.length < 2) return "";
  const days = trends.days;
  const latest = days[days.length - 1];
  // find a point ~7 days back, else the oldest we have
  const weekAgo = days.find(d => {
    const gap = (new Date(latest.date) - new Date(d.date)) / 86400000;
    return gap >= 6 && gap <= 9;
  }) || days[0];
  if (weekAgo.date === latest.date) return "";

  const prevByName = Object.fromEntries((weekAgo.teams || []).map(t => [t.name, t]));
  const lines = [];
  for (const t of latest.teams) {
    const p = prevByName[t.name];
    if (!p) continue;
    const changes = [];
    if (t.rosterSize !== p.rosterSize) changes.push(`roster ${p.rosterSize}->${t.rosterSize}`);
    if (t.injuredCount !== p.injuredCount) changes.push(`injuries ${p.injuredCount}->${t.injuredCount}`);
    if (t.picks !== p.picks) changes.push(`picks ${p.picks}->${t.picks}`);
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const a = (p.depth || {})[pos], b = (t.depth || {})[pos];
      if (a != null && b != null && a !== b) changes.push(`${pos} depth ${a}->${b}`);
    }
    if (t.seed && p.seed && t.seed !== p.seed) changes.push(`seed ${p.seed}->${t.seed}`);
    if (changes.length) lines.push(`${t.name}: ${changes.join(", ")}`);
  }
  if (!lines.length) return "";
  return `\n\nWHAT'S CHANGED IN THE LAST ~7 DAYS (trajectory matters more than the static picture; weigh momentum):\n${lines.join("\n")}`;
}
