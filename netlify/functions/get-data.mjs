// The frontend's single read endpoint: latest snapshot, changelog,
// and all stored analyses in one response.

import { blobs } from "./lib/ocho.mjs";

export default async () => {
  const store = blobs();
  const [snapshot, changelog, trades, pickups, sitstart, teams, news, stats, alerts, draftBoard, briefing, grading, trends] = await Promise.all([
    store.get("snapshot", { type: "json" }),
    store.get("changelog", { type: "json" }),
    store.get("analysis_trades", { type: "json" }),
    store.get("analysis_pickups", { type: "json" }),
    store.get("analysis_sitstart", { type: "json" }),
    store.get("analysis_teams", { type: "json" }),
    store.get("news_digest", { type: "json" }),
    store.get("stats_digest", { type: "json" }),
    store.get("alerts", { type: "json" }),
    store.get("draft_board", { type: "json" }),
    store.get("briefing", { type: "json" }),
    store.get("grading_record", { type: "json" }),
    store.get("trends", { type: "json" }),
  ]);
  return new Response(JSON.stringify({
    snapshot: snapshot || null,
    changelog: (changelog || []).slice(-15).reverse(),
    analyses: { trades: trades || null, pickups: pickups || null, sitstart: sitstart || null, teams: teams || null },
    news: news ? { at: news.at, items: (news.items || []).slice(0, 60) } : null,
    stats: stats ? { at: stats.at, season: stats.season, seasonIsCurrent: stats.seasonIsCurrent } : null,
    alerts: (alerts || []).slice(-10).reverse(),
    draftBoard: draftBoard || null,
    briefing: briefing || null,
    grading: grading ? { hits: grading.hits, total: grading.total, calls: (grading.calls || []).slice(-20).reverse() } : null,
    trends: trends || null,
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
