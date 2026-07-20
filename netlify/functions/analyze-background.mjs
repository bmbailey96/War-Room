// Background function (name ends in -background, 15 minute limit).
// Does the actual AI research with live web search and stores results
// in blobs so the frontend loads them instantly.

import {
  blobs, OWNER_HISTORY, leagueContextBlock, myRosterBlock,
  callClaude, pInfo, getPlayersTrim,
} from "./lib/ocho.mjs";

function buildTrendingBlock(trendingRaw, rostersRaw, playersDB) {
  const rostered = new Set();
  for (const r of rostersRaw || []) for (const pid of r.players || []) rostered.add(pid);
  return (trendingRaw || [])
    .filter(t => !rostered.has(t.player_id))
    .slice(0, 25)
    .map(t => {
      const p = pInfo(playersDB, t.player_id);
      return `${p.name} (${p.pos || "?"}, ${p.team || "FA"}) - ${t.count} adds league-wide 48h${p.inj ? ", INJ: " + p.inj : ""}`;
    })
    .join("\n");
}

function digestBlocks(newsDigest, statsDigest, snapshot) {
  let newsBlock = "";
  if (newsDigest && newsDigest.items && newsDigest.items.length) {
    const relevant = newsDigest.items.filter(i => i.score >= 20).slice(0, 30);
    if (relevant.length) {
      newsBlock = "HARVESTED HEADLINES (last 72h, from PFT, Yahoo, CBS, Rotowire, ESPN, Reddit, auto-scored for relevance to this league's rosters):\n" +
        relevant.map(i => {
          const tags = [
            ...(i.matched?.mine || []).map(n => "MY PLAYER: " + n),
            ...(i.matched?.league || []).slice(0, 2),
            ...(i.matched?.teams || []).slice(0, 2),
          ].join(", ");
          return `- [${i.source}] ${i.title}${tags ? ` (${tags})` : ""}`;
        }).join("\n");
    }
  }
  let statsBlock = "";
  if (statsDigest && statsDigest.tendencies) {
    const seasonNote = statsDigest.seasonIsCurrent
      ? `${statsDigest.season} season data`
      : `${statsDigest.season} season data (most recent completed; current season not underway in nflverse yet)`;
    const relevantTeams = new Set();
    if (snapshot) for (const t of snapshot.teams) for (const p of t.players) if (p.team) relevantTeams.add(p.team);
    const lines = Object.entries(statsDigest.tendencies)
      .filter(([team]) => relevantTeams.size === 0 || relevantTeams.has(team))
      .map(([team, s]) => `${team}: pass rate ${s.passRate}%, ${s.playsPerGame} plays/gm, pass EPA ${s.passEpa}, rush EPA ${s.rushEpa}, sacks allowed ${s.sacksAllowed}`);
    statsBlock = `TEAM SCHEME DATA (nflverse, ${seasonNote}):\n` + lines.join("\n");
    if (statsDigest.injuries && statsDigest.injuries.length) {
      statsBlock += "\n\nOFFICIAL INJURY REPORT ENTRIES (league-rostered players):\n" +
        statsDigest.injuries.map(i => `- ${i.player} (${i.team}) ${i.status || "listed"}: ${i.injury}${i.mine ? " <-- MY PLAYER" : ""}`).join("\n");
    }
    if (statsDigest.usage && statsDigest.usage.length) {
      statsBlock += "\n\nMY PLAYERS' SNAP TRENDS (recent 3 wks vs prior 3):\n" +
        statsDigest.usage.map(u => `- ${u.player}: ${u.priorSnapPct ?? "?"}% -> ${u.recentSnapPct ?? "?"}%`).join("\n");
    }
  }
  return { newsBlock, statsBlock };
}

