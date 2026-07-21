# The Ocho War Room (v24: confidence, foresight, and a stress test)

## Three things in this build

1. CONFIDENCE AND SOURCING on the evaluator and chat
   The trade evaluator now ends every verdict with a "HOW SURE I AM"
   section: its confidence level and the biggest reason for it, what
   specifically it based the call on (values as of their date, your
   roster, age curve, scarcity), and the one piece of new info that
   would flip the verdict, so you know what to watch. It also tells you
   its data is from the daily value snapshot, not a live lookup, when
   that matters.
   The chat now closes real judgment calls with a one-line read:
   "<confidence>, based on <main driver>; would change if <the thing
   that flips it>." You can tell when it is sure and when it is
   guessing.

2. THE DRAFT BRAIN NOW THINKS AHEAD
   It computes how many picks until your next turn (correct snake-draft
   math, verified for all 8 slots) and reasons about which positional
   tiers will survive that gap. So instead of just "best guy now," it
   tells you "take the RB now, the WR tier will still be there at your
   next pick but the RB tier will not." That is real draft strategy.
   Rookies with no listed age are now flagged as young/high-upside so
   they are not undervalued.

3. STRESS TEST (dev only, not shipped in the app)
   Before shipping, the whole in-season path was run against a
   simulated live Sunday: an injured starter, the pregame pivot logic,
   alert dedup, no-healthy-backup handling, tricky player-name
   matching, the grading loop scoring a past call, and the draft
   look-ahead math at every slot. 19 checks, all passing. The one
   thing it surfaced (rookies not flagged as young) is fixed above.
   This is why it now handles a real game week without surprises.

## The 8 tabs

The Call (pinned) / Roster / Rivals / Trades / Pickups / Draft /
Standings / Data / Intel.

## Deploy

Same as before. Env: ANTHROPIC_API_KEY (required), NTFY_TOPIC
(optional). Seed once: snapshot, news, stats, values, memory,
notify-test.
