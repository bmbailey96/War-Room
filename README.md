# The Ocho War Room (v6: the directive edition)

Theme of the whole machine: ONE MOVE. Every analysis ends with
"## THE MOVE", a single directive chosen to win now and in the
future, and the freshest one sits in an amber banner at the top of
the app: The Call. No menus of options. One thing to do.

## Tabs

ROSTER HOLES  live survey, holes/surplus/stance per team
TEAMS         the book: every roster position by position, age-coded
              chips, pick capital, owner behavior flags, plus the AI
              intel report (untouchables, gettable players, the ask,
              their angle) auto-refreshed weekly on Mondays
TRADES        directive-first trade analysis (daily + trade-triggered)
PICKUPS       directive-first waiver analysis (daily)
SIT / START   weekly lineup calls in season; roster stress test off
DATA          charts: lineup efficiency, career avg score, dead
              starts, future pick capital, bench leakage, roster age.
              Your team highlighted in amber on every chart.
THE WIRE      hourly harvested + relevance-scored NFL headlines

## Always-on pipeline

snapshot.mjs   every 2h: league watch, transaction diff, trade ->
               instant analysis + phone push
news.mjs       hourly :15: 7-source wire harvest, roster-scored
scout.mjs      hourly :25: action scout, pushes GRAB/CUT/DEAL/INJ
               only when new signal demands action, 48h cooldown
stats.mjs      daily: nflverse team tendencies, injuries, snaps
analyze.mjs    daily 13:00 UTC -> analyze-background.mjs: trades +
               pickups daily, sit/start Thu/Sat/Sun in season +
               Mondays offseason, team intel book Mondays, all with
               memory of their own last 3 calls, all ending in
               THE MOVE

## New league rollover (the 2026 Ocho)

Nothing to do. The league resolves BY NAME on every single pull, so
the moment the new league exists under your account, the whole
system follows it: watcher, wire scoring, analyses, everything. The
context block carries league status, so when the new league is
pre_draft the analyses automatically factor rookie draft prep into
THE MOVE.

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
6. Open the site. Run Team Intel Scout for your first book.

## Cost

Free: Sleeper, RSS, Reddit, nflverse, ntfy, charts, silent scout
hours. AI: a few cents to ~$0.25 per Sonnet run (teams intel is the
longest); Haiku scout decisions are fractions of a cent. Realistic:
$12-35/month in season with the weekly intel book.

## Season maintenance

Each offseason: rerun the behavior mine + history pull, refresh
OWNER_HISTORY in lib/ocho.mjs and index.html. Everything else
self-updates.
