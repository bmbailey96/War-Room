// Sunday deterministic roster-market pulse. No Anthropic usage.
import refresh from "./roster-refresh.mjs";
export default refresh;

// 15:00-23:59 UTC Sunday, every 10 minutes.
export const config={schedule:"*/10 15-23 * * 0"};
