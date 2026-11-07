# War Room V2

War Room answers one question first: **what lineup can I still legally set that gives me the best chance this week?**

The old full War Room remains at `/legacy.html` for reference. It is not the source of truth for V2.

## V2 architecture

- `netlify/functions/lineup.mjs` builds league-specific projections and the mathematically best legal lineup.
- `lineup-analysis.mjs` currently returns deterministic lineup explanations plus dated public RSS headlines. It does **not** independently verify stories or override lineup/roster calls.
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

## Front-office decision brief (draft branch)

A first screen above the original lineups now separates:

- **This week:** legal lineup changes with meaningful model edges, urgent injury deadlines, FLEX flexibility, and fresh league-verified acquisitions.
- **Roster and long game:** available RB depth and redundant kicker slots in redraft; potential TE trade capital in dynasty; current team state.
- **Evidence limits:** age of the free-agent scan, lineup/drop conflicts, ungraded reasoning claims, large disagreements with Sleeper, and the fact that RSS headlines are not automatically incorporated into moves.

The original lineup model, micro-matchup details, lineup history, pickups/trades, and news remain accessible. Micro-matchup details are collapsed by default, not removed.

**Hard gates:** never elevate a roster move above the fold when its free-agent scan is missing, refreshing, or stale; don't elevate drops of optimal starters; don't promote a zero-benefit stash as an urgent pickup; don't treat ungraded model confidence as measured success. Live-game mode suppresses stale pregame suggestions.

**Copy GM Dossier** exports a bounded, fact-labeled plaintext digest of the current selected league: starters, full roster, model and provider projections, actionable candidate data, current waiver/pick/team-state context, and caveats. It does not transmit data automatically or run a paid AI service. Paste it into your chosen research tool for further analysis.

## League-wide GM audit (draft branch)

`gm-audit.mjs` validates the selected Sleeper league and fetches all league
rosters, users, traded picks, completed matchups and trade transactions. It
also reads a cached roster-action scan when fresh. Each league is stored
independently in Netlify Blobs under `gm_audit_v1_<leagueId>`.

`lib/gm-audit-core.mjs` is pure and independently tested. It produces:

- PF and optimistic potential-points rankings; estimated standings, roster
  depth, active-player counts and injury designation flags
- All-play expected wins, all-play ranking, and schedule luck. Record
  comparison is omitted when completed weeks do not match actual games played
- All opponents' depth, scoring and observed completed trade participation
- Possible two-sided positional trade fits, clearly marked NOT OFFERS
- Only player-only packages already simulated by the existing trade model:
  player ownership and partner team are rechecked against current Sleeper
  rosters. Pick-inclusive trade packages are withheld pending verification
- Future rookie-pick holdings for dynasty, including traded origin
- Free-agent candidates cross-checked against current ownership and injury
  status. Stale scans are not represented as live opportunities

`gm-audit-ui.js` renders a mobile-friendly section beneath the main weekly
brief. The Copy GM Dossier button also includes league-wide audit findings.

### Forecast validation

`lib/gm-calibration.mjs` grades saved player projections **only when the saved
forecast timestamp predates that player's kickoff**. It uses actual Sleeper
league-scored player points. For player-weeks with at least two prior observed
results it calculates a preceding two-to-three-week mean baseline. Error
comparisons always use the **same player-weeks**. Displayed results include
MAE, bias, sample size, the most recent misses and an explicit
insufficient-evidence condition. **The scorecard does not silently alter
model weights or imply predictive superiority.**

### Still required

- Official date-specific injury and role reporting connected to individual
  moves. RSS headlines alone are not a medical source of truth.
- Independent provider/consensus benchmarks, matchup Brier scoring, and
  rolling out-of-sample validation beyond the trailing-average comparison.
- Independently defensible player and pick prices for true offer construction,
  and confirmed partner incentives. Positional fits are not valuations.
- A complete remaining-season schedule and playoff model, accurate future
  lock/waiver timing, and deeper contingency planning.
- More frequent revalidation of ownership and player statuses during games.

No Sleeper transactions are performed, no paid AI is invoked and old detailed
matchup and roster components remain. They are collapsed or reordered, not
deleted. The old README claim that public RSS could override V2 lineup
judgment was changed because the currently shipped module is deterministic.

