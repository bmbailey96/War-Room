// Shared library for all Ocho War Room functions.
// Server-side mirror of the frontend's compute layer.

import { getStore } from "@netlify/blobs";

export const USERNAME = "sigourneybeaver";
export const MY_USER_ID = "863128676391383040";
export const FALLBACK_LEAGUE_ID = "1205222463223365632";
export const LEAGUE_NAME_PATTERN = /ocho|teenypetes/i;

export const STARTER_NEEDS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, DL_eligible: 1 };

// Sleeper's `position` field is the NFL position (DE, OLB, CB...), which is
// NOT always a slot that exists in this league. Myles Garrett is "DE" and
// Micah Parsons is "LB"; both actually fill the single DL slot. Every prompt
// used to read the raw position and conclude the DL slot was empty. Always
// resolve a player to the slot they can actually occupy.
export const SLOT_PRIORITY = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
export function slotPos(p) {
  const fps = (p && p.fps) || [];
  for (const s of SLOT_PRIORITY) if (fps.includes(s)) return s;
  return (p && p.pos) || "UNK";
}
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
  // This week's head-to-head. Without it every sit/start call is made blind
  // to who we are actually playing.
  const wk = Math.max(1, Math.min(18, +(nflState.week || 1) || 1));
  const matchups = await j(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${wk}`).catch(() => []);
  return { league, rosters, users, tradedPicks, nflState, trending, txnWeeks, matchups, matchupWeek: wk };
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
      players: players.map(p => ({
        pid: p.pid, name: p.name, pos: p.pos, slot: slotPos(p), fps: p.fps || [],
        team: p.team, age: p.age, inj: p.inj,
        onIR: (r.reserve || []).includes(p.pid),
      })),
      reserve: (r.reserve || []).map(pid => pInfo(playersDB, pid).name),
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
    // Needed to score projections the way THIS league scores them. Standard
    // PPR is wrong here: pass_yd is 0.05 not 0.04, interceptions are -1 not
    // -2, there are long-TD bonuses, and IDP scoring exists at all.
    scoringSettings: league.scoring_settings || null,
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
    week: core.matchupWeek || core.nflState.week || null,
    matchup: buildMatchup(core, teams),
    teams,
  };
}

// Who I play this week, and what they will start.
function buildMatchup(core, teams) {
  const rows = core.matchups || [];
  if (!rows.length) return null;
  const me = teams.find(t => t.isMe);
  if (!me) return null;
  const mine = rows.find(r => r.roster_id === me.rosterId);
  if (!mine || mine.matchup_id == null) return null;
  const oppRow = rows.find(r => r.matchup_id === mine.matchup_id && r.roster_id !== me.rosterId);
  if (!oppRow) return null;
  const opp = teams.find(t => t.rosterId === oppRow.roster_id);
  if (!opp) return null;
  const nameOf = (team, pid) => (team.players.find(p => p.pid === pid) || {}).name || pid;
  return {
    week: core.matchupWeek,
    opponentName: opp.name,
    opponentOwner: (OWNER_HISTORY[opp.ownerId] || {}).display_name || "",
    opponentRosterId: opp.rosterId,
    opponentStarters: (oppRow.starters || []).filter(x => x && x !== "0").map(pid => nameOf(opp, pid)),
    myStarters: (mine.starters || []).filter(x => x && x !== "0").map(pid => nameOf(me, pid)),
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
    const k = p.slot || slotPos(p);
    const tags = [
      p.pos && p.pos !== k ? `listed ${p.pos}` : null,
      p.inj ? `INJ: ${p.inj}` : null,
      p.onIR ? "ON IR (does not count against roster limit)" : null,
    ].filter(Boolean);
    (byPos[k] = byPos[k] || []).push(
      `${p.name} (${p.team || "FA"}, age ${p.age || "?"}${tags.length ? ", " + tags.join(", ") : ""})`
    );
  }
  const lines = Object.entries(byPos).map(([pos, list]) => `${pos}: ${list.join("; ")}`).join("\n");
  return `${lines}\n(Positions above are LEAGUE SLOTS, already resolved from fantasy eligibility. A player listed as DE or LB in the NFL fills the DL slot here.)`;
}

// ---- Evidence blocks: computed first, fed as conclusions, not raw rows ----

export function matchupBlock(snapshot) {
  const m = snapshot.matchup;
  if (!m) return "";
  return `\n\nTHIS WEEK'S HEAD-TO-HEAD (week ${m.week}): I play ${m.opponentName}${m.opponentOwner ? ` (${m.opponentOwner})` : ""}.
Their current starters: ${m.opponentStarters.join(", ") || "not set yet"}.
My current starters: ${m.myStarters.join(", ") || "not set yet"}.
This is a head-to-head week. A high-floor start is worth more when I am favored; a high-variance start is worth more when I am the underdog.`;
}

export function formBlock(statsDigest) {
  const f = statsDigest && statsDigest.form;
  if (!f || !Object.keys(f).length) return "";
  const rows = Object.entries(f)
    .filter(([, v]) => v.recentPassRate != null && v.seasonPassRate != null)
    .map(([team, v]) => ({ team, ...v, delta: Math.round((v.recentPassRate - v.seasonPassRate) * 10) / 10 }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12)
    .map(r => `${r.team}: pass rate ${r.recentPassRate}% last 3 vs ${r.seasonPassRate}% season (${r.delta > 0 ? "+" : ""}${r.delta}), ${r.recentPlays} plays/gm recent`);
  if (!rows.length) return "";
  return `\n\nTEAM FORM SHIFTS (biggest recent changes in how a team plays, last 3 games vs season; a large swing usually means a coordinator change, a QB change, or game script, and it matters more than the season average):\n${rows.join("\n")}`;
}

export function defenseBlock(statsDigest, snapshot) {
  const d = statsDigest && statsDigest.defense;
  if (!d || !Object.keys(d).length) return "";
  const m = snapshot && snapshot.matchup;
  const mineTeams = new Set();
  const me = snapshot && snapshot.teams.find(t => t.isMe);
  if (me) for (const p of me.players) if (p.team) mineTeams.add(p.team);
  const lines = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const ranked = Object.entries(d)
      .map(([team, v]) => ({ team, ppg: v[pos] }))
      .filter(x => x.ppg != null)
      .sort((a, b) => b.ppg - a.ppg);
    if (!ranked.length) continue;
    const soft = ranked.slice(0, 5).map(x => `${x.team} ${x.ppg}`).join(", ");
    const tough = ranked.slice(-5).map(x => `${x.team} ${x.ppg}`).join(", ");
    lines.push(`${pos}: softest ${soft} | toughest ${tough}`);
  }
  if (!lines.length) return "";
  return `\n\nDEFENSE VS POSITION (PPR points allowed per game, ${statsDigest.season}${statsDigest.seasonIsCurrent ? "" : " — LAST SEASON, no current-season games played yet, treat as directional only"}):\n${lines.join("\n")}${m ? `\n(Check my starters' opponents against this before locking a lineup.)` : ""}`;
}

export function usageBlock(statsDigest) {
  const u = (statsDigest && statsDigest.usage) || [];
  if (!u.length) return "";
  const moved = u
    .filter(x => x.recentSnapPct != null && x.priorSnapPct != null)
    .map(x => ({ ...x, delta: x.recentSnapPct - x.priorSnapPct }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 18)
    .map(x => `${x.player} (${x.team || "?"}${x.mine ? ", MINE" : x.rostered ? ", rostered in league" : ", FREE AGENT"}): snaps ${x.recentSnapPct}% last 3 vs ${x.priorSnapPct}% prior (${x.delta > 0 ? "+" : ""}${x.delta})${x.tgtShare != null ? `, target share ${x.tgtShare}%` : ""}${x.touches != null ? `, ${x.touches} touches/gm` : ""}`);
  if (!moved.length) return "";
  const stale = statsDigest.seasonIsCurrent
    ? ""
    : ` These are ${statsDigest.season} numbers and the "last 3 games" window lands on the END of that season, when starters rest and backups play. Treat a spike here as a lead to check, not as evidence.`;
  return `\n\nUSAGE TRENDS (biggest snap-share movers, ${statsDigest.season}).${stale} Rising snap share on a free agent is the strongest pickup signal there is; falling snap share on my player is the strongest drop signal:\n${moved.join("\n")}`;
}

// ---- PROJECTION ENGINE ----------------------------------------------------
// Sleeper ships a Rotowire projection per player per week. That number knows
// nothing about who the defense is, whether the offense has changed shape in
// the last three games, or whether the player's snap share is moving. This
// takes the Rotowire number as the base and adjusts it with the evidence we
// already compute, deterministically, in JS. No model involved, so the number
// cannot be hallucinated and the reasons are always auditable.

// Turn a projected stat line into points using the league's own scoring
// settings. Sleeper's published `pts_ppr` is generic PPR and does not match
// this league: it was reading Myles Garrett as 1.01 instead of 13.91 because
// generic PPR has no IDP scoring, and it was a third to two thirds of a point
// low on every skill player. Scoring the raw stats reproduces the number on
// Sleeper's own matchup screen exactly.
export function scoreProjection(stats, scoringSettings) {
  if (!stats || !scoringSettings) return null;
  let pts = 0;
  for (const [key, value] of Object.entries(stats)) {
    const weight = scoringSettings[key];
    if (typeof weight !== "number" || typeof value !== "number") continue;
    pts += weight * value;
  }
  return Math.round(pts * 100) / 100;
}

// Per-position scoring volatility, as a fraction of the projection. Used for
// the win probability, not for the point estimate.
const POS_SIGMA = { QB: 0.34, RB: 0.55, WR: 0.60, TE: 0.65, K: 0.45, DEF: 0.70, DL: 0.60 };

// How hard each adjustment is allowed to push. These start as damped guesses
// and get replaced by calibrate.mjs once there are real results to fit
// against. The damping exists because the base projection ALREADY knows who
// the opponent is and roughly what Vegas thinks, so applying a full-strength
// matchup adjustment on top double counts. Until the fit runs, treat every
// adjusted number as a lean rather than a truth.
export const DEFAULT_WEIGHTS = {
  defense: 0.5,
  form: 0.8,
  usage: 0.5,
  environment: 0.6,
  wind: 1.0,
  vacancy: 1.0,
  calibrated: false,
};

// Same-team players score together: a quarterback's good day is his receivers'
// good day. Assuming independence understates how wide a team's outcome can
// swing, which makes the win probability overconfident in both directions.
const PASS_GAME = new Set(["QB", "WR", "TE"]);
function correlation(a, b) {
  if (!a.team || !b.team || a.team !== b.team) return 0;
  if (PASS_GAME.has(a.slot) && PASS_GAME.has(b.slot)) return 0.35;
  if (a.slot === "RB" && b.slot === "RB") return -0.25;   // same backfield, they eat each other
  return 0.08;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Normal CDF, Abramowitz-Stegun 7.1.26.
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

export function leagueAvgAllowed(defense) {
  const out = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const vals = Object.values(defense || {}).map(d => d[pos]).filter(v => v != null);
    if (vals.length) out[pos] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}

// One player's adjusted projection plus the reasons, in order of size.
export function projectPlayer(player, opts) {
  const { baseProj, oppTeam, statsDigest } = opts;
  const W = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const game = opts.gameContext || null;
  const vacancy = opts.vacancy || null;
  const slot = player.slot || player.pos;
  const scorePos = ["QB", "RB", "WR", "TE"].includes(slot) ? slot : null;
  const reasons = [];
  let mult = 1;

  // 1. Opponent defense vs this position.
  const defense = (statsDigest || {}).defense || {};
  const avg = leagueAvgAllowed(defense);
  if (scorePos && oppTeam && defense[oppTeam] && defense[oppTeam][scorePos] != null && avg[scorePos]) {
    const ratio = defense[oppTeam][scorePos] / avg[scorePos];
    const m = 1 + W.defense * (ratio - 1);
    mult *= m;
    if (Math.abs(m - 1) >= 0.04) {
      reasons.push({
        size: Math.abs(m - 1),
        short: `${oppTeam} ${m > 1 ? "is soft against" : "is tough on"} ${scorePos}s`,
        pct: Math.round((m - 1) * 100),
        text: `${oppTeam} allows ${defense[oppTeam][scorePos]} to ${scorePos}s per game vs ${Math.round(avg[scorePos] * 10) / 10} league average (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
      });
    }
  }

  // 2. How his offense has been playing lately, not all season.
  const form = ((statsDigest || {}).form || {})[player.team];
  if (form && scorePos) {
    const passDelta = (form.recentPassRate - form.seasonPassRate) / 100;
    const lean = scorePos === "RB" ? -0.8 : (scorePos === "K" ? 0 : 0.8);
    const m = clamp(1 + W.form * lean * passDelta, 0.90, 1.10);
    mult *= m;
    if (Math.abs(m - 1) >= 0.02) {
      reasons.push({
        size: Math.abs(m - 1),
        short: `${player.team} has been ${passDelta > 0 ? "throwing" : "running"} more lately`,
        pct: Math.round((m - 1) * 100),
        text: `${player.team} pass rate ${form.recentPassRate}% last 3 vs ${form.seasonPassRate}% season (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
      });
    }
  }

  // 3. Snap share direction.
  // Only trust snap direction when the data is from the season being played.
  // Out of season the "last 3 games" window sits on week 18, when starters
  // rest, and it was docking healthy stars for a scheduled day off.
  const usage = (statsDigest || {}).seasonIsCurrent
    ? ((statsDigest || {}).usage || []).find(u => normName(u.player) === normName(player.name))
    : null;
  if (usage && usage.recentSnapPct != null && usage.priorSnapPct != null) {
    const snapDelta = (usage.recentSnapPct - usage.priorSnapPct) / 100;
    const m = clamp(1 + W.usage * snapDelta, 0.90, 1.10);
    mult *= m;
    if (Math.abs(m - 1) >= 0.02) {
      reasons.push({
        size: Math.abs(m - 1),
        short: `snaps trending ${snapDelta > 0 ? "up" : "down"}`,
        pct: Math.round((m - 1) * 100),
        text: `snaps ${usage.priorSnapPct}% to ${usage.recentSnapPct}% (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
      });
    }
  }

  // 4. Game environment. Vegas's implied team total is the best public
  // estimate of how many points this offense will actually score, and it
  // moves an offense far more than any single defensive ranking does.
  if (game && game.implied != null && game.avgTeamTotal) {
    const ratio = game.implied / game.avgTeamTotal;
    const m = clamp(1 + W.environment * (ratio - 1), 0.82, 1.18);
    mult *= m;
    if (Math.abs(m - 1) >= 0.02) {
      reasons.push({
        size: Math.abs(m - 1),
        short: `Vegas sees ${player.team} scoring ${game.implied}`,
        pct: Math.round((m - 1) * 100),
        text: `Vegas implies ${game.implied} points for ${player.team} vs a ${game.avgTeamTotal} league average (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
      });
    }
  }

  // 5. Wind. The only weather variable that reliably moves fantasy scoring,
  // and the one a Tuesday projection cannot possibly know about. Passing and
  // kicking suffer; running gains a little because the game script tilts.
  if (game && game.wind != null && !game.indoors && game.wind >= 13) {
    const excess = game.wind - 13;
    const hit = Math.min(0.16, excess * 0.012) * W.wind;
    const affected = ["QB", "WR", "TE", "K"].includes(slot);
    const m = affected ? 1 - hit : 1 + hit * 0.4;
    mult *= m;
    reasons.push({
      size: Math.abs(m - 1),
      short: `${game.wind} mph wind, outdoors`, pct: Math.round((m - 1) * 100),
      text: `${game.wind} mph wind at kickoff, outdoors at ${game.stadium || "the venue"} (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
    });
  }

  // 6. Opportunity vacated by a teammate who is out. Target share does not sit
  // still when the man above someone on the depth chart is inactive.
  if (vacancy && vacancy.multiplier && vacancy.multiplier !== 1) {
    const m = clamp(1 + (vacancy.multiplier - 1) * W.vacancy, 0.9, 1.35);
    mult *= m;
    reasons.push({
      size: Math.abs(m - 1),
      short: `${vacancy.outName} out, work to spread around`,
      pct: Math.round((m - 1) * 100),
      text: `${vacancy.outName} is ${vacancy.status}, vacating ${vacancy.share}% target share (${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}%)`,
    });
  }

  // Nothing above is allowed to run away on its own.
  mult = clamp(mult, 0.70, 1.35);

  // 4. Availability is a gate, not an adjustment.
  const inj = (player.inj || "").toLowerCase();
  let availability = 1;
  if (["out", "ir", "pup", "sus", "doubtful", "dnr", "cov"].some(k => inj.includes(k))) availability = inj.includes("doubtful") ? 0.25 : 0;
  else if (inj.includes("questionable")) availability = 0.92;
  if (availability < 1) {
    reasons.push({
      size: 1 - availability, short: `listed ${player.inj}`, pct: null,
      text: `listed ${player.inj}${availability === 0 ? ", projected zero" : ""}`,
    });
  }

  // With league scoring applied, IDP players project properly, so they count
  // toward the total. There is no defense-vs-position table for defenders, so
  // they simply carry no matchup adjustment.
  const unprojected = !baseProj;
  const adjusted = Math.round(baseProj * mult * availability * 10) / 10;
  reasons.sort((a, b) => b.size - a.size);
  return {
    name: player.name, slot, team: player.team, opp: oppTeam || null,
    base: Math.round(baseProj * 10) / 10,
    adjusted: unprojected ? null : adjusted,
    delta: unprojected ? null : Math.round((adjusted - baseProj) * 10) / 10,
    unprojected,
    unprojectedNote: unprojected ? "no projection published" : null,
    reasons: reasons.slice(0, 3).map(r => r.text),
    chips: reasons.slice(0, 3).map(r => ({ label: r.short || r.text, pct: r.pct ?? null })),
  };
}

export function teamProjection(rows) {
  const scored = rows.filter(r => !r.unprojected && r.adjusted != null);
  const total = scored.reduce((a, r) => a + r.adjusted, 0);
  const sig = scored.map(r => (POS_SIGMA[r.slot] ?? 0.55) * r.adjusted);
  // Full covariance, not a sum of independent variances. Stacked teammates
  // widen the distribution; two backs in one backfield narrow it.
  let variance = 0;
  for (let i = 0; i < scored.length; i++) {
    for (let k = 0; k < scored.length; k++) {
      variance += i === k ? sig[i] * sig[i] : correlation(scored[i], scored[k]) * sig[i] * sig[k];
    }
  }
  variance = Math.max(variance, 1);
  return {
    total: Math.round(total * 10) / 10,
    baseTotal: Math.round(scored.reduce((a, r) => a + r.base, 0) * 10) / 10,
    variance,
    excluded: rows.length - scored.length,
  };
}

export function winProbability(mine, theirs) {
  const sd = Math.sqrt(mine.variance + theirs.variance);
  if (!sd) return 0.5;
  return normCdf((mine.total - theirs.total) / sd);
}

// Points are not the objective. Winning the week is.
//
// When we are a heavy favourite the safest lineup wins more often than the
// highest-scoring one, because variance can only cost us. When we are the
// underdog it inverts: the boom-bust player is worth starting even at fewer
// projected points, because we need the tail. Maximising expected points
// silently gets both cases wrong.
//
// Hill climb from the points-optimal lineup, swapping one player at a time,
// keeping whatever raises the probability of outscoring them.
export function winProbOptimalLineup(pool, lineupSlots, startingLineup, theirs) {
  const FLEXABLE = ["RB", "WR", "TE"];
  const eligible = (player, slot) => slot === "FLEX" ? FLEXABLE.includes(player.slot) : player.slot === slot;
  let current = startingLineup.map(x => ({ ...x }));
  const scoreOf = lineup => {
    const mine = teamProjection(lineup.map(x => x.player).filter(Boolean));
    return { wp: winProbability(mine, theirs), total: mine.total };
  };
  let bestScore = scoreOf(current);

  for (let pass = 0; pass < 8; pass++) {
    let improved = null;
    const used = new Set(current.map(x => x.player && x.player.key));
    for (let i = 0; i < current.length; i++) {
      const slot = current[i].slot;
      for (const cand of pool) {
        if (cand.adjusted == null || used.has(cand.key)) continue;
        if (!eligible(cand, slot)) continue;
        const trial = current.map(x => ({ ...x }));
        trial[i] = { slot, player: cand };
        const sc = scoreOf(trial);
        if (sc.wp > bestScore.wp + 0.0005 && (!improved || sc.wp > improved.sc.wp)) {
          improved = { trial, sc, i, cand, out: current[i].player };
        }
      }
    }
    if (!improved) break;
    current = improved.trial;
    bestScore = improved.sc;
  }
  return { lineup: current, winProb: bestScore.wp, total: bestScore.total };
}

// Who is out, and who inherits their work. Target share does not evaporate
// when a receiver is inactive, it moves to the players behind him.
export function vacancyMap(snapshot, statsDigest) {
  const OUT = ["out", "ir", "pup", "sus", "doubtful", "dnr", "cov"];
  const usage = (statsDigest && statsDigest.usage) || [];
  const shareOf = name => {
    const u = usage.find(x => normName(x.player) === normName(name));
    return u && u.tgtShare != null ? u.tgtShare : null;
  };
  const byTeam = {};
  for (const t of snapshot.teams || []) {
    for (const p of t.players || []) {
      if (!p.team) continue;
      (byTeam[p.team] = byTeam[p.team] || []).push(p);
    }
  }
  const out = {};
  for (const [team, players] of Object.entries(byTeam)) {
    const missing = players.filter(p => {
      const inj = (p.inj || "").toLowerCase();
      return inj && OUT.some(k => inj.includes(k));
    });
    if (!missing.length) continue;
    for (const gone of missing) {
      const share = shareOf(gone.name);
      if (!share || share < 8) continue;   // not enough work to matter
      const heirs = players.filter(p =>
        p.pid !== gone.pid &&
        ["WR", "TE", "RB"].includes(p.slot) &&
        !((p.inj || "").toLowerCase() && OUT.some(k => (p.inj || "").toLowerCase().includes(k)))
      );
      if (!heirs.length) continue;
      // Split the vacated share, weighted toward same-position heirs.
      const weights = heirs.map(h => (h.slot === gone.slot ? 2 : 1));
      const sum = weights.reduce((a, b) => a + b, 0);
      heirs.forEach((h, i) => {
        const got = share * (weights[i] / sum);
        const bump = 1 + Math.min(0.30, got / 100 * 1.6);
        const prev = out[h.pid];
        if (!prev || bump > prev.multiplier) {
          out[h.pid] = {
            multiplier: bump, outName: gone.name,
            status: gone.inj || "out", share: Math.round(share),
          };
        }
      });
    }
  }
  return out;
}

export function projectionBlock(projection) {
  if (!projection || !projection.mine) return "";
  const line = r => r.unprojected
    ? `  ${r.name} (${r.slot}, ${r.team || "?"}): ${r.unprojectedNote}, excluded from the total`
    : `  ${r.name} (${r.slot}, ${r.team || "?"}${r.opp ? " vs " + r.opp : ""}): ${r.base} base -> ${r.adjusted}${r.reasons.length ? ` [${r.reasons.join("; ")}]` : ""}`;
  const bench = (projection.benchSwaps || []).map(s => `  START ${s.in.name} (${s.in.adjusted}) OVER ${s.out.name} (${s.out.adjusted}) at ${s.slot}, worth +${Math.round((s.in.adjusted - s.out.adjusted) * 10) / 10}`);
  return `\n\nWEEK ${projection.week} PROJECTION (computed, not guessed. Base is Sleeper's Rotowire number; adjusted applies opponent defense vs position, the team's last-3-game pass rate vs season, snap-share direction, and injury status. ${projection.dataNote}):
My adjusted total ${projection.mine.total} vs ${projection.opponentName} ${projection.theirs.total}. Sleeper's own numbers, unadjusted, are ${projection.mine.baseTotal} to ${projection.theirs.baseTotal}. Win probability ${Math.round(projection.winProb * 100)}%.
My starters:
${projection.starters.map(line).join("\n")}
${bench.length ? `Lineup upgrades available:\n${bench.join("\n")}` : "No bench player out-projects a current starter."}`;
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
  // A pick's worth depends enormously on where it lands: 1.01 is 64, 1.12 is
  // 8, and the round-average bucket calls both 29. Rookie draft order is
  // reverse standings, so estimate each pick's slot from the projected finish
  // of the team it originally belongs to. Only for the current season's
  // draft; future-year order is genuinely unknowable, so those stay round-avg.
  const numTeams = snapshot.teams.length || 8;
  const estSlot = pk => {
    if (String(pk.season) !== String(snapshot.season)) return null;
    const t = snapshot.teams.find(x => x.name === pk.original);
    return t && t.projectedSeed ? (numTeams + 1 - t.projectedSeed) : null;
  };
  const addPicks = (label, picks) => {
    const vals = (picks || []).map(pk => {
      const slot = pk.slot != null ? pk.slot : estSlot(pk);
      const v = pickVal(pk.season, pk.round, slot);
      if (v == null) return null;
      const from = pk.original && pk.original !== label ? ` from ${pk.original}` : "";
      return slot != null
        ? `${pk.season} ${pk.round}.${String(slot).padStart(2, "0")} (est${from}) = ${v}`
        : `${pk.season} R${pk.round}${from} = ${v}`;
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
// Standalone pick lookup so the trade ledger and grader can price picks
// without duplicating valuesBlock's internals.
export function pickValueOf(playerValues, season, round, slot) {
  const picks = playerValues && playerValues.picks;
  if (!picks) return null;
  if (slot != null) {
    const exact = picks[`${season} ${round}.${String(slot).padStart(2, "0")}`];
    if (exact) return exact.v;
  }
  const rb = picks[`${season} ${round}`];
  return rb ? rb.v : null;
}

// VALUE TREND. Dynasty is about direction, not the still photo: the game is
// selling the guy whose price just spiked and buying the guy who cratered on
// noise. Returns the move for one player over roughly the requested window.
export function valueTrend(history, name, days = 21) {
  if (!history || !Array.isArray(history.days) || history.days.length < 2) return null;
  const key = normName(name);
  const arr = history.days;
  const latest = arr[arr.length - 1];
  const now = latest.v ? latest.v[key] : undefined;
  if (now == null) return null;
  const target = new Date(latest.date).getTime() - days * 86400000;
  let past = null;
  for (const d of arr) {
    if (d === latest) break;
    if (!d.v || d.v[key] == null) continue;
    if (new Date(d.date).getTime() <= target) past = d;
  }
  if (!past) past = arr.find(d => d !== latest && d.v && d.v[key] != null) || null;
  if (!past) return null;
  const then = past.v[key];
  return {
    now, then, delta: now - then,
    days: Math.max(1, Math.round((new Date(latest.date) - new Date(past.date)) / 86400000)),
  };
}

// The movers block every prompt gets: who is rising, who is falling, and on
// whose roster. This is what turns "Player X is worth 40" into "Player X is
// worth 40 and was 55 three weeks ago, so his owner may be souring on him."
export function valueTrendBlock(snapshot, history) {
  if (!history || !Array.isArray(history.days) || history.days.length < 3) return "";
  const rows = [];
  for (const t of snapshot.teams) {
    for (const p of t.players) {
      const tr = valueTrend(history, p.name);
      if (!tr || Math.abs(tr.delta) < 4) continue;
      rows.push({ ...tr, name: p.name, team: t.name, isMe: !!t.isMe });
    }
  }
  if (!rows.length) return "";
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const fmt = r => `${r.name} (${r.team}${r.isMe ? ", MINE" : ""}) ${r.then} -> ${r.now} (${r.delta > 0 ? "+" : ""}${r.delta} over ${r.days}d)`;
  const up = rows.filter(r => r.delta > 0).slice(0, 10).map(fmt);
  const down = rows.filter(r => r.delta < 0).slice(0, 10).map(fmt);
  let out = `\n\nMARKET VALUE MOVEMENT (how consensus value has actually changed; this is the sell-high / buy-low engine, weigh it heavily):`;
  if (up.length) out += `\nRISING:\n${up.join("\n")}`;
  if (down.length) out += `\nFALLING:\n${down.join("\n")}`;
  out += `\nHOW TO USE: a player of mine who is rising fast is a SELL-HIGH candidate; his price may not hold. A rival's player who is falling fast is a BUY-LOW candidate, especially if the fall is sentiment rather than a real role change, and especially if that owner is inattentive. Say explicitly when a recommendation is driven by movement rather than by the static value.`;
  return out;
}
// TRADE LEDGER ENTRY. Snapshots what each side received and what it was worth
// THE DAY THE TRADE HAPPENED. The grader later re-prices the same assets to
// see who actually won. Trades are the centerpiece of this app and were the
// one thing it never held itself accountable for.
export function tradeLedgerEntry(t, snapshot, playersDB, playerValues) {
  if (t.type !== "trade") return null;
  const sides = (t.roster_ids || []).map(rid => {
    const team = snapshot.teams.find(x => x.rosterId === rid);
    const got = Object.entries(t.adds || {})
      .filter(([, r]) => r === rid)
      .map(([pid]) => {
        const name = pInfo(playersDB, pid).name;
        const v = (playerValues?.players?.[normName(name)] || {}).v;
        return { name, value: v ?? null };
      });
    const picks = (t.draft_picks || [])
      .filter(dp => dp.owner_id === rid)
      .map(dp => ({
        season: dp.season, round: dp.round,
        value: pickValueOf(playerValues, dp.season, dp.round, null),
      }));
    return { team: team ? team.name : `roster ${rid}`, isMe: team ? !!team.isMe : false, got, picks };
  });
  return { id: t.transaction_id, at: t.created || Date.now(), sides };
}

// The graded-trades block for prompts: the model's own trade record, measured.
export function tradeGradeBlock(grades) {
  if (!grades || !Array.isArray(grades.trades) || !grades.trades.length) return "";
  const mine = grades.trades.filter(g => g.sides.some(s => s.isMe));
  if (!mine.length) return "";
  const lines = mine.slice(-6).map(g => {
    const me = g.sides.find(s => s.isMe);
    const them = g.sides.find(s => !s.isMe);
    if (!me || !them) return null;
    const verdict = me.delta > them.delta + 5 ? "I WON" : them.delta > me.delta + 5 ? "I LOST" : "roughly even";
    return `${new Date(g.at).toISOString().slice(0, 10)} vs ${them.team}: what I got moved ${me.delta > 0 ? "+" : ""}${me.delta}, what they got moved ${them.delta > 0 ? "+" : ""}${them.delta} in the ${g.daysElapsed} days since. Hindsight: ${verdict}.`;
  }).filter(Boolean);
  if (!lines.length) return "";
  const wins = mine.filter(g => {
    const me = g.sides.find(s => s.isMe), them = g.sides.find(s => !s.isMe);
    return me && them && me.delta > them.delta + 5;
  }).length;
  return `\n\nMY COMPLETED TRADES, GRADED IN HINDSIGHT (${wins} clear wins out of ${mine.length} graded, measured by how the acquired assets' market values actually moved after the deal):\n${lines.join("\n")}\nLet this calibrate you. If my trades have been losing, be far more conservative about what you tell me to send.`;
}
// UPCOMING ROOKIE DRAFT CLASS. Trade prompts otherwise treat picks as
// abstract value ("2027 R2 = 2") with no idea who those picks become, so
// they can't reason about drafting a hole shut instead of trading for it.
export function draftClassBlock(draftBoard, snapshot) {
  if (!draftBoard || !Array.isArray(draftBoard.board) || !draftBoard.board.length) return "";
  const status = snapshot.leagueStatus;
  if (status !== "pre_draft" && status !== "drafting") return "";
  const me = snapshot.teams.find(t => t.isMe);
  const myPicks = me ? (me.picks || []).filter(p => String(p.season) === String(snapshot.season)) : [];
  const top = draftBoard.board.slice(0, 20)
    .map((p, i) => `${i + 1}. ${p.name} ${p.pos}${p.age ? " age " + p.age : " (rookie)"} val ${p.value}`)
    .join("\n");
  const byPos = {};
  for (const p of draftBoard.board.slice(0, 40)) byPos[p.pos] = (byPos[p.pos] || 0) + 1;
  const posLine = Object.entries(byPos).map(([k, v]) => `${k} ${v}`).join(", ");
  return `\n\nUPCOMING ROOKIE DRAFT (${snapshot.season} class, league status ${status}). My picks convert into these SPECIFIC players, so do not treat picks as abstract value.
MY PICKS IN THIS DRAFT: ${myPicks.length ? myPicks.map(p => `${p.season} R${p.round}${me && p.original !== me.name ? ` (from ${p.original})` : ""}`).join(", ") : "none"}.
BEST AVAILABLE IN THE CLASS (market value 0-100):
${top}
Top-40 class depth by position: ${posLine}.
HOW TO USE THIS: before recommending I trade FOR a player, check whether this draft fills that need more cheaply with picks I already hold, and say so if it does. Before recommending I trade AWAY a pick, name the specific tier of player I would be giving up rather than just its point value. Trade for positions this class is thin at; draft the ones it is deep at. Kickers and defenses are never in a rookie draft, so holes there can only be fixed on waivers or by trade.`;
}