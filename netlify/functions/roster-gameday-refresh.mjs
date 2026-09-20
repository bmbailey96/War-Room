// Extra core-only roster refreshes on NFL game days.
// Reuses the deterministic roster board builder and spends no Anthropic credits.

import refresh from "./roster-refresh.mjs";

export default refresh;

// 10:15 AM, 1:15 PM and 4:15 PM Mountain during MDT, roughly aligned
// with pregame / early / late windows. Also runs Mon/Thu for game-day changes.
export const config={schedule:"15 16,19,22 * * 0,1,4"};
