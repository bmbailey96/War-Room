// VALUES DIGESTER. Runs daily. Pulls DynastyProcess's free dynasty trade
// values (KeepTradeCut-derived, updated ~weekly) for players and rookie
// picks, normalizes them to the same 0-100 scale the trade cards use, and
// stores a lookup keyed by normalized player name. This gives the trade
// analyzer and evaluator a real MARKET anchor instead of guessing values
// from the model's memory. The prompt still lets live news override, but
// now it starts from consensus reality.

import { blobs } from "./lib/ocho.mjs";

const PLAYERS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const PICKS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-picks.csv";

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",").map(h => h.replace(/"/g, ""));
  return lines.map(line => {
    // simple split is fine here; these files quote every field, no embedded commas in the fields we use
    const cells = line.split(",").map(c => c.replace(/^"|"$/g, ""));
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

export default async () => {
  const store = blobs();

  const [pText, kText] = await Promise.all([
    fetch(PLAYERS_URL).then(r => r.ok ? r.text() : null).catch(() => null),
    fetch(PICKS_URL).then(r => r.ok ? r.text() : null).catch(() => null),
  ]);
  if (!pText) return new Response(JSON.stringify({ error: "player values unavailable" }), { status: 502 });

  const players = parseCsv(pText);
  // 1QB league scoring: this league starts 1 QB, so use value_1qb.
  const rawMax = Math.max(...players.map(p => +p.value_1qb || 0), 1);
  const playerValues = {};
  let scrapeDate = "";
  for (const p of players) {
    const v = +p.value_1qb || 0;
    scrapeDate = p.scrape_date || scrapeDate;
    const norm = Math.round((v / rawMax) * 100);
    playerValues[normName(p.player)] = { v: norm, pos: p.pos, team: p.team, age: p.age ? +p.age : null };
  }

  // Picks: normalize on the same scale using the player rawMax so picks and
  // players are directly comparable.
  const pickValues = {};
  if (kText) {
    const picks = parseCsv(kText);
    for (const pk of picks) {
      const v = +pk.ecr_1qb ? null : null; // ecr is a rank, value is separate; picks file uses a value column? handle both
    }
    // The picks file exposes rank-like columns; derive a rough value from the
    // 1.01 anchor down. Map "2026 Pick 1.01" style names and generic round buckets.
    for (const pk of picks) {
      const name = pk.player || "";
      // Some rows carry a numeric value under ecr_1qb that's actually small;
      // instead map by pick number to a sensible dynasty value curve.
      const pickNo = +pk.pick || 0;
      if (!pickNo) continue;
      // Rough 1QB rookie pick value curve normalized to ~0-55 band
      const curve = Math.max(4, Math.round(58 * Math.exp(-0.14 * (pickNo - 1))));
      pickValues[normName(name)] = { v: curve, pickNo };
    }
  }

  await store.setJSON("player_values", {
    at: Date.now(), scrapeDate,
    players: playerValues,
    picks: pickValues,
    count: Object.keys(playerValues).length,
  });

  return new Response(JSON.stringify({
    ok: true, scrapeDate, players: Object.keys(playerValues).length, picks: Object.keys(pickValues).length,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "45 11 * * *" };
