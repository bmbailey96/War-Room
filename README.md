# War Room V2

War Room answers one question first: **what lineup can I still legally set that gives me the best chance this week?**

The old full War Room remains at `/legacy.html` for reference. It is not the source of truth for V2.

## V2 architecture

- `netlify/functions/lineup.mjs` builds league-specific projections and the mathematically best legal lineup.
- `lineup-analysis.mjs` is the live-news judgment layer. It may override a close numerical call only for concrete current evidence.
- `lineup-refresh.mjs` snapshots both leagues before games so learning happens even if the site is never opened.
- `learn.mjs` grades completed weeks every Tuesday and updates each league independently.
- V2 state lives only in the Netlify Blob store `war-room-v2`.
- Legacy scheduled jobs are disabled.

## Projection hierarchy

For QB/RB/WR/TE the point estimate is built from actual nflverse production and role data, not from Sleeper's projection:

1. weighted recent production
2. prior-season baseline when the current sample is small
3. learned position calibration
4. workload/role change, including WOPR and offensive snap share
5. recent team pass/run scheme movement
6. opponent allowance by position
7. game scoring environment
8. injury status

Sleeper is retained as a visible fallback for thin/missing data and for positions V2 does not yet model well (K/DEF/IDP).

All scoring is recalculated using the selected Sleeper league's own scoring settings.

## Game locks

NFL kickoff is a hard boundary.

- A starter whose game has begun stays fixed in that slot.
- A bench player whose game has begun is unavailable.
- Locked players use actual league-scored points, not stale projections.
- The UI surfaces locked bench points under **Already Happened** instead of recommending impossible moves.

## Learning

Learning is explicit, per league, and outcome-based.

Every Tuesday the engine compares the last genuinely pre-kickoff forecast with actual Sleeper points. It separately learns how much to trust:

- role/workload
- recent scheme movement
- matchup
- scoring environment
- position-level baseline calibration

The reasoning layer separately grades the drivers behind start/sit overrides:

- injury
- role
- depth chart
- scheme
- weather
- matchup
- projection-only

A later in-game refresh cannot rewrite history. The learner grades the last recommendation that existed before either player kicked off.

Early samples are shrunk toward conservative defaults so one weird week cannot rewrite the model.

## Interface

The root page is deliberately small:

- league selector
- The Call
- legal start/sit changes
- already-locked results
- best legal lineup
- pre-kickoff watch items
- a compact view of what the engine has learned

The old multi-tab interface remains at `/legacy.html`.

## Public news (no API keys or paid AI)

The current board uses CBS Sports, Yahoo Sports, and RotoWire public RSS feeds.
`news-refresh` refreshes the shared feed cache every 30 minutes; opening the board
also refreshes a cache older than 15 minutes. Failed sources retry after two minutes.
Each source has a seven-second timeout. Cached reports from failed sources are
marked, and articles without valid dates or older than 72 hours are excluded.
Full-name matches are filtered against the selected league's roster and shown with
publisher, publication date, and a source link. Coverage is limited to those feeds;
no matching headlines is not an all-clear on player health.

The lineup and roster workflows make no paid AI calls. Public headlines never
create lineup overrides or reasoning-training samples. Existing structured injury
and game-lock data still govern lineup legality. The older legacy cockpit remains
separate and can contain Anthropic-dependent tools.

## Front-office decision brief (proposed)

A first screen above the original lineups now separates:

- **This week:** legal lineup changes with meaningful model edges, urgent injury deadlines, FLEX flexibility, and fresh league-verified acquisitions.
- **Roster and long game:** available RB depth and redundant kicker slots in redraft; potential TE trade capital in dynasty; current team state.
- **Evidence limits:** age of the free-agent scan, lineup/drop conflicts, ungraded reasoning claims, large disagreements with Sleeper, and the fact that RSS headlines are not automatically incorporated into moves.

The original lineup model, micro-matchup details, lineup history, pickups/trades, and news remain accessible. Micro-matchup details are collapsed by default, not removed.

**Hard gates:** never elevate a roster move above the fold when its free-agent scan is missing, refreshing, or stale; don't elevate drops of optimal starters; don't promote a zero-benefit stash as an urgent pickup; don't treat ungraded model confidence as measured success. Live-game mode suppresses stale pregame suggestions.

**Copy GM Dossier** exports a bounded, fact-labeled plaintext digest of the current selected league: starters, full roster, model and provider projections, actionable candidate data, current waiver/pick/team-state context, and caveats. It does not transmit data automatically or run a paid AI service. Paste it into your chosen research tool for further analysis.

### Still needed for a truly deep audit

- A dedicated league-wide review of opposing rosters, manager willingness to trade, draft-pick ledger, and free-agent replacement value across the next several weeks.
- Validated external injury/role reporting linked to each proposed transaction, with article date and source, not merely RSS headline matching.
- Calibration against hold/consensus/provider baselines (MAE/Brier by league and position), with explicit sample sizes and rollback when a feature underperforms.
- Trade simulations showing *both* teams' starter deltas, dynasty asset deltas and remaining pick value. Do not manufacture a trade recommendation just because the model lists a trade target.

This first PR focuses on avoiding confident bad actions and putting the useful facts first. The larger scouting system is separate work, not something this change pretends to solve.
