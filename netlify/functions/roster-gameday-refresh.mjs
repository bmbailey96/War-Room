// Extra core-only roster refreshes on NFL game days.
// Reuses the deterministic roster board builder and spends no Anthropic credits.

import refresh from "./roster-refresh.mjs";

export default refresh;

// Monday/Thursday pulse. Sunday has its own denser refresh functions.
export const config={schedule:"15 16,19,22 * * 1,4"};
