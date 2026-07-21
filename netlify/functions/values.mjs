// VALUES DIGESTER. Runs daily. Pulls DynastyProcess's free dynasty trade
// values (KeepTradeCut-derived) for players AND rookie picks, normalizes
// everything onto one 0-100 scale so a player and a pick are directly
// comparable in a trade. This is the market anchor every trade number in
// the app rests on. The prompt can still let live news override, but the
// baseline is now real consensus, not a guess.
//
// Player values: DynastyProcess value_1qb column (league starts 1 QB).
// Pick values: the picks file gives ECR (expected consensus rank), not a
// value. We map each pick's ECR into the player value curve by rank, so a
// 1.01 that "ranks like the 20th player" gets the 20th player's value.
// This produces a real, non-guessed pick curve.

import { blobs } from "./lib/ocho.mjs";

const PLAYERS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const PICKS_URL = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-picks.csv";

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",").map(h => h.replace(/"/g, ""));
  return lines.map(line => {
    const cells = line.split(",").map(c => c.replace(/^"|"$/g, ""));
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

// Normalize a "2026 Pick 1.03" / "2026 1st" style label into stable keys the
// roster ledger can match: exact ("2026 1.03") and round-bucket ("2026 1").
function pickKeys(label) {
  const keys = [];
  const m = label.match(/(20\d\d).*?(\d)\.(\d\d)/);
  if (m) { keys.push(`${m[1]} ${m[2]}.${m[3]}`); keys.push(`${m[1]} ${m[2]}`); }
  const r = label.match(/(20\d\d).*?(\d)(?:st|nd|rd|th)/);
  if (r) keys.push(`${r[1]} ${r[2]}`);
  return keys;
}

export default async () => {
  const store = blobs();

  const [pText, kText] = await Promise.all([
    fetch(PLAYERS_URL).then(r => r.ok ? r.text() : null).catch(() => null),
    fetch(PICKS_URL).then(r => r.ok ? r.text() : null).catch(() => null),
  ]);
  if (!pText) return new Response(JSON.stringify({ error: "player values unavailable" }), { status: 502 });

  const players = parseCsv(pText);
  const rawMax = Math.max(...players.map(p => +p.value_1qb || 0), 1);

  const playerValues = {};
  let scrapeDate = "";
  // Also build an ECR-sorted ladder for pick interpolation.
  const ladder = [];
  for (const p of players) {
    const v = +p.value_1qb || 0;
    scrapeDate = p.scrape_date || scrapeDate;
    playerValues[normName(p.player)] = {
      v: Math.round((v / rawMax) * 100),
      pos: p.pos, team: p.team, age: p.age ? +p.age : null,
    };
    const ecr = +p.ecr_1qb || 0;
    if (v > 0 && ecr > 0) ladder.push({ ecr, v });
  }
  ladder.sort((a, b) => a.ecr - b.ecr);

  // Interpolate a value for any ECR by finding where it sits on the player ladder.
  const valueAtEcr = (ecr) => {
    if (!ladder.length) return 0;
    if (ecr <= ladder[0].ecr) return ladder[0].v;
    if (ecr >= ladder[ladder.length - 1].ecr) return ladder[ladder.length - 1].v;
    for (let i = 0; i < ladder.length - 1; i++) {
      if (ladder[i].ecr <= ecr && ladder[i + 1].ecr >= ecr) {
        const span = ladder[i + 1].ecr - ladder[i].ecr || 1;
        const f = (ecr - ladder[i].ecr) / span;
        return ladder[i].v + f * (ladder[i + 1].v - ladder[i].v);
      }
    }
    return 0;
  };

  // Pick values: map each pick's ECR onto the player curve, then normalize.
  const pickValues = {};
  if (kText) {
    const picks = parseCsv(kText);
    // Group picks by round so we can also compute a round-average value for
    // the common case where a pick is only known by round ("2026 1st").
    const roundVals = {};
    for (const pk of picks) {
      const ecr = +pk.ecr_1qb || 0;
      if (!ecr) continue;
      const v = Math.round((valueAtEcr(ecr) / rawMax) * 100);
      for (const key of pickKeys(pk.player)) {
        // exact keys win; round buckets take the max (earliest pick) unless averaged below
        if (/\.\d\d$/.test(key)) pickValues[key] = { v, label: pk.player };
        else { (roundVals[key] = roundVals[key] || []).push(v); }
      }
    }
    // Round bucket = average value of that round's picks (a "2026 1st" of
    // unknown slot is worth the round's midpoint).
    for (const [key, arr] of Object.entries(roundVals)) {
      const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      pickValues[key] = { v: avg, label: `${key} (round avg)` };
    }
  }

  await store.setJSON("player_values", {
    at: Date.now(), scrapeDate,
    players: playerValues,
    picks: pickValues,
    count: Object.keys(playerValues).length,
    pickCount: Object.keys(pickValues).length,
  });

  return new Response(JSON.stringify({
    ok: true, scrapeDate,
    players: Object.keys(playerValues).length,
    picks: Object.keys(pickValues).length,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "45 11 * * *" };
