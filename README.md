# The Ocho War Room (v19: the draft watch board)

## New in v19: a real draft tab for the startup

The Draft tab (hidden until the league goes pre-draft, then it appears
on its own) is rebuilt for the STARTUP draft, not a rookie draft. When
Matt opens the new Ocho and the draft room is up, this becomes your
watch board.

WHAT IT DOES
  - Builds a best-available board from real dynasty values (all skill
    players ranked 0-100), so you are looking at a true big board.
  - Weights it lightly toward what your roster still needs as you draft:
    positions you have not touched get nudged up, positions you have
    stocked fade slightly. Early on it is basically pure value; as you
    fill out, it leans toward your holes.
  - Removes anyone already drafted, live. Hit "Refresh board" after
    picks go off the board and the drafted players drop out.
  - Gives a short strategic read: the 2-3 names to queue right now,
    the one position to prioritize before it dries up, and one name
    likely to fall that is worth waiting on.

HOW YOU USE IT
  Open the Draft tab in the draft room. Queue from the top down. After
  a run of picks, tap Refresh to pull the updated board. The read tells
  you who to line up next given what you already have.

  No web search on this path, so it is fast and will not time out. It
  runs from the daily-refreshed values plus the live draft state.

## The 8 tabs

The Call (pinned) / Roster / Rivals / Trades / Pickups / Draft
(appears during the draft) / Standings / Data / Intel.

## Deploy

Same as before. Env: ANTHROPIC_API_KEY (required), NTFY_TOPIC
(optional). Seed once: snapshot, news, stats, values, memory,
notify-test. The draft tab activates automatically when the league
status is pre_draft or drafting, no setup needed.
