// Shared library for all Ocho War Room functions.
// Server-side mirror of the frontend's compute layer.

import { getStore } from "@netlify/blobs";

export const USERNAME = "sigourneybeaver";
export const MY_USER_ID = "863128676391383040";
export const FALLBACK_LEAGUE_ID = "1205222463223365632";
export const LEAGUE_NAME_PATTERN = /ocho|teenypetes/i;

export const STARTER_NEEDS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, DL_eligible: 1 };
// Name normalizer used EVERYWHERE names are matched across data sources.
// Strips generational suffixes (II, III, Jr, Sr...) because DynastyProcess
// writes "Patrick Mahomes II" while Sleeper stores "Patrick Mahomes", and
// that mismatch was leaking rostered players onto the draft board and
// dropping market values for suffix players app-wide.
export function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
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
  // Include CURRENT-season picks while that rookie draft hasn't happened yet
  // (pre_draft/drafting). Once it completes, those picks stop being assets
  // and the window slides to the next two seasons, which is what the old
  // code assumed year-round and why 2026 picks vanished after rollover.
  const draftPending = league.status === "pre_draft" || league.status === "drafting";
  const nextSeasons = [
    ...(draftPending ? [String(currentSeason)] : []),
    String(currentSeason + 1),
    String(currentSeason + 2),
  ];
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
    // Preseason (0-0) makes winPct 0 for everyone, which used to label the
    // entire league as rebuilding/retooling and poisoned every AI prompt.
    // Fall back to last season's win% until games are actually played.
    const played = wins + losses;
    const histPct = (OWNER_HISTORY[r.owner_id] || {}).win_pct;
    const stancePct = played > 0 ? winPct : (histPct != null ? histPct : 0.5);
    let stance;
    if (stancePct >= 0.55 && (avgAge || 27) >= 27) stance = "Win-Now";
    else if (stancePct >= 0.55) stance = "Ascending";
    else if (stancePct < 0.45 && (avgAge || 27) < 26.5) stance = "Rebuilding";
    else if (stancePct < 0.45) stance = "Retool Needed";
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

  // Preseason everything is 0-0, so ranking by record collapses to roster
  // order. Rank by last season's win% until real games exist.
  const anyGames = teams.some(t => (t.wins + t.losses) > 0);
  const histPctOf = t => ((OWNER_HISTORY[t.ownerId] || {}).win_pct ?? 0);
  const ranked = [...teams].sort((a, b) =>
    anyGames
      ? ((b.wins - a.wins) || (b.pointsFor - a.pointsFor) || (b.winPct - a.winPct))
      : (histPctOf(b) - histPctOf(a))
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
    preseason: !anyGames,
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

// ONE-LINE ACTIVITY VERDICT. Grades a single detected transaction from the
// transacting owner's perspective, anchored to market values and recent
// headlines so it doesn't grade off stale name recognition. Returns null on
// any failure so a verdict miss never blocks the changelog entry.
export async function gradeTransaction(t, snapshot, playersDB, playerValues, newsDigest) {
  const norm = normName;
  const valueOf = name => {
    const m = playerValues?.players?.[norm(name)];
    return m ? m.v : null;
  };
  const teamOf = rid => snapshot.teams.find(x => x.rosterId === rid);
  const pName = pid => pInfo(playersDB, pid).name;

  const namesInvolved = [
    ...Object.keys(t.adds || {}).map(pName),
    ...Object.keys(t.drops || {}).map(pName),
  ];
  const headlines = (newsDigest?.items || [])
    .filter(i => namesInvolved.some(n => n && n.length >= 5 && (i.title || "").toLowerCase().includes(n.toLowerCase())))
    .slice(0, 4)
    .map(i => `- ${i.title}`)
    .join("\n");
  const newsLine = headlines ? `\nRECENT HEADLINES ON THESE PLAYERS (trust these over your general knowledge; they are current):\n${headlines}` : "";

  const valTag = name => {
    const v = valueOf(name);
    return v != null ? `${name} (market value ${v}/100)` : name;
  };

  const RULES = `Rules: Ground your judgment in the market values given (0-100 dynasty consensus) and the headlines, NOT your general memory of these players; your training knowledge of roles and situations is stale. A player with market value under 15 is a fringe asset regardless of name recognition. If a move looks odd but you have no headline or value evidence explaining it, say it looks odd at a glance but the manager may know something recent, and keep it to one sentence; do not lecture. Never say you need more information; give your best read from what is here.`;

  if (t.type === "trade") {
    const sides = (t.roster_ids || []).map(rid => {
      const team = teamOf(rid);
      const gotNames = Object.entries(t.adds || {}).filter(([, r]) => r === rid).map(([pid]) => pName(pid));
      const picks = (t.draft_picks || []).filter(dp => dp.owner_id === rid).map(dp => `${dp.season} R${dp.round}`);
      const h = OWNER_HISTORY[team?.ownerId] || {};
      return `${team?.name || rid} (${h.display_name || "?"}): received ${[...gotNames.map(valTag), ...picks].join(", ") || "nothing listed"}. Stance: ${team?.stance || "?"}. Holes: ${(team?.holes || []).join("; ") || "none"}. Surplus: ${(team?.surplus || []).join("; ") || "none"}.`;
    }).join("\n");
    const prompt = `Grade this fantasy football trade in 2 sentences max, plain language. Say who won it and why, weighing the market values and roster fit. If it is close to even, say that plainly.

${sides}${newsLine}

${RULES}

Return ONLY the verdict, 2 sentences max.`;
    try {
      return (await callClaude(prompt, { model: "claude-haiku-4-5", useSearch: false, maxTokens: 200 })).trim();
    } catch (e) { return null; }
  }

  const rid = Object.values(t.adds || {})[0] ?? Object.values(t.drops || {})[0];
  const team = teamOf(rid);
  if (!team) return null;
  const added = Object.keys(t.adds || {}).map(pName);
  const dropped = Object.keys(t.drops || {}).map(pName);
  const h = OWNER_HISTORY[team.ownerId] || {};
  const dropOnly = dropped.length && !added.length;
  const prompt = `Grade this fantasy football roster move in 1-2 sentences, plain language, from ${team.name}'s (${h.display_name || "?"}) perspective. Stance: ${team.stance}. Holes: ${(team.holes || []).join("; ") || "none"}. Surplus: ${(team.surplus || []).join("; ") || "none"}.
${added.length ? `Added: ${added.map(valTag).join(", ")}` : ""}${dropped.length ? `
Dropped: ${dropped.map(valTag).join(", ")}` : ""}${newsLine}
${dropOnly ? "\nNote: this is a standalone drop; on Sleeper a corresponding pickup often follows as a separate transaction, so judge the drop on its own merits (was this player worth a roster spot?) rather than assuming it is the whole move." : ""}

${RULES}

Return ONLY the verdict, 1-2 sentences.`;
  try {
    return (await callClaude(prompt, { model: "claude-haiku-4-5", useSearch: false, maxTokens: 150 })).trim();
  } catch (e) { return null; }
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

export function trendBlock(trends) {
  if (!trends || !trends.days || trends.days.length < 2) return "";
  const days = trends.days;
  const latest = days[days.length - 1];
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

export function valuesBlock(snapshot, playerValues) {
  if (!playerValues || !playerValues.players) return "";
  const norm = normName;
  const me = snapshot.teams.find(t => t.isMe);
  const lines = [];
  const seen = new Set();
  const add = (label, players) => {
    const vals = players.map(p => {
      const m = playerValues.players[norm(p.name)];
      return m ? `${p.name} ${m.v}` : null;
    }).filter(Boolean);
    if (vals.length) lines.push(`${label}: ${vals.join(", ")}`);
  };
  const pickVal = (season, round, slot) => {
    if (!playerValues.picks) return null;
    if (slot != null) {
      const exact = playerValues.picks[`${season} ${round}.${String(slot).padStart(2, "0")}`];
      if (exact) return exact.v;
    }
    const rb = playerValues.picks[`${season} ${round}`];
    return rb ? rb.v : null;
  };
  const addPicks = (label, picks) => {
    const vals = (picks || []).map(pk => {
      const v = pickVal(pk.season, pk.round, pk.slot);
      return v != null ? `${pk.season} R${pk.round} ${v}` : null;
    }).filter(Boolean);
    if (vals.length) lines.push(`${label} pick values: ${vals.join(", ")}`);
  };

  if (me) { add("MY roster market values (0-100)", me.players); addPicks("MY", me.picks); }
  for (const t of snapshot.teams) {
    if (t.isMe) continue;
    add(`${t.name} values`, t.players.filter(p => {
      const k = norm(p.name); if (seen.has(k)) return false; seen.add(k); return true;
    }));
    addPicks(t.name, t.picks);
  }
  if (!lines.length) return "";
  return `\n\nMARKET VALUE ANCHOR (DynastyProcess consensus, ${playerValues.scrapeDate || "recent"}, players AND picks on one 0-100 scale so they trade directly against each other; use these as your baseline "value" numbers in the JSON, then adjust for MY roster fit and live news):\n${lines.join("\n")}`;
}

export function leagueMemoryBlock(leagueMemory) {
  if (!leagueMemory || !leagueMemory.tendencies) return "";
  const lines = [];
  for (const t of Object.values(leagueMemory.tendencies)) {
    const partners = (t.favoritePartners || []).map(p => `${p.name} (${p.n}x)`).join(", ");
    lines.push(`${t.name}: ${t.completedTrades} completed trades over ${(leagueMemory.seasons||[]).length} seasons, ${t.churnLevel} waiver churn, ${t.timing}${partners ? `; trades most with ${partners}` : ""}`);
  }
  if (!lines.length) return "";
  return `\n\nLEAGUE MEMORY (how each owner has actually behaved over ${(leagueMemory.seasons||[]).length} seasons; use this to judge who will really complete a deal and who just talks):\n${lines.join("\n")}`;
}

export function leagueStateBlock(snapshot, playerValues) {
  const norm = normName;
  const pv = (playerValues && playerValues.players) || {};
  const val = name => (pv[norm(name)] || {}).v || 0;
  const me = snapshot.teams.find(t => t.isMe);
  if (!me) return "";

  const POS = ["QB", "RB", "WR", "TE"];
  const lines = [];
  for (const pos of POS) {
    const totals = snapshot.teams.map(t => ({
      name: t.name, isMe: t.isMe,
      total: t.players.filter(p => p.pos === pos).reduce((s, p) => s + val(p.name), 0),
    })).sort((a, b) => b.total - a.total);
    const myRank = totals.findIndex(x => x.isMe) + 1;
    const top3 = totals.slice(0, 3).reduce((s, x) => s + x.total, 0);
    const all = totals.reduce((s, x) => s + x.total, 0) || 1;
    const concentration = Math.round(top3 / all * 100);
    lines.push(`${pos}: I rank ${myRank}/${snapshot.teams.length} in market value (${concentration}% of leaguewide ${pos} value sits with the top 3 teams${concentration >= 55 ? ", so this position is SCARCE and worth hoarding" : ""}).`);
  }

  const ages = snapshot.teams.map(t => t.avgAge).filter(Boolean);
  const avgLeagueAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length) : 27;
  const window = me.winPct >= 0.55
    ? (me.avgAge >= avgLeagueAge ? "win-now: strong roster but aging, push chips in this year" : "prime: strong and young, build the dynasty")
    : (me.avgAge < avgLeagueAge ? "ascending/rebuild: young and not yet winning, accumulate" : "retool: older and losing, sell aging pieces before they crater");

  return `\n\nLEAGUE STATE (shared picture, computed from market values so every recommendation is consistent):\nMy contention window: ${window}.\nPositional scarcity and my standing:\n${lines.join("\n")}\nUse this as the strategic frame: chase scarce positions, sell from positions where I am already deep, and match every move to my contention window.`;
}
// TRADE VALIDATOR. The analyzer sometimes proposes acquiring players you
// already own, or players the named partner does not roster (usually pulled
// forward from its own analysis-history memory). Every roster is in the
// snapshot, so this is checkable. Invalid cards are dropped before storage.
export function validateTrades(text, snapshot) {
  const me = snapshot.teams.find(t => t.isMe);
  if (!me || !text) return { text, removed: [] };
  const myNames = new Set(me.players.map(p => normName(p.name)));
  const rosterByTeam = {};
  for (const t of snapshot.teams) rosterByTeam[t.name] = new Set(t.players.map(p => normName(p.name)));

  const m = text.match(/<TRADES_JSON>([\s\S]*?)<\/TRADES_JSON>/i);
  if (!m) return { text, removed: [] };
  let cards;
  try {
    let clean = m[1].replace(/```json|```/gi, "").trim();
    const a = clean.indexOf("["), b = clean.lastIndexOf("]");
    if (a !== -1 && b !== -1) clean = clean.slice(a, b + 1);
    clean = clean.replace(/,\s*([\]}])/g, "$1");
    cards = JSON.parse(clean);
  } catch (e) { return { text, removed: [] }; }
  if (!Array.isArray(cards)) return { text, removed: [] };

  const removed = [];
  const kept = cards.filter(c => {
    for (const a of (c.iGet || [])) {
      if (a.type === "pick") continue;
      const key = normName(a.name);
      if (myNames.has(key)) { removed.push(`${a.name} is already on my roster`); return false; }
      const partnerSet = rosterByTeam[c.partner];
      if (partnerSet && !partnerSet.has(key)) { removed.push(`${a.name} is not on ${c.partner}'s roster`); return false; }
    }
    for (const a of (c.iSend || [])) {
      if (a.type === "pick") continue;
      if (!myNames.has(normName(a.name))) { removed.push(`${a.name} is not on my roster to send`); return false; }
    }
    return true;
  });

  let out = text.replace(/<TRADES_JSON>[\s\S]*?<\/TRADES_JSON>/i,
    `<TRADES_JSON>${JSON.stringify(kept)}</TRADES_JSON>`);
  if (removed.length) {
    out = `**${removed.length} proposed trade${removed.length > 1 ? "s were" : " was"} automatically removed as impossible:** ${removed.join("; ")}. The written analysis below may still reference them.\n\n---\n\n` + out;
  }
  return { text: out, removed };
}