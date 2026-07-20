# The Ocho War Room (full intelligence edition, v4)

Always-on dynasty engine. Watches the league, harvests the NFL wire,
pulls structured analytics, mines owner behavior, remembers its own
calls, reacts to trades instantly, and pushes to your phone.

## The intelligence pipeline

LAYER 1: LEAGUE WATCHER (snapshot.mjs, every 2 hours)
  Full Sleeper pull, roster survey, transaction diff, change feed.
  NEW in v4: when a TRADE is detected it immediately fires a fresh
  trades analysis instead of waiting for the morning run, and sends
  a push notification to your phone.

LAYER 2: NEWS WIRE (news.mjs, hourly at :15)
  PFT, Yahoo NFL, CBS NFL, Rotowire, ESPN, r/nfl, r/fantasyfootball.
  Scored against live league rosters (your players 100, league 40,
  trending 25, breaking-news term bumps). 72h rolling digest, Wire tab.
  Schefter/Rapoport breaks arrive via r/nfl + ESPN/PFT propagation;
  X's API is paywalled so we capture the stream, not the platform.
  Reddit sometimes blocks datacenter IPs; fails gracefully.

LAYER 3: HARD NUMBERS (stats.mjs, daily 11:30 UTC)
  nflverse: per-team pass rate, plays/game, pass/rush EPA, sacks
  allowed; official injury reports for league-rostered players; snap
  trends for your players. Offseason uses latest completed season,
  labeled; sharpens automatically when camp data goes live.

LAYER 4: OWNER BEHAVIOR DEEP-MINE (baked into lib/ocho.mjs, v4)
  Computed from four seasons of per-player scoring data:
  - lineup efficiency (actual vs optimal lineup, every week, 4 years)
  - avg points left on bench per week
  - dead starts: started a <=0 pt player with a 5+ pt bench option
    (owmyballs: 64 of these; the signature of an inattentive owner)
  - trade rest-of-season net points (caveat baked into the prompt:
    picks score 0, so pick-acquirers look artificially bad)
  Raw numbers in owner_behavior_metrics.json. Refresh each offseason.

LAYER 5: ANALYSIS with MEMORY (analyze-background.mjs)
  Every run gets: live league context + behavior metrics + news digest
  + nflverse numbers + its own live web searches, AND its own last 3
  recommendations, with orders to state which prior calls still stand,
  which are now stale or wrong, and never repeat old advice as new.
  Push notification when a fresh analysis is ready.

## Deploy

1. API key: console.anthropic.com > Settings > API keys.
2. Push this folder to GitHub, exact structure preserved.
3. Netlify > Add new site > Import from GitHub. No build command.
4. Environment variables:
     ANTHROPIC_API_KEY = your key            (required)
     NTFY_TOPIC = some-hard-to-guess-string  (optional, phone pushes)
   For pushes: install the ntfy app (free, iOS/Android), subscribe to
   the exact topic string you chose. No account needed. Anyone who
   knows the topic string can read it, so make it long and random.
5. Deploy, then visit once each to seed instead of waiting for crons:
     /.netlify/functions/snapshot
     /.netlify/functions/news
     /.netlify/functions/stats
6. Open the site. Wire + Roster Holes populate immediately; hit any
   analysis button for the first AI run.

## Cost

Sleeper, RSS, Reddit, nflverse, ntfy: free, always running.
AI: a few cents to ~$0.25 per analysis run. Default schedule plus
trade-triggered runs lands roughly $10-30/month. Cron lines at the
bottom of snapshot.mjs / news.mjs / stats.mjs / analyze.mjs.

## Season maintenance

- Each offseason: rerun the behavior mine and history pull, refresh
  OWNER_HISTORY in lib/ocho.mjs and index.html.
- Everything else self-updates: league ID by name, nflverse season
  rollover, news scoring dictionary rebuilt hourly from the snapshot.
