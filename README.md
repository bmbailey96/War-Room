# The Ocho War Room

Live dynasty intelligence app for the Sleeper league "The Ocho."
Four tabs: Roster Holes, Trades, Pickups, Sit/Start.

## How the data works

Three layers, three refresh speeds:

1. LIVE, every pull: rosters, records, traded picks, trending adds,
   NFL season state. Fetched from Sleeper's public API (no key needed,
   CORS is open) every time you press Pull Live Data. Holes, surplus,
   stance, and the future pick ledger are computed on this fresh data,
   so they update the moment any owner makes a move.

2. CACHED: the NFL player database (14MB raw, trimmed and cached
   locally, refreshed when older than 20 hours) and the owner history
   block (career trade tendencies from 4 seasons of league history,
   embedded in the code, refresh after each season).

3. ON-DEMAND: the Trades / Pickups / Sit-Start analysis. Each run
   sends the live league context to Claude with web search turned on,
   so the answer is grounded in that day's news, injuries, depth
   charts, and coaching situations. Nothing is pre-baked.

## Deploying to Netlify (same flow as your other apps)

1. Get an Anthropic API key at console.anthropic.com
   (Settings > API keys > Create key). Web search on the API is
   billed per search on top of tokens; a typical analysis run does
   3 to 8 searches.

2. Push this folder to a GitHub repo (or drag-drop the folder into
   Netlify, but repo is better since you'll iterate):
   - index.html
   - netlify.toml
   - netlify/functions/claude.mjs

3. In Netlify: Add new site > Import from GitHub > pick the repo.
   Build settings are already in netlify.toml, no build command needed.

4. Site settings > Environment variables > add:
   ANTHROPIC_API_KEY = your key

5. Deploy. Done. The app auto-detects its environment: inside a
   Claude artifact it calls the API directly with no key; on your
   Netlify site it routes through the function so the key stays
   server-side.

## Maintenance

- After each league season ends: re-run the history pull to update
  the OWNER_HISTORY block in index.html (career trades, tendencies,
  titles). Everything else self-updates.
- The league is auto-resolved by name each pull, so when Sleeper
  rolls the league into a new season, the app follows it without a
  code change. FALLBACK_LEAGUE_ID is the safety net.
