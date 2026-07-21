# The Ocho War Room (v14: the weaponized edition)

Consolidated from 13 tabs to 8, and turned four years of behavioral
data into an actual playbook.

## The restructure: 8 tabs, each a clear job

THE CALL (pinned, top)   your daily three: propose this trade, grab
                          this player, drop this player. Plus, in
                          season, a red LINEUP ALERT banner when a
                          starter is newly ruled out, with the pivot.
ROSTER                    your team, holes and surplus flagged.
RIVALS                    two views:
                          - EXPLOIT BOARD (new): every rival ranked by
                            how to beat them, from 4 years of behavior
                          - ROSTERS: position-by-position on each team
TRADES                    two views: trade ideas (visual cards), and
                          EVALUATE AN OFFER (paste one, get a verdict)
PICKUPS                   pickups and drops, plus sit/start
DRAFT (conditional)       live rookie board; refresh button pulls live
                          picks during the draft for best-available
STANDINGS                 three views: standings table, playoff odds
                          (Monte Carlo), and trends
DATA                      the full chart suite
INTEL                     ask anything, game plan, briefing, the wire

## The four new weapons

EXPLOIT BOARD (Rivals tab)
  Ranks every rival 0-100 on exploitability from dead starts (do they
  watch their bench), trade frequency (are they reachable), lineup
  efficiency, and scoring. For each: the read, who to send them (the
  position they hunt), and what to pry loose. owmyballs tops it (64
  dead starts); vic2252 bottoms it (sharp, never trades). This is the
  edge of playing the same 8 people for years, finally on a screen.

PREGAME LINEUP ALERT (pregame.mjs + The Call)
  On game days it sweeps your starters against breaking inactives and,
  if one is Out or Doubtful, pushes your phone the pivot to start
  instead. The cheapest wins in fantasy are the inactives nobody
  caught before kickoff.

LEAGUE MEMORY (memory.mjs)
  Mines every transaction across all seasons to learn who actually
  completes trades vs who just talks, who deals with whom, who churns
  their roster, and who sells at the deadline. Folded into every trade
  prompt so the AI knows how each owner really behaves.

LIVE DRAFT (Draft tab)
  A refresh button that pulls the live draft picks and recomputes
  best-available for your slot on the clock, not just the daily board.

## Pipeline (20 functions)

snapshot 2h | news hourly | scout hourly | stats daily | values
daily | analyze daily | draft daily | gameplan weekly | grade weekly
| memory weekly | pregame game-day sweeps | briefing Sunday. Plus
on-demand: evaluate, chat, draft-message, trigger, get-data,
claude (proxy), notify-test.

## Deploy

Same as before. Push to GitHub, import to Netlify, no build command.
Env vars: ANTHROPIC_API_KEY (required), NTFY_TOPIC (phone alerts,
now including the pregame lineup alert). Seed once by visiting:
  /.netlify/functions/snapshot
  /.netlify/functions/news
  /.netlify/functions/stats
  /.netlify/functions/values
  /.netlify/functions/memory
  /.netlify/functions/notify-test

## Cost

Exploit Board, lineup alerts, league memory, odds, all charts: free,
computed from data you already pull. AI runs a few cents to ~$0.25
each. Realistic: $12-40/month in season.
