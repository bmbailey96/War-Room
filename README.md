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
