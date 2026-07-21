# The Ocho War Room (v17: paste a trade)

## New in v17

PASTE A TRADE SCREENSHOT
  In the Trades tab under "Evaluate an Offer," the evaluate box now
  takes a pasted image directly. Screenshot the Sleeper trade block,
  click the box, and paste (Ctrl or Cmd V). It reads the terms
  (players, picks with year and round, the other manager from the
  From/To labels), shows you what it read, and immediately grades the
  deal as a visual trade card with accept / decline / counter and the
  exact counter to send. No typing, no file picker.

  The "upload a file" button is still there as a fallback, but paste
  is the main path now. If you paste plain text instead of an image,
  it just fills the box normally.

Everything else unchanged from v16/v15 (rebuilt valuation engine with
real pick values, per-type grading, shared league state, elite
reasoning prompts, screenshot reader).

## The 8 tabs

The Call (pinned) / Roster / Rivals / Trades / Pickups / Draft
(conditional) / Standings / Data / Intel.

## Deploy

Same as before. Env: ANTHROPIC_API_KEY (required), NTFY_TOPIC
(optional). Seed once: snapshot, news, stats, values, memory,
notify-test. Paste needs no extra setup.
