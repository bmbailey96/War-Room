# The Ocho War Room (v13: the daily three)

THE CALL, at the top of the app, is now your fixed daily briefing:
three moves, always the same three slots, always visible.
  - PROPOSE THIS TRADE: the one trade to send right now, with a
    "Draft the message" button that writes the exact proposal.
  - GRAB THIS PLAYER: the single best pickup available.
  - DROP THIS PLAYER: the single best cut to make room.
When a slot has no worthwhile move it says so ("hold your roster",
"pool is thin") instead of forcing a bad one. The trade and pickup
slots refresh from your latest Trades and Pickups runs.

## All tabs

Roster Holes, Teams, Trades, Pickups, Sit/Start, Draft Room
(conditional), Standings, Odds, Game Plan, Data, Trends, Ask,
Briefing, The Wire.

## Pipeline (17 functions)

snapshot 2h | news hourly :15 | scout hourly :25 | stats daily |
values daily :45 | analyze daily 13:00 UTC | draft daily | gameplan
weekly Mon | grade weekly Tue | briefing Sunday night. On-demand:
evaluate, chat, draft-message, trigger, get-data, notify-test.

## Deploy

1. API key: console.anthropic.com > Settings > API keys.
2. Push this folder to GitHub, structure preserved.
3. Netlify > Add new site > Import from GitHub. No build command.
4. Env vars: ANTHROPIC_API_KEY (required), NTFY_TOPIC (phone pushes).
5. Deploy, seed by visiting once each:
     /.netlify/functions/snapshot
     /.netlify/functions/news
     /.netlify/functions/stats
     /.netlify/functions/values
     /.netlify/functions/notify-test
6. Open the site. Run Trades and Pickups once to fill The Call's
   three slots.

## Cost

Free data + charts + Odds sim. AI runs a few cents to ~$0.25 each.
Realistic: $12-40/month in season.

## Season maintenance

Each offseason: rerun the behavior mine + history pull, refresh
OWNER_HISTORY in lib/ocho.mjs and index.html. Everything else
self-updates.
