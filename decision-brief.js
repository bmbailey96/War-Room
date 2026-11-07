(function (root) {
  "use strict";

  // Advice derived from data the board has actually loaded. This does NOT
  // claim to perform independent medical reporting or AI news verification.
  const norm = v => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]/g, "");
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const format = v => (num(v) >= 0 ? "+" : "") + num(v).toFixed(1);
  const usable = p => p && !p.out && !p.bye && !p.locked;
  const isTrade = a => /trade|sell/i.test(String(a?.type || ""));
  const isAcquisition = a => /add|waiver|stream/i.test(String(a?.type || ""));
  const matching = (a, b) => !!(a && b && ((a.pid && b.pid && String(a.pid) === String(b.pid)) || (a.name && b.name && norm(a.name) === norm(b.name))));
  const count = (players, slot) => (players || []).filter(p => p.slot === slot).length;
  const briefItem = (status, title, reason, source) => ({status, title, reason, source});

  function freshness(market, now) {
    if (!market || market.error || market.status === "building" || !market.at)
      return {ready:false, label:"Roster market unavailable or still building"};
    const age = Math.max(0, (now - num(market.at)) / 60000);
    const target = num(market.freshness?.targetMinutes || market.context?.freshness?.targetMinutes || 180);
    const limit = Math.max(30, target * 1.5);
    if (age > limit) return {ready:false, label:"Roster scan is " + Math.round(age) + " minutes old"};
    if (market.refreshing) return {ready:false, label:"Roster scan is refreshing; verify before acting"};
    return {ready:true, label:"Roster scan " + Math.round(age) + " minutes old"};
  }

  function lineupNames(lineup) {
    return (lineup?.optimal || []).map(x => x.player).filter(Boolean);
  }
  function conflicts(action, lineup) {
    if (!action?.drop) return false;
    return lineupNames(lineup).some(p => matching(p, action.drop));
  }
  function actionDeadline(c, now) {
    if (!c?.deadlineAt) return true;
    const date = new Date(c.deadlineAt).getTime();
    return Number.isFinite(date) && date > now;
  }
  function eligibleMarketAction(a) {
    if (!a || a.deferred || a.planRole === "ALTERNATIVE" || a.type === "HOLD") return false;
    if (a.type === "IR_ADD") return !!a.moveToIr?.name && !!a.add?.name;
    if (!isAcquisition(a) || !a.add?.name) return false;
    if (!(a.immediateFreeAgent || a.waiverOnly || a.specialistMode === "STREAM_SWAP")) return false;
    return num(a.weeklyDelta) >= .75 || num(a.streamWeekEdge) >= .35 ||
      (a.movePurpose === "DYNASTY_VALUE" && num(a.marketDelta) > 0);
  }

  function build(lineup, market, options = {}) {
    const now = num(options.now) || Date.now();
    const result = {
      name: lineup?.league?.name || market?.league?.name || "Selected league",
      week: lineup?.week ?? market?.league?.week ?? null,
      mode: market?.league?.mode || "UNKNOWN",
      rightNow: [],
      investigate: [],
      longGame: [],
      quality: [],
      market: freshness(market, now),
    };
    if (!lineup) {
      result.quality.push("Lineup data not yet loaded. No recommendation has been verified.");
      return result;
    }
    const gaps = lineup.unfilledSlots || [];
    if (gaps.length)
      result.rightNow.push(briefItem("DO", "Fill the " + gaps.join(" / ") + " slot", "An unfilled starting slot matters more than any projection edge. Confirm a legal, unlocked replacement.", "Sleeper lineup"));
    const urgent = (lineup.contingencies || []).filter(c =>
      (c.urgency === "DECISION_DEADLINE" || c.urgency === "NO_CLEAN_PIVOT") && actionDeadline(c, now)
    ).sort((a, b) => new Date(a.deadlineAt || "2999-01-01") - new Date(b.deadlineAt || "2999-01-01"))[0];
    if (urgent) result.rightNow.push(briefItem("VERIFY", urgent.starter + ": decision before kickoff",
      urgent.message || "Check final designation and kickoff time.", "Sleeper injury status; confirm with team report"));

    const candidates = (lineup.actionableCalls || []).filter(c =>
      c?.start && usable(c.start) && num(c.edge) >= 1.5 && (!c.sit || !c.sit.locked)
    );
    for (const c of candidates.slice(0, 2)) result.rightNow.push(briefItem("DO",
      "Start " + c.start.name + (c.sit?.name ? " over " + c.sit.name : ""),
      format(c.edge) + " projected points under your league scoring. The player must remain active; this is a model recommendation, not a verified news judgment.",
      "Legal-lineup optimizer"));

    const flex = (lineup.flexMoves || []).find(x => num(x.gainMinutes) >= 60);
    if (flex) result.rightNow.push(briefItem("DO",
      "Keep " + flex.moveToFlex + " in FLEX",
      flex.message || "Preserve later replacement options without changing projected points.",
      "Kickoff and lineup eligibility"));

    const roster = lineup.players || [];
    const rbs = roster.filter(p => p.slot === "RB");
    const availableRbs = rbs.filter(p => !p.out && !p.bye);
    if (result.mode === "REDRAFT") {
      if (count(roster, "K") >= 2) result.longGame.push(briefItem("REVIEW",
        "Consider freeing the spare kicker spot",
        "A second kicker rarely adds enough replacement value to justify thin RB/WR insurance. Check locks and your waiver alternatives before cutting anyone.",
        "Actual roster construction"));
      if (rbs.length > 0 && availableRbs.length <= 2)
        result.longGame.push(briefItem("REVIEW", "Running-back cover is thin",
          "Only " + availableRbs.length + " rostered RBs are available this week. Prioritize an attainable starter or contingency back over luxury depth.",
          "Sleeper injuries and byes"));
    } else if (result.mode === "DYNASTY") {
      if (count(roster, "TE") >= 3) result.longGame.push(briefItem("REVIEW",
        "Check the tight-end trade market",
        "You have " + count(roster, "TE") + " tight ends. Explore an upgrade to a weekly RB/WR/FLEX starter, but don't sell young dynasty value for a bench rental.",
        "Roster depth; trade value not established"));
    }
    if (market?.context?.teamState?.summary) result.longGame.push(briefItem("CONTEXT",
      market.context.teamState.label || "Team direction",
      market.context.teamState.summary, "League results and all-play history"));

    if (result.market.ready) {
      const approved = (market.actions || []).filter(a => eligibleMarketAction(a) && !conflicts(a, lineup));
      const a = approved[0];
      if (a) {
        const window = a.immediateFreeAgent ? "Add now" : a.waiverOnly ? "Waiver claim" : "Roster move";
        const detail = a.type === "IR_ADD"
          ? "Move " + a.moveToIr.name + " to IR first. Confirm current league IR eligibility."
          : num(a.weeklyDelta) > 0
            ? format(a.weeklyDelta) + " estimated best-lineup points per week. Confirm current ownership, roster and lock rules."
            : a.movePurpose === "DYNASTY_VALUE"
              ? "Dynasty asset-value pickup, not an immediate lineup upgrade. Confirm market value and the required drop."
              : "Check the actual streaming edge and lock rules before executing.";
        result.rightNow.push(briefItem(a.immediateFreeAgent || a.type === "IR_ADD" ? "DO" : "VERIFY",
          window + ": " + (a.headline || a.add?.name || "Review roster action"), detail,
          "League-owned free-agent scan; " + result.market.label));
      }
      const t = (market.actions || []).find(a => isTrade(a) && a.partner && (a.send || []).length && (a.receive || []).length);
      if (t) result.investigate.push(briefItem("REVIEW", "Trade idea: " + (t.headline || t.partner),
        "Not a recommendation to send the offer yet. Verify two-sided lineup impact, actual manager needs and pick value.",
        "Trade model; partner not contacted"));
    } else {
      result.investigate.push(briefItem("VERIFY", "Refresh the pickup and trade scan",
        result.market.label + ". No free agent or trade is being represented as currently available.",
        "Roster-scan freshness"));
    }

    const injured = roster.filter(p => p.out && !p.locked);
    if (injured.length) result.investigate.push(briefItem("VERIFY",
      "Resolve " + injured.length + " unavailable roster player" + (injured.length === 1 ? "" : "s"),
      injured.slice(0, 4).map(p => p.name).join(", ") + ". Check reserve eligibility and whether replacements are actually available.",
      "Sleeper player status; confirm with team reports"));

    if (!result.rightNow.length) result.rightNow.push(briefItem("HOLD",
      "No clear immediate move",
      "No legal lineup change or fresh available-player claim cleared the decision threshold. Do not churn the roster to manufacture an action.",
      "Current lineup and roster-market screens"));

    const model = lineup.model || {};
    if (num(model.reasoningCalls) === 0)
      result.quality.push("Zero graded reasoning calls. Confidence labels and matchup probabilities are model estimates, not validated success rates.");
    const disagreement = roster.filter(p =>
      !p.locked && p.sleeper != null && num(p.projection) > 0 &&
      Math.abs(num(p.projection) - num(p.sleeper)) >= Math.max(4, num(p.sleeper) * .2)
    ).sort((a, b) => Math.abs(num(b.projection)-num(b.sleeper)) - Math.abs(num(a.projection)-num(a.sleeper)));
    if (disagreement.length) result.quality.push(
      "Large model vs Sleeper projection differences: " + disagreement.slice(0, 3).map(p =>
        p.name + " " + num(p.projection).toFixed(1) + "/" + num(p.sleeper).toFixed(1)
      ).join(", ") + ". Investigate before trading."
    );
    result.quality.push("Public RSS headlines are displayed separately. They do not independently verify or override roster moves.");
    return result;
  }

  function packet(lineup, market, options = {}) {
    const b = build(lineup, market, options);
    const row = x => [x.slot, x.name, x.team || "", "model " + (x.projection ?? "?"), "Sleeper " + (x.sleeper ?? "?"),
      x.out ? "OUT" : x.bye ? "BYE" : x.injury || ""].join(" | ");
    const lines = [
      "WAR ROOM DECISION DOSSIER - evidence for review, not an automated transaction",
      "League: " + b.name + " | NFL week " + (b.week ?? "?") + " | mode " + b.mode,
      "Data: Sleeper lineup + War Room models. Public headlines NOT incorporated into roster recommendations.",
      "Model training: " + (lineup?.model?.samples ?? "?") + " player-weeks; graded reasoning calls: " + (lineup?.model?.reasoningCalls ?? "?"),
      "Matchup: " + (lineup?.opponent ?? "?") + " | current " + (lineup?.currentTotal ?? "?") + " | optimal " + (lineup?.optimalTotal ?? "?"),
      "",
      "CURRENT STARTERS",
      ...(lineup?.current || []).map(x => row(x.player || {slot:x.slot,name:"EMPTY"})),
      "",
      "ALL ROSTERED PLAYERS",
      ...(lineup?.players || []).map(row),
      "",
      "DECISION BRIEF",
      ...[...b.rightNow, ...b.investigate, ...b.longGame].map(x => x.status + ": " + x.title + " | " + x.reason + " | " + x.source),
      "",
      "ACTUAL ROSTER ACTION CANDIDATES (not guarantees of availability)",
      ...(market?.actions || []).slice(0, 8).map(a => JSON.stringify({
        type:a.type,headline:a.headline,add:a.add?.name,drop:a.drop?.name,partner:a.partner,
        send:(a.send||[]).map(p=>p.name),receive:(a.receive||[]).map(p=>p.name),
        weeklyDelta:a.weeklyDelta,marketDelta:a.marketDelta,streamWeekEdge:a.streamWeekEdge,
        deferred:a.deferred,waiverOnly:a.waiverOnly,immediateFreeAgent:a.immediateFreeAgent
      })),
      "",
      "TEAM / PICKS / RULES",
      JSON.stringify({
        teamState:market?.context?.teamState || null, positionCounts:market?.context?.positionCounts || null,
        reserve:market?.context?.reserve || null, waiver:market?.context?.waiver || null,
        picks:market?.context?.myPicks || null, acquisition:market?.context?.acquisition || null,
        marketAge:b.market.label
      }),
      "",
      "CAUTIONS",
      ...b.quality,
    ];
    return lines.join("\n").slice(0, 24000);
  }

  root.WarRoomDecisionBrief = {build, packet, conflicts, freshness};
})(typeof globalThis !== "undefined" ? globalThis : this);
