// THE ACTION SCOUT. Runs hourly at :25 (after the news harvest at :15).
//
// Job: decide whether anything that just happened demands an action from
// Brandon RIGHT NOW (snag a player, drop a player, strike a trade), and
// push to his phone only when the answer is yes.
//
// Discipline rules, because an alert system that cries wolf gets ignored:
//   - Only wakes the AI when there is genuinely NEW signal since last run
//     (unseen high-relevance headlines, injury status changes on my players,
//     new trending spikes among unrostered players). Most hours: exits
//     silently, zero AI cost.
//   - Uses Haiku (fast, cheap) for the go/no-go call, not Sonnet.
//   - The prompt's default answer is "no alerts". Empty is success.
//   - A player can only trigger one alert per 48h.

import { blobs, callClaude, pInfo, getPlayersTrim, MY_USER_ID } from "./lib/ocho.mjs";

async function notify(title, message, priority = "high") {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return false;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: { title, priority, tags: "football,rotating_light", "content-type": "text/plain" },
      body: message.slice(0, 600),
    });
    return true;
  } catch (e) { return false; }
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  if (!snapshot) return new Response(JSON.stringify({ ok: false, reason: "no snapshot yet" }));

  const state = (await store.get("scout_state", { type: "json" })) || {
    seenNewsKeys: [], alertedPlayers: {}, lastInjuries: {},
  };
  const playersDB = await getPlayersTrim();
  const me = snapshot.teams.find(t => t.isMe) || {};

  // ---------- gather NEW signal ----------
  const signals = [];

  // 1. Unseen high-relevance headlines (score >= 45: my players, or
  //    league-rostered + breaking-news language)
  const news = (await store.get("news_digest", { type: "json" })) || { items: [] };
  const seenSet = new Set(state.seenNewsKeys);
  const newKeys = [];
  for (const item of news.items || []) {
    const key = item.title.toLowerCase().slice(0, 80);
    if (seenSet.has(key)) continue;
    newKeys.push(key);
    if (item.score >= 45) {
      signals.push(`HEADLINE [${item.source}]: ${item.title}${(item.matched?.mine || []).length ? " (INVOLVES MY PLAYER)" : ""}`);
    }
  }
  state.seenNewsKeys = [...state.seenNewsKeys, ...newKeys].slice(-400);

  // 2. Injury status changes on MY roster (from Sleeper's live player data)
  for (const p of me.players || []) {
    const prev = state.lastInjuries[p.name];
    const cur = p.inj || "";
    if (prev !== undefined && prev !== cur && (cur || prev)) {
      signals.push(`INJURY CHANGE (my player): ${p.name} (${p.team}) went from "${prev || "healthy"}" to "${cur || "healthy"}"`);
    }
    state.lastInjuries[p.name] = cur;
  }

  // 3. Big trending spikes among unrostered players (100+ league-wide adds)
  const trendingRaw = (await store.get("trending_raw", { type: "json" })) || [];
  const rostersRaw = (await store.get("rosters_raw", { type: "json" })) || [];
  const rostered = new Set();
  for (const r of rostersRaw) for (const pid of r.players || []) rostered.add(pid);
  for (const t of trendingRaw) {
    if (rostered.has(t.player_id) || (t.count || 0) < 100) continue;
    const p = pInfo(playersDB, t.player_id);
    if (state.alertedPlayers[p.name]) continue; // dedupe handled below too, cheap pre-filter
    signals.push(`TRENDING SPIKE (unrostered in my league): ${p.name} (${p.pos}, ${p.team || "FA"}) has ${t.count} adds league-wide in 48h${p.inj ? ", INJ: " + p.inj : ""}`);
  }

  if (!signals.length) {
    await store.setJSON("scout_state", state);
    return new Response(JSON.stringify({ ok: true, action: "no new signal, slept" }));
  }

  // ---------- Haiku go/no-go ----------
  const holes = (me.holes || []).join("; ") || "none flagged";
  const surplus = (me.surplus || []).join("; ") || "none flagged";
  const waiversLocked = snapshot.leagueStatus === "pre_draft" || snapshot.leagueStatus === "drafting";
  const prompt = `You are an alert scout for my dynasty fantasy football team. Your ONLY job is to decide if any of the NEW SIGNALS below demand an action from me RIGHT NOW. The default and most common correct answer is NO ALERTS. Only alert when the action is clear, time-sensitive, and materially valuable. Never alert to merely "monitor" something unless it is my own player's serious injury.

MY TEAM (The Nightmen): record ${me.wins}-${me.losses}, waiver position ${me.waiverPosition ?? "?"} of ${snapshot.teams.length} (rolling priority, no FAAB).
MY HOLES: ${holes}
MY SURPLUS: ${surplus}
MY ROSTER: ${(me.players || []).map(p => `${p.name} (${p.pos})`).join(", ")}
${waiversLocked ? "IMPORTANT: waivers and free agency are LOCKED right now because the rookie draft has not happened yet. Do NOT issue PICKUP or DROP alerts; I cannot act on them. Only INJURY or TRADE alerts are actionable today." : ""}

ACCURACY RULE: only name a player in an alert if that exact player's name appears in the signal text you are citing. Never infer that a story about a team or another player affects someone who is not named in it.

NEW SIGNALS THIS HOUR:
${signals.join("\n")}

Respond with ONLY valid JSON, no markdown fences, no prose:
{"alerts":[{"action":"PICKUP"|"DROP"|"TRADE"|"INJURY","player":"name","title":"short push title, max 8 words","message":"1-3 sentences: exactly what to do and why, imperative voice"}]}
Empty array if nothing warrants action.`;

  let alerts = [];
  try {
    const raw = await callClaude(prompt, { model: "claude-haiku-4-5", maxTokens: 800, useSearch: false });
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean.slice(clean.indexOf("{")));
    alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
  } catch (e) {
    await store.setJSON("scout_state", state);
    return new Response(JSON.stringify({ ok: false, error: "scout parse failed: " + e.message }));
  }

  // ---------- dedupe + push ----------
  if (waiversLocked) alerts = alerts.filter(a => a.action !== "PICKUP" && a.action !== "DROP");
  const now = Date.now();
  const sent = [];
  const alertLog = (await store.get("alerts", { type: "json" })) || [];
  for (const a of alerts) {
    const key = (a.player || a.title || "").toLowerCase();
    const last = state.alertedPlayers[key];
    if (last && now - last < 1000 * 60 * 60 * 48) continue; // 48h per-player cooldown
    state.alertedPlayers[key] = now;
    const emoji = { PICKUP: "GRAB", DROP: "CUT", TRADE: "DEAL", INJURY: "INJ" }[a.action] || "NOTE";
    await notify(`${emoji}: ${a.title}`, a.message);
    alertLog.push({ at: now, ...a });
    sent.push(a);
  }
  // prune old cooldowns
  for (const [k, t] of Object.entries(state.alertedPlayers)) {
    if (now - t > 1000 * 60 * 60 * 72) delete state.alertedPlayers[k];
  }
  while (alertLog.length > 40) alertLog.shift();

  await store.setJSON("scout_state", state);
  await store.setJSON("alerts", alertLog);

  return new Response(JSON.stringify({
    ok: true, signals: signals.length, alertsGenerated: alerts.length, alertsSent: sent.length,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "25 * * * *" };
