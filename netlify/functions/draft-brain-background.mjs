// DRAFT BRAIN. Does not explain the consensus ranking, it builds its own.
// Re-ranks the available pool specifically for MY roster using live web
// search (camp reports, depth charts, coaching and scheme changes), the
// harvested news wire, nflverse team tendencies, my holes and surplus, my
// contention window, my own manager history, and snake look-ahead. Runs as
// a background function because search plus a 20-player re-rank takes well
// past the sync limit.

import { blobs, callClaude, myRosterBlock, leagueStateBlock, leagueContextBlock, normName, OWNER_HISTORY, MY_USER_ID } from "./lib/ocho.mjs";

export default async () => {
  const store = blobs();
  const [snapshot, board, playerValues, newsDigest, statsDigest, valueHistory] = await Promise.all([
    store.get("snapshot", { type: "json" }),
    store.get("draft_board", { type: "json" }),
    store.get("player_values", { type: "json" }),
    store.get("news_digest", { type: "json" }),
    store.get("stats_digest", { type: "json" }),
    store.get("value_history", { type: "json" }),
  ]);
  if (!snapshot || !board || !Array.isArray(board.board) || !board.board.length) {
    return new Response(JSON.stringify({ ok: false, reason: "no board to reason about" }));
  }

  const candidates = board.board.slice(0, 35);
  const ctx = board.ctx || {};
  const isRookieDraft = !!board.isRookieDraft;
  const me = snapshot.teams.find(t => t.isMe);

  // Headlines naming anyone on the board, so camp and depth chart reporting
  // reaches the draft brain instead of dying in the wire.
  const names = candidates.map(c => c.name.toLowerCase());
  const headlines = ((newsDigest || {}).items || [])
    .filter(i => names.some(n => (i.title || "").toLowerCase().includes(n)))
    .slice(0, 24)
    .map(i => `- [${i.source}] ${i.title}`)
    .join("\n");

  // Scheme and pace for the NFL teams these prospects landed on.
  let schemeLine = "";
  if (statsDigest && statsDigest.tendencies) {
    const relevant = new Set(candidates.map(c => c.team).filter(Boolean));
    const lines = Object.entries(statsDigest.tendencies)
      .filter(([team]) => relevant.has(team))
      .map(([team, s]) => `${team}: pass rate ${s.passRate}%, ${s.playsPerGame} plays/gm, pass EPA ${s.passEpa}, rush EPA ${s.rushEpa}, sacks allowed ${s.sacksAllowed}`);
    if (lines.length) schemeLine = `\n\nNFL TEAM SCHEME AND PACE (nflverse, ${statsDigest.season}) for the landing spots of these prospects. Landing spot is a large share of rookie value, so weigh pass rate, pace, and offensive efficiency:\n${lines.join("\n")}`;
  }

  // Which of these prospects are already moving in the market.
  let moverLine = "";
  if (valueHistory && Array.isArray(valueHistory.days) && valueHistory.days.length >= 3) {
    const arr = valueHistory.days;
    const latest = arr[arr.length - 1];
    const past = arr[Math.max(0, arr.length - 22)];
    const moves = [];
    for (const c of candidates) {
      const k = normName(c.name);
      const now = latest.v ? latest.v[k] : null;
      const then = past && past.v ? past.v[k] : null;
      if (now == null || then == null || Math.abs(now - then) < 4) continue;
      moves.push(`${c.name} ${then} -> ${now} (${now - then > 0 ? "+" : ""}${now - then})`);
    }
    if (moves.length) moverLine = `\n\nMARKET MOVEMENT ON THESE PROSPECTS over the last few weeks. Rising means the market is catching on, which can mean I am already late; falling can mean a buying window or a real problem:\n${moves.join("\n")}`;
  }

  // My own manager profile, so the ranking accounts for how I actually play.
  const myH = OWNER_HISTORY[MY_USER_ID] || {};
  const myProfile = `\n\nHOW I ACTUALLY MANAGE (4 seasons of my own data, factor this into what kind of player suits me): career win% ${myH.win_pct ?? "?"}, ${myH.trades_count ?? "?"} career trades (I trade a lot), lineup efficiency ${myH.lineup_efficiency_pct ?? "?"}% of optimal, ${myH.avg_bench_leak_per_week ?? "?"} points per week left on my bench, ${myH.dead_starts_4yr ?? "?"} dead starts in 4 years. I historically acquire ${Object.entries(myH.trade_positions_acquired || {}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}x`).join(", ") || "unknown"}. A high-variance boom/bust rookie is worth less to a manager who sets lineups poorly; a plug-and-play contributor is worth more. Judge accordingly.`;

  const filled = Object.entries(board.myDraftedByPos || {}).filter(([, n]) => n > 0).map(([p, n]) => `${p} x${n}`).join(", ") || "nothing yet";
  const aheadLine = (ctx.untilNext != null)
    ? `\n\nSNAKE LOOK-AHEAD: about ${ctx.untilNext} picks until my next turn after this one. Roughly that many players come off the board before I pick again. Rank with tier survival in mind: if a position's tier will still be there next turn and another will not, the one that will not should rank higher now even at slightly lower raw value.`
    : "";

  const framing = isRookieDraft
    ? `This is a ROOKIE DRAFT in a continuing dynasty league. Every player listed is an incoming rookie or an unrostered free agent. Everyone else in the NFL is already on a league roster and cannot be drafted. These picks join an existing roster, so fit with what I already have matters as much as raw talent.`
    : `This is a DYNASTY STARTUP draft. The whole player pool is available and I keep this roster for years.`;

  const prompt = `You are my dynasty draft strategist. Your job is NOT to explain an existing ranking. Your job is to BUILD YOUR OWN RANKING of the available players, ordered specifically for MY roster and MY situation. ${framing}

The market values below are consensus opinion. Treat them as ONE input, not the answer. You are expected to disagree with them where the evidence supports it, and to say so.

USE WEB SEARCH AGGRESSIVELY FIRST. The consensus values know nothing about the last several weeks. Search for: current training camp reports and beat writer notes on these specific prospects, depth chart movement and who is ahead of them, injuries, offensive coordinator and head coach changes, scheme fit for their skill set, and preseason usage. Where live reporting contradicts consensus value, that is exactly where your ranking should diverge, and you should say what you found.

${leagueContextBlock(snapshot)}

MY FULL ROSTER (The Nightmen):
${myRosterBlock(snapshot)}
${leagueStateBlock(snapshot, playerValues)}

MY HOLES: ${(me && me.holes || []).join("; ") || "none flagged"}
MY SURPLUS: ${(me && me.surplus || []).join("; ") || "none flagged"}
MY AVERAGE ROSTER AGE: ${me ? me.avgAge : "?"}
MY DRAFT SO FAR: ${filled}. Overall picks made league-wide: ${board.picksMade || 0}.
${(board.myDraftedNames || []).length ? `Players I have already drafted: ${board.myDraftedNames.join(", ")}.` : ""}${myProfile}

AVAILABLE PLAYERS, listed in CONSENSUS market-value order (this ordering is the thing you are re-deciding):
${candidates.map((p, i) => `${i + 1}. ${p.name} ${p.pos}${p.age ? " age " + p.age : " (incoming rookie)"}${p.team ? " " + p.team : ""} consensus value ${p.value}`).join("\n")}
${headlines ? `\nHARVESTED HEADLINES NAMING THESE PLAYERS:\n${headlines}` : ""}${schemeLine}${moverLine}
${ctx.runLine ? `\nLIVE POSITIONAL RUN IN THIS DRAFT: ${ctx.runLine} just went. That position is drying up.` : ""}
${ctx.rivalLine ? `\nWHAT RIVALS HAVE STACKED SO FAR: ${ctx.rivalLine}.` : ""}${aheadLine}

HOW TO RANK. Weigh all of these, not just talent:
1. Live reporting you found: camp buzz, depth chart position, injury, role clarity. This is your edge over consensus and should move players meaningfully.
2. Landing spot and scheme: pace, pass rate, offensive quality, who else is in that room competing for touches.
3. My roster fit: a player at a position I am already deep at is worth less to me than the same player at a position I am thin at. Filling a real hole beats adding to a surplus.
4. My contention window and roster age.
5. Tier survival given the snake look-ahead.
6. Positional scarcity in this league specifically.
7. How I manage: see my profile above.
8. Consensus value as a sanity anchor. Do not diverge from it wildly without a stated reason.

Output EXACTLY these labeled lines, then the ranking block, and nothing else:
PICK: <the number one name on YOUR ranking>
WHY: <3-4 sentences on why he is your number one FOR ME specifically, citing the live reporting or scheme reasoning that drove it, and the look-ahead logic>
BACKUP: <the number two name and one phrase why>
PRIORITIZE: <one position to target across my next few picks and why, one sentence>

RANKED: a JSON array of the top 20 in YOUR order, best first. Format exactly:
[{"name":"Exact Name As Spelled Above","note":"One to three sentences: why he sits at this rank for me. Lead with the single biggest driver (camp report, depth chart, scheme fit, my hole at that position). Name the real risk. If you moved him significantly up or down from consensus, say why in plain terms.","risk":"Low"|"Medium"|"High"}]
Use the exact names as spelled in the available list. Valid JSON only, no comments, no trailing commas.`;

  try {
    const text = await callClaude(prompt, { maxTokens: 4000, useSearch: true });

    const pickMatch = text.match(/PICK:\s*(.+)/i);
    const whyMatch = text.match(/WHY:\s*([\s\S]*?)(?:\nBACKUP:|\nPRIORITIZE:|\nRANKED:|$)/i);
    const backupMatch = text.match(/BACKUP:\s*(.+)/i);
    const prioritizeMatch = text.match(/PRIORITIZE:\s*(.+)/i);

    let ranked = [];
    const rMatch = text.match(/RANKED:\s*([\s\S]*)$/i);
    if (rMatch) {
      try {
        let clean = rMatch[1].replace(/```json|```/gi, "").trim();
        const a = clean.indexOf("["), b = clean.lastIndexOf("]");
        if (a !== -1 && b !== -1) clean = clean.slice(a, b + 1);
        clean = clean.replace(/,\s*([\]}])/g, "$1");
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) ranked = parsed;
      } catch (e) { ranked = []; }
    }

    // Re-read in case the live watcher rebuilt the board while we were thinking.
    const current = (await store.get("draft_board", { type: "json" })) || board;
    const byName = {};
    for (const p of (current.board || [])) byName[normName(p.name)] = p;

    // Merge the AI order onto real player objects. Anything the model named
    // that is not actually available gets dropped.
    const aiBoard = [];
    const seen = new Set();
    for (const r of ranked) {
      if (!r || !r.name) continue;
      const k = normName(r.name);
      if (seen.has(k)) continue;
      const base = byName[k];
      if (!base) continue;
      seen.add(k);
      aiBoard.push({ ...base, note: r.note || "", risk: r.risk || null });
    }

    const pickName = pickMatch ? pickMatch[1].trim() : null;
    const pickCard =
      (pickName && aiBoard.find(p => normName(p.name) === normName(pickName))) ||
      aiBoard[0] ||
      (pickName ? byName[normName(pickName)] : null) ||
      current.pick;

    await store.setJSON("draft_board", {
      ...current,
      aiBoard,
      pick: pickCard,
      why: whyMatch ? whyMatch[1].trim() : current.why,
      backup: backupMatch ? backupMatch[1].trim() : current.backup,
      prioritize: prioritizeMatch ? prioritizeMatch[1].trim() : current.prioritize,
      read: text,
      reasoning: { status: "done", at: Date.now(), ranked: aiBoard.length },
    });

    return new Response(JSON.stringify({ ok: true, ranked: aiBoard.length, pick: pickCard ? pickCard.name : null }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const current = (await store.get("draft_board", { type: "json" })) || board;
    await store.setJSON("draft_board", { ...current, reasoning: { status: "error", at: Date.now(), error: err.message } });
    return new Response(JSON.stringify({ error: err.message }), { status: 502 });
  }
};