# The Ocho War Room (v10: reasoning edition)

Theme: ONE MOVE. Every analysis ends in "## THE MOVE"; the freshest sits
in The Call banner. v10 makes it reason across time and talk back.

## New in v10

TREND ENGINE (Trends tab)
  The snapshot function now archives one datapoint per team per day
  (roster shape, depth by position, injury count, picks, seed). A
  "what's changed in the last ~7 days" block is computed and fed into
  EVERY analysis, so the engine weighs momentum, not just the static
  picture. A rising snap share or a team quietly stockpiling RBs now
  changes the advice. The Trends tab shows the deltas, color-coded.

TRADE EVALUATOR (Ask tab, top)
  The missing half of your trade game. Paste a trade someone offered
  you, in plain language ("Birkey offers Jeanty for Aiyuk and my 2026
  1st"), and it grades accept / decline / counter, renders it as the
  same visual trade card, and gives you the EXACT counter to send back.

ASK ANYTHING (Ask tab, bottom)
  A chat box with full context: your roster, the whole league, owner
  tendencies, the news wire, trends, and the grading record. Ask
  "should I worry about McCaffrey's age" or "who on Birkey's team is
  actually gettable" and get a grounded answer on demand, no waiting
  for a scheduled run. Keeps short conversation memory for follow-ups.

## All tabs

Roster Holes, Teams, Trades, Pickups, Sit/Start, Draft Room
(conditional), Standings, Data, Trends, Ask, Briefing, The Wire.

## Pipeline (16 functions)

snapshot 2h (now also archives trends) | news hourly :15 | scout
hourly :25 | stats daily | analyze daily 13:00 UTC | draft daily
(self-gates) | grade weekly Tue | briefing Sunday night. On-demand:
trigger, evaluate, chat, draft-message, get-data, notify-test.

## Deploy

1. API key: console.anthropic.com > Settings > API keys.
2. Push this folder to GitHub, structure preserved.
3. Netlify > Add new site > Import from GitHub. No build command.
4. Env vars: ANTHROPIC_API_KEY (required), NTFY_TOPIC (phone pushes).
5. Deploy, seed by visiting once each:
     /.netlify/functions/snapshot
     /.netlify/functions/news
     /.netlify/functions/stats
     /.netlify/functions/notify-test
6. Open the site. Trends fills in after 2+ days of history; the Ask
   tab works immediately.

## Cost

Free: Sleeper, RSS, Reddit, nflverse, ntfy, charts, trends storage,
standings, grading. AI runs a few cents to ~$0.25 each; chat and
evaluator are per-question, only when you use them. Realistic:
$12-40/month in season depending on how much you chat.

## Season maintenance

Each offseason: rerun the behavior mine + history pull, refresh
OWNER_HISTORY in lib/ocho.mjs and index.html. Trend history builds
itself. Everything else self-updates.
