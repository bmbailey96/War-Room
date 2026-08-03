// GAME CONTEXT. Runs daily.
//
// Everything about the game itself rather than the player: who is home, is
// there a roof, what does Vegas think the game total and the spread are, and
// what is the wind doing at kickoff.
//
// Vegas implied team totals are the single best available estimate of how many
// points an offense will score. Wind is the one weather variable that reliably
// moves fantasy scoring, and it is genuinely additive because a projection
// published on Tuesday cannot know Sunday's forecast.
//
// Schedule, roof and betting lines come from nflverse/nfldata games.csv.
// Wind comes from Open-Meteo, which is free and needs no key.

import { blobs, normTeam } from "./lib/ocho.mjs";

const GAMES_CSV = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

// City-level coordinates are plenty for a wind forecast; wind fields are
// regional, not stadium-specific. Domed and permanently roofed venues are
// marked so we never apply weather to them even if the feed's roof column is
// blank.
const STADIUMS = {
  ARI: [33.53, -112.26, true],  ATL: [33.755, -84.401, true],
  BAL: [39.278, -76.623, false], BUF: [42.774, -78.787, false],
  CAR: [35.226, -80.853, false], CHI: [41.862, -87.617, false],
  CIN: [39.095, -84.516, false], CLE: [41.506, -81.699, false],
  DAL: [32.748, -97.093, true],  DEN: [39.744, -105.020, false],
  DET: [42.340, -83.046, true],  GB: [44.501, -88.062, false],
  HOU: [29.685, -95.411, true],  IND: [39.760, -86.164, true],
  JAX: [30.324, -81.637, false], KC: [39.049, -94.484, false],
  LV: [36.091, -115.184, true],  LA: [33.953, -118.339, true],
  LAC: [33.953, -118.339, true], MIA: [25.958, -80.239, false],
  MIN: [44.974, -93.258, true],  NE: [42.091, -71.264, false],
  NO: [29.951, -90.081, true],   NYG: [40.814, -74.074, false],
  NYJ: [40.814, -74.074, false], PHI: [39.901, -75.168, false],
  PIT: [40.447, -80.016, false], SEA: [47.595, -122.332, false],
  SF: [37.713, -122.386, false], TB: [27.976, -82.503, false],
  TEN: [36.166, -86.771, false], WAS: [38.908, -76.864, false],
};

function splitLine(line) {
  const cells = [];
  let field = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cells.push(field); field = ""; }
    else field += c;
  }
  cells.push(field);
  return cells;
}

const num = v => (v === "" || v == null || v === "NA") ? null : (Number.isNaN(+v) ? null : +v);

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });
  const season = String((snapshot && snapshot.season) || new Date().getFullYear());
  const week = String((snapshot && snapshot.week) || 1);

  const res = await fetch(GAMES_CSV, { redirect: "follow" });
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "games.csv unavailable" }), { status: 502 });
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const header = splitLine(lines[0]);
  const col = {};
  header.forEach((h, i) => { col[h] = i; });

  const games = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = splitLine(lines[i]);
    if (c[col.season] !== season || c[col.week] !== week) continue;
    if (c[col.game_type] && c[col.game_type] !== "REG") continue;
    games.push({
      away: normTeam(c[col.away_team]), home: normTeam(c[col.home_team]),
      gameday: c[col.gameday], gametime: c[col.gametime],
      roof: (c[col.roof] || "").toLowerCase(),
      spread: num(c[col.spread_line]),   // positive means the HOME team is favoured
      total: num(c[col.total_line]),
      awayCoach: c[col.away_coach], homeCoach: c[col.home_coach],
      stadium: c[col.stadium],
    });
  }
  if (!games.length) {
    return new Response(JSON.stringify({ ok: true, season, week, games: 0, note: "no games found for this week" }),
      { headers: { "content-type": "application/json" } });
  }

  // League average implied team total, used as the baseline every offense is
  // measured against.
  const totals = games.map(g => g.total).filter(v => v != null);
  const avgTeamTotal = totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length) / 2 : 22;

  const byTeam = {};
  for (const g of games) {
    const spread = g.spread;
    // Vegas implied points: half the total, shifted by half the spread.
    const homeImplied = g.total != null && spread != null ? g.total / 2 + spread / 2 : null;
    const awayImplied = g.total != null && spread != null ? g.total / 2 - spread / 2 : null;

    const indoors = ["dome", "closed"].includes(g.roof)
      || (STADIUMS[g.home] && STADIUMS[g.home][2]);

    const base = {
      gameday: g.gameday, gametime: g.gametime, roof: g.roof || "unknown",
      indoors: !!indoors, total: g.total, stadium: g.stadium,
      avgTeamTotal: Math.round(avgTeamTotal * 10) / 10,
      wind: null, temp: null, precip: null,
    };
    byTeam[g.home] = { ...base, team: g.home, opponent: g.away, home: true, implied: homeImplied, spread: spread == null ? null : -spread, coach: g.homeCoach, oppCoach: g.awayCoach };
    byTeam[g.away] = { ...base, team: g.away, opponent: g.home, home: false, implied: awayImplied, spread: spread, coach: g.awayCoach, oppCoach: g.homeCoach };
  }

  // Wind at kickoff for outdoor games only.
  const outdoorHomes = games.filter(g => {
    const rec = byTeam[g.home];
    return rec && !rec.indoors && STADIUMS[g.home] && g.gameday;
  });
  await Promise.all(outdoorHomes.map(async g => {
    const [lat, lon] = STADIUMS[g.home];
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&hourly=wind_speed_10m,temperature_2m,precipitation`
        + `&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=16`;
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      const hours = (data.hourly && data.hourly.time) || [];
      const hour = (g.gametime || "13:00").slice(0, 2);
      const stamp = `${g.gameday}T${hour}:00`;
      let idx = hours.indexOf(stamp);
      if (idx < 0) idx = hours.findIndex(t => t.startsWith(g.gameday));
      if (idx < 0) return;   // kickoff is beyond the forecast horizon
      const wind = Math.round(data.hourly.wind_speed_10m[idx]);
      const temp = Math.round(data.hourly.temperature_2m[idx]);
      const precip = data.hourly.precipitation[idx];
      for (const t of [g.home, g.away]) {
        if (byTeam[t]) { byTeam[t].wind = wind; byTeam[t].temp = temp; byTeam[t].precip = precip; }
      }
    } catch (e) { /* forecast is optional */ }
  }));

  await store.setJSON("game_context", {
    at: Date.now(), season, week,
    avgTeamTotal: Math.round(avgTeamTotal * 10) / 10,
    teams: byTeam,
  });

  const withWind = Object.values(byTeam).filter(t => t.wind != null).length;
  return new Response(JSON.stringify({
    ok: true, season, week, games: games.length,
    teams: Object.keys(byTeam).length,
    avgTeamTotal: Math.round(avgTeamTotal * 10) / 10,
    teamsWithWindForecast: withWind,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 12 * * *" };
