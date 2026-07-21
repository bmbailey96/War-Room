# The Ocho War Room (v18: reliability fix)

## What this fixes

THE "Unexpected token '<'" ERROR on the trade evaluator (and chat)
  Root cause: the evaluate and chat functions ran the AI WITH web
  search on the deployed site. Web-search calls take 30-90s, but
  Netlify sync functions time out around 10-26s, so the function
  returned an HTML timeout page and the app crashed trying to read it
  as JSON.

  Fixes:
  - Server evaluate and chat now run WITHOUT web search, so they
    finish well inside the function window. They still have full
    context (your roster, market values, league state, trends), so
    the grade is strong without a live search.
  - The frontend now checks the response is real JSON before parsing,
    and if the function fails for any reason it falls back to a direct
    AI call instead of crashing. Same guard added to chat, the trade
    message drafter, and the screenshot path.

Net effect: pasting or uploading a trade screenshot and grading it now
works reliably on the deployed site. If the dedicated function ever
hiccups, you get an answer anyway instead of an error.

## The 8 tabs

The Call (pinned) / Roster / Rivals / Trades / Pickups / Draft
(conditional) / Standings / Data / Intel.

## Deploy

Same as before. Env: ANTHROPIC_API_KEY (required), NTFY_TOPIC
(optional). Seed once: snapshot, news, stats, values, memory,
notify-test.

## Note on live values

The evaluator no longer web-searches on the deployed path, so it
grades from the daily-refreshed market values (values.mjs) plus your
league context rather than a live lookup at grade time. Those values
refresh daily, so they are current within a day. If you want a
live-searched second opinion on a specific player, ask in the Intel
tab.
