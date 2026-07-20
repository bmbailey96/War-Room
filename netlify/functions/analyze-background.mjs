// Background function (name ends in -background, 15 minute limit).
// Does the actual AI research with live web search and stores results
// in blobs so the frontend loads them instantly.

import {
  blobs, OWNER_HISTORY, leagueContextBlock, myRosterBlock,
  callClaude, pInfo, getPlayersTrim, trendBlock, valuesBlock,
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

// Extract player names the analysis actually recommended, by matching every
// known player name against the text. Used to log calls for grading.
function playersFromText(text, playersDB) {
  const t = text.toLowerCase();
  const ids = new Set();
  for (const [pid, p] of Object.entries(playersDB)) {
    const name = (p.n || "").toLowerCase();
    if (name.length >= 6 && t.includes(name)) ids.add(pid);
  }
  return [...ids].slice(0, 12);
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

function prompts(snapshot, trendingText, newsDigest, statsDigest, trends, playerValues) {
  const ctx = leagueContextBlock(snapshot);
  const mine = myRosterBlock(snapshot);
  const { newsBlock, statsBlock } = digestBlocks(newsDigest, statsDigest, snapshot);
  const groundData = [newsBlock, statsBlock].filter(Boolean).join("\n\n");
  const trendData = trendBlock(trends);
  const valueData = valuesBlock(snapshot, playerValues);
  const groundNote = (groundData
    ? `\n\nGROUND DATA COLLECTED BY MY SYSTEM (verify anything surprising with your own web search; recency beats this data):\n${groundData}`
    : "") + trendData + valueData;
  const wk = snapshot.nflState || {};
  const inSeason = wk.season_type === "regular" && wk.week >= 1;
  const MOVE = `\n\nTWO REQUIREMENTS FOR EVERY RECOMMENDATION ABOVE: (a) tag each with a confidence level (High/Medium/Low); (b) add a one-line "Case against:" naming the strongest reason it could be wrong. Never present a call as risk-free.\n\nMANDATORY FINAL SECTION: end with a heading exactly "## THE MOVE" followed by ONE single directive: the one specific action I should take right now, imperative voice, 1-3 sentences, chosen to serve winning now AND in the future. Not a menu. Not "consider". One move. If the genuinely right move is to do nothing, say "Hold" and why in one sentence.`;
  return {
    trades: `You are a dynasty fantasy football trade analyst for my league. Use web search to check CURRENT dynasty trade values, recent NFL news, injuries, and coaching or depth chart changes for players named below.

${ctx}

MY FULL ROSTER (The Nightmen):
${mine}

TASK: Recommend my 3 to 5 best realistic trades right now. For each: (1) exact partner and why their stance, holes, tendencies, and engagement level make them likely to deal; (2) a specific package including future picks where sensible; (3) valuations grounded in your current web research, say what you found; (4) honest risk. Prioritize my flagged holes and monetize my flagged surplus. Weight owner behavior: fair deals with active traders beat perfect deals with owners who never trade. No filler.${groundNote}

CRITICAL OUTPUT FORMAT: Before any prose, emit a machine-readable block wrapped in <TRADES_JSON> and </TRADES_JSON> tags containing a JSON array, one object per recommended trade, in this exact shape:
[{
  "partner": "team name",
  "iSend": [{"name":"Player or Pick","type":"player"|"pick","pos":"RB"|"WR"|...|null,"value":0-100}],
  "iGet": [{"name":"Player or Pick","type":"player"|"pick","pos":"RB"|...|null,"value":0-100}],
  "verdict": "one line: is this worth it for me and why",
  "confidence": "High"|"Medium"|"Low",
  "leanScore": -100 to 100 (negative = favors partner, 0 = even, positive = favors me),
  "caseAgainst": "one line"
}]
Each "value" is that asset's dynasty trade value on a 0-100 scale from your research (a league-winning young stud ~90+, a useful starter ~40-60, a dart-throw ~10-20, a future 1st ~35-55 depending on class, a future 3rd ~10). leanScore should reflect total value plus fit for MY roster (fixing my holes is worth extra to me). After the closing tag, write your normal prose analysis. The JSON must be valid; do not put comments in it.${MOVE}`,
    pickups: `You are a dynasty fantasy football waiver analyst. Use web search for CURRENT news on the players below: role changes, injuries ahead of them, scheme fits, camp reports.

${ctx}

MY FULL ROSTER (The Nightmen):
${mine}

PLAYERS TRENDING LEAGUE-WIDE ON SLEEPER (48h), UNROSTERED IN MY LEAGUE:
${trendingText || "(no trending players currently available)"}

TASK: My 3 to 6 best pickups right now, and who to drop for each. Consider my flagged holes first, dynasty value over redraft (age, opportunity trajectory), and what your search found about each player's current situation. Rolling waiver priority league, no FAAB, so say when someone is worth burning priority on. Be honest if the pool is weak. No filler.

CRITICAL: before any prose, emit a block wrapped in <PICKUP_JSON> and </PICKUP_JSON> with this exact shape naming your single best grab and the single best drop to make room:
{"grab":{"name":"player to add","pos":"RB"|null,"why":"one short line"},"drop":{"name":"player to drop","pos":"RB"|null,"why":"one short line"}}
If the pool is too weak to justify a move, use null for grab and/or drop. Valid JSON only. Then write the prose.${groundNote}${MOVE}`,
    sitstart: inSeason
      ? `You are a fantasy football lineup analyst. It is ${wk.season} NFL regular season, week ${wk.week}. Use web search extensively: current injuries and practice reports, offensive coordinator and scheme tendencies for each player's NFL team (run/pass lean, pace, new-OC risk), depth chart changes, breaking news.

LINEUP SLOTS: ${JSON.stringify(snapshot.rosterPositions)}

MY FULL ROSTER (The Nightmen):
${mine}

Set my optimal lineup for the coming week. For every call, cite the specific current information from your search that drove it, with a confidence level. No filler.${groundNote}${MOVE}`
      : `You are a fantasy football roster analyst. It is the NFL offseason. Use web search extensively for current camp reports, depth chart battles, coaching and coordinator changes affecting my players.

MY FULL ROSTER (The Nightmen):
${mine}

Run a roster stress test: locked-in starters by position when the season opens, the closest lineup battles, and which player situations to monitor based on current news. Cite what your search found. No filler.${groundNote}${MOVE}`,
    teams: `You are a dynasty fantasy football scout writing the intel book on every OTHER team in my league. Use web search for current news and values where it changes the read on a specific player.

${ctx}

MY FULL ROSTER (The Nightmen):
${mine}

For EACH of the other 7 teams, write a tight intel report:
1. DIRECTION: where they are headed (their stance, age curve, pick capital)
2. UNTOUCHABLES: 1-3 players they will never move, and why
3. GETTABLE: 2-4 players realistically acquirable, using their surplus, holes, owner tendencies (positions they hunt, engagement level), and management data (high dead-start owners undervalue their bench; low-engagement owners need overwhelming clarity)
4. THE ASK: the single best asset for ME to target on that roster and roughly what it costs
5. THEIR ANGLE: what they would want from MY roster
Be blunt and specific, position by position where it matters. Rookies and future picks count as assets.${groundNote}${MOVE}`,
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
  const trends = await store.get("trends", { type: "json" });
  const playerValues = await store.get("player_values", { type: "json" });
  const gradingRecord = await store.get("grading_record", { type: "json" });
  const trendingText = buildTrendingBlock(trendingRaw, rostersRaw, playersDB);
  const P = prompts(snapshot, trendingText, newsDigest, statsDigest, trends, playerValues);

  // Track-record block: shows the model its own calibrated hit rate
  let trackBlock = "";
  if (gradingRecord && gradingRecord.total >= 5) {
    const rate = Math.round(gradingRecord.hits / gradingRecord.total * 100);
    const recent = (gradingRecord.calls || []).slice(-8).map(c =>
      `${c.player} (${c.action}, ${c.hit ? "HIT" : "miss"}, ${c.ppgSince} ppg)`).join("; ");
    trackBlock = `\n\nYOUR OWN TRACK RECORD SO FAR: ${gradingRecord.hits}/${gradingRecord.total} graded calls hit (${rate}%). Recent: ${recent}. Let this calibrate your confidence; if your hit rate is low, tighten up and be more selective.`;
  }

  const nflWeek = (snapshot.nflState || {}).week || 0;

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
      const text = await callClaude(P[task] + memoryBlock + trackBlock);
      await store.setJSON(`analysis_${task}`, { status: "done", at: Date.now(), text });
      history.push({ at: Date.now(), text });
      while (history.length > 5) history.shift();
      await store.setJSON(`analysis_history_${task}`, history);

      // Log recommended players for later grading (pickups + sit/start only;
      // trades are graded differently and teams intel isn't a per-player call)
      if ((task === "pickups" || task === "sitstart") && nflWeek >= 1) {
        const rec = playersFromText(text, playersDB);
        if (rec.length) {
          const pending = (await store.get("grading_pending", { type: "json" })) || [];
          pending.push({ at: Date.now(), week: nflWeek, task, action: task === "pickups" ? "GRAB" : "START", playerIds: rec });
          while (pending.length > 40) pending.shift();
          await store.setJSON("grading_pending", pending);
        }
      }
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