function prompts(snapshot, trendingText, newsDigest, statsDigest) {
  const ctx = leagueContextBlock(snapshot);
  const mine = myRosterBlock(snapshot);
  const { newsBlock, statsBlock } = digestBlocks(newsDigest, statsDigest, snapshot);
  const groundData = [newsBlock, statsBlock].filter(Boolean).join("\n\n");
  const groundNote = groundData
    ? `\n\nGROUND DATA COLLECTED BY MY SYSTEM (verify anything surprising with your own web search; recency beats this data):\n${groundData}`
    : "";
  const wk = snapshot.nflState || {};
  const inSeason = wk.season_type === "regular" && wk.week >= 1;
  return {
    trades: `You are a dynasty fantasy football trade analyst for my league. Use web search to check CURRENT dynasty trade values, recent NFL news, injuries, and coaching or depth chart changes for players named below.

${ctx}

MY FULL ROSTER (The Nightmen):
${mine}

TASK: Recommend my 3 to 5 best realistic trades right now. For each: (1) exact partner and why their stance, holes, tendencies, and engagement level make them likely to deal; (2) a specific package including future picks where sensible; (3) valuations grounded in your current web research, say what you found; (4) honest risk. Prioritize my flagged holes and monetize my flagged surplus. Weight owner behavior: fair deals with active traders beat perfect deals with owners who never trade. No filler.${groundNote}`,
    pickups: `You are a dynasty fantasy football waiver analyst. Use web search for CURRENT news on the players below: role changes, injuries ahead of them, scheme fits, camp reports.

${ctx}

MY FULL ROSTER (The Nightmen):
${mine}

PLAYERS TRENDING LEAGUE-WIDE ON SLEEPER (48h), UNROSTERED IN MY LEAGUE:
${trendingText || "(no trending players currently available)"}

TASK: My 3 to 6 best pickups right now, and who to drop for each. Consider my flagged holes first, dynasty value over redraft (age, opportunity trajectory), and what your search found about each player's current situation. Rolling waiver priority league, no FAAB, so say when someone is worth burning priority on. Be honest if the pool is weak. No filler.${groundNote}`,
    sitstart: inSeason
      ? `You are a fantasy football lineup analyst. It is ${wk.season} NFL regular season, week ${wk.week}. Use web search extensively: current injuries and practice reports, offensive coordinator and scheme tendencies for each player's NFL team (run/pass lean, pace, new-OC risk), depth chart changes, breaking news.

LINEUP SLOTS: ${JSON.stringify(snapshot.rosterPositions)}

MY FULL ROSTER (The Nightmen):
${mine}

Set my optimal lineup for the coming week. For every call, cite the specific current information from your search that drove it, with a confidence level. No filler.${groundNote}`
      : `You are a fantasy football roster analyst. It is the NFL offseason. Use web search extensively for current camp reports, depth chart battles, coaching and coordinator changes affecting my players.

MY FULL ROSTER (The Nightmen):
${mine}

Run a roster stress test: locked-in starters by position when the season opens, the closest lineup battles, and which player situations to monitor based on current news. Cite what your search found. No filler.${groundNote}`,
  };
}

async function notify(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { title, "content-type": "text/plain" },
      body: message.slice(0, 500),
    });
  } catch (e) { /* best effort */ }
}

export default async (req) => {
  const store = blobs();
  let tasks = ["trades", "pickups"];
  try {
    const body = await req.json();
    if (Array.isArray(body.tasks) && body.tasks.length) tasks = body.tasks;
  } catch (e) { /* default tasks */ }

  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "no snapshot yet, run snapshot function first" }), { status: 409 });
  }
  const playersDB = await getPlayersTrim();
  const trendingRaw = await store.get("trending_raw", { type: "json" });
  const rostersRaw = await store.get("rosters_raw", { type: "json" });
  const newsDigest = await store.get("news_digest", { type: "json" });
  const statsDigest = await store.get("stats_digest", { type: "json" });
  const trendingText = buildTrendingBlock(trendingRaw, rostersRaw, playersDB);
  const P = prompts(snapshot, trendingText, newsDigest, statsDigest);

  const results = {};
  for (const task of tasks) {
    if (!P[task]) continue;
    // Memory loop: show the model its own recent calls so it maintains
    // continuity, updates stale advice, and owns being wrong.
    const history = (await store.get(`analysis_history_${task}`, { type: "json" })) || [];
    let memoryBlock = "";
    if (history.length) {
      memoryBlock = "\n\nYOUR OWN PRIOR RECOMMENDATIONS (most recent first). Review them against today's data: explicitly note which prior calls still stand, which are now stale or wrong and why, and do not silently repeat old advice as if new:\n" +
        history.slice(-3).reverse().map(h =>
          `--- ${new Date(h.at).toISOString().slice(0, 10)} ---\n${h.text.slice(0, 1500)}`
        ).join("\n");
    }
    await store.setJSON(`analysis_${task}`, { status: "running", startedAt: Date.now() });
    try {
      const text = await callClaude(P[task] + memoryBlock);
      await store.setJSON(`analysis_${task}`, { status: "done", at: Date.now(), text });
      history.push({ at: Date.now(), text });
      while (history.length > 5) history.shift();
      await store.setJSON(`analysis_history_${task}`, history);
      results[task] = "done";
    } catch (err) {
      await store.setJSON(`analysis_${task}`, { status: "error", at: Date.now(), error: err.message });
      results[task] = "error: " + err.message;
    }
  }
  await store.delete("dirty").catch(() => {});
  const done = Object.entries(results).filter(([, v]) => v === "done").map(([k]) => k);
  if (done.length) await notify("War Room analysis ready", `Fresh ${done.join(" + ")} analysis is waiting in The Ocho War Room.`);

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "content-type": "application/json" },
  });
};
