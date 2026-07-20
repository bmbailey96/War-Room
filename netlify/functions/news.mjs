// Runs hourly. Harvests a battery of NFL news feeds, scores every item
// for relevance against the league's actual rosters (my players highest,
// league-rostered next, trending next, team-level news after that),
// dedupes, and keeps a rolling 72h digest.
//
// About Schefter: X's API is paid and scraping it breaks. But his and
// Rapoport's breaks propagate to r/nfl within minutes (usually as direct
// tweet links) and to ESPN/PFT feeds right behind. This captures the
// content stream without the platform.

import { blobs } from "./lib/ocho.mjs";

const FEEDS = [
  { name: "ProFootballTalk", url: "https://profootballtalk.nbcsports.com/feed/", type: "rss" },
  { name: "Yahoo NFL", url: "https://sports.yahoo.com/nfl/rss.xml", type: "rss" },
  { name: "CBS NFL", url: "https://www.cbssports.com/rss/headlines/nfl/", type: "rss" },
  { name: "Rotowire", url: "https://www.rotowire.com/rss/news.php?sport=NFL", type: "rss" },
  { name: "ESPN NFL", url: "https://www.espn.com/espn/rss/nfl/news", type: "rss" },
  // Reddit public JSON: works from most server IPs with a real UA.
  // Fails gracefully if their datacenter-IP filtering kicks in.
  { name: "r/nfl", url: "https://www.reddit.com/r/nfl/new.json?limit=40", type: "reddit" },
  { name: "r/fantasyfootball", url: "https://www.reddit.com/r/fantasyfootball/new.json?limit=40", type: "reddit" },
];

const UA = "OchoWarRoom/1.0 (dynasty league tool; contact via league)";

const TEAM_WORDS = {
  ARI:["cardinals","arizona"],ATL:["falcons","atlanta"],BAL:["ravens","baltimore"],BUF:["bills","buffalo"],
  CAR:["panthers","carolina"],CHI:["bears","chicago"],CIN:["bengals","cincinnati"],CLE:["browns","cleveland"],
  DAL:["cowboys","dallas"],DEN:["broncos","denver"],DET:["lions","detroit"],GB:["packers","green bay"],
  HOU:["texans","houston"],IND:["colts","indianapolis"],JAX:["jaguars","jacksonville"],KC:["chiefs","kansas city"],
  LV:["raiders","las vegas"],LAC:["chargers"],LAR:["rams"],MIA:["dolphins","miami"],MIN:["vikings","minnesota"],
  NE:["patriots","new england"],NO:["saints","new orleans"],NYG:["giants"],NYJ:["jets"],PHI:["eagles","philadelphia"],
  PIT:["steelers","pittsburgh"],SEA:["seahawks","seattle"],SF:["49ers","niners","san francisco"],TB:["buccaneers","tampa"],
  TEN:["titans","tennessee"],WAS:["commanders","washington"],
};

function stripTags(s) {
  return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

// Dependency-free RSS item extraction. Not a full XML parser; good enough
// for title/link/pubDate/description from mainstream feeds.
function parseRss(xml) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/).slice(1);
  for (const chunk of chunks.slice(0, 50)) {
    const grab = tag => {
      const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? stripTags(m[1]) : "";
    };
    const linkM = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    items.push({
      title: grab("title"),
      link: linkM ? stripTags(linkM[1]) : "",
      desc: grab("description").slice(0, 400),
      at: Date.parse(grab("pubDate")) || Date.now(),
    });
  }
  return items.filter(i => i.title);
}

function parseReddit(json, srcName) {
  try {
    const data = JSON.parse(json);
    return (data.data.children || []).map(c => ({
      title: c.data.title || "",
      link: "https://reddit.com" + (c.data.permalink || ""),
      desc: (c.data.selftext || c.data.url || "").slice(0, 300),
      at: (c.data.created_utc || 0) * 1000,
      upvotes: c.data.ups || 0,
    })).filter(i => i.title);
  } catch (e) { return []; }
}

export default async () => {
  const store = blobs();
  const snapshot = await store.get("snapshot", { type: "json" });

  // Build the relevance dictionary from live league state
  const myNames = [], leagueNames = [];
  if (snapshot) {
    for (const t of snapshot.teams) {
      for (const p of t.players) {
        if (!p.name || p.name.length < 5) continue;
        (t.isMe ? myNames : leagueNames).push(p.name.toLowerCase());
      }
    }
  }
  const trendingRaw = (await store.get("trending_raw", { type: "json" })) || [];
  // trending names come through the snapshot pipeline as pids; resolve from players blob
  const playersTrim = ((await store.get("players_trim", { type: "json" })) || {}).d || {};
  const trendingNames = trendingRaw.map(t => (playersTrim[t.player_id] || {}).n).filter(Boolean).map(n => n.toLowerCase());

  const results = await Promise.allSettled(FEEDS.map(async f => {
    const res = await fetch(f.url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow" });
    if (!res.ok) throw new Error(`${f.name} ${res.status}`);
    const body = await res.text();
    const items = f.type === "reddit" ? parseReddit(body, f.name) : parseRss(body);
    return items.map(i => ({ ...i, source: f.name }));
  }));

  const harvested = [];
  const sourceStatus = {};
  results.forEach((r, i) => {
    sourceStatus[FEEDS[i].name] = r.status === "fulfilled" ? `ok (${r.value.length})` : `failed: ${r.reason.message}`;
    if (r.status === "fulfilled") harvested.push(...r.value);
  });

  // Score relevance
  const scored = harvested.map(item => {
    const text = (item.title + " " + item.desc).toLowerCase();
    const matched = { mine: [], league: [], trending: [], teams: [] };
    for (const n of myNames) if (text.includes(n)) matched.mine.push(n);
    for (const n of leagueNames) if (text.includes(n)) matched.league.push(n);
    for (const n of trendingNames) if (text.includes(n)) matched.trending.push(n);
    for (const [abbr, words] of Object.entries(TEAM_WORDS)) {
      if (words.some(w => text.includes(w))) matched.teams.push(abbr);
    }
    let score = 0;
    score += matched.mine.length * 100;
    score += matched.league.length * 40;
    score += matched.trending.length * 25;
    score += Math.min(matched.teams.length, 2) * 5;
    // breaking-news words bump
    if (/\b(injur|out for|placed on ir|torn|surgery|suspend|sign|trade[ds]?|released|waived|activated|carted|questionable|doubtful|benched|starting|named starter|fired|hired|coordinator)\b/.test(text)) score += 15;
    if (item.upvotes) score += Math.min(item.upvotes / 100, 20);
    return { ...item, score: Math.round(score), matched };
  });

  // Merge with previous digest, dedupe by title, keep 72h, cap 150 items
  const prev = (await store.get("news_digest", { type: "json" })) || { items: [] };
  const cutoff = Date.now() - 1000 * 60 * 60 * 72;
  const byTitle = new Map();
  for (const item of [...prev.items, ...scored]) {
    if (item.at < cutoff) continue;
    const key = item.title.toLowerCase().slice(0, 80);
    const existing = byTitle.get(key);
    if (!existing || item.score > existing.score) byTitle.set(key, item);
  }
  const merged = [...byTitle.values()].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, 150);

  await store.setJSON("news_digest", { at: Date.now(), sourceStatus, items: merged });

  return new Response(JSON.stringify({
    ok: true, harvested: harvested.length, kept: merged.length, sourceStatus,
  }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "15 * * * *" };
