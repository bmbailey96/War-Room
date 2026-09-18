# War Room V2 rules

War Room exists to make weekly fantasy decisions. The engine can be deep; the front page should not be.

## Separate jobs
1. **Projection engine** produces inspectable point estimates from football data.
2. **Reasoning layer** checks current reporting for information the arithmetic cannot know.
3. **Learner** grades frozen pre-kickoff beliefs against actual league-scored outcomes.

Do not let one layer silently rewrite another.

## League isolation
- V2 state lives in `war-room-v2`.
- Every learned model, analysis, and projection snapshot is keyed by Sleeper league ID.
- Never share calibration between leagues.
- Always use the selected league's scoring settings and roster positions.

## Lineup locks
Once an NFL game starts:
- a starter remains in that occupied lineup slot;
- a bench player is no longer an option;
- actual Sleeper league points replace projection for matchup math;
- pre-kickoff training records are never overwritten after lock.

No recommendation may require time travel.

## Projection hierarchy
For QB/RB/WR/TE:
- actual recent production and workload;
- prior-season baseline when the current sample is small;
- league scoring rules;
- learned per-position baseline correction;
- learned role/workload, matchup, and scoring-environment weights;
- injury status.

Sleeper projection is a comparison/fallback, not the base model.

For K/DEF/IDP, provider fallback is allowed until there is enough data to build a model honestly. Re-score the provider stat line under the selected league's rules.

## Reasoning
Current news can override arithmetic only for concrete dated evidence:
- injury or snap limitation
- role/depth-chart change
- scheme change
- weather
- inactive news

Generic matchup takes, reputation, or consensus rankings do not override a meaningful projection gap.
Matchup posture (floor vs ceiling) is only a tiebreak when players are within 1.5 projected points.

Every reasoning call tags its drivers. Tuesday grades those drivers against actual outcomes.

## Learning
Learn from outcomes, not from the model agreeing with itself.
- Fit position bias separately.
- Then fit role, matchup, and environment weights.
- Shrink early samples toward defaults.
- Track reasoning-driver hit rates separately.

## UI
The primary page should answer, in this order:
1. What do I change?
2. What can I no longer change?
3. What is my best legal lineup?
4. What should I watch before kickoff?

The legacy cockpit can exist at `/legacy.html`. Do not move its tabs back onto the front page.


## Frozen training boundary
- Opening or refreshing the website must never change the learner's training record.
- `lineup` is a read/compute endpoint. Its live output is not historical truth.
- Only the scheduled pregame refresh may freeze projection and reasoning snapshots.
- Once either player in a start/sit decision is locked, later refreshes cannot rewrite that decision.
- Live AI-analysis cache is UI-only and is never graded.
