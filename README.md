# The Ocho War Room (v21: dead-simple draft tab)

## What changed

The Draft tab is stripped down to one job: tell you who to draft.

WHAT YOU SEE, top to bottom:
  1. DRAFT THIS GUY. One big name, the best pick for you right now.
     Position, age, team, value. That is the answer.
  2. If he is gone, take the next one down. Four backups, small.
  3. A one-line flash when someone drafts (who went, who is best now).
  4. Everything else (your roster so far, the strategy read, the full
     40-deep board) is tucked behind "show" toggles. There if you want
     to study, out of the way if you just need the pick.

Turn on "Watch live" during the draft and the big name updates itself
the moment someone picks. You do not have to look at the Sleeper draft
board at all. Just watch the one name.

See draft-tab-preview.html (or the screenshot) for exactly how it looks.

## The 8 tabs

The Call (pinned) / Roster / Rivals / Trades / Pickups / Draft (the
simple one) / Standings / Data / Intel.

## Deploy

Same as before. Env: ANTHROPIC_API_KEY (required), NTFY_TOPIC
(optional). Seed once: snapshot, news, stats, values, memory,
notify-test.
