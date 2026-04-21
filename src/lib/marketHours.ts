// Single source of truth for "is the US equity options market open RIGHT NOW".
// Used to switch the scanner between PREVIEW (watchlist-only) and LIVE (full
// score + selector) modes, and to relax freshness/trigger checks when the
// market is closed so the scanner can still surface picks based on EOD data.
//
// NYSE regular hours: 9:30 AM – 4:00 PM America/New_York, Mon–Fri.
// Extended sessions: 4:00–9:30 AM (pre) and 4:00–8:00 PM (after-hours).
// We intentionally ignore half-days and exchange holidays here.

function nowEt(now: Date = new Date()): { totalMin: number; dow: number } {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { totalMin: et.getHours() * 60 + et.getMinutes(), dow: et.getDay() };
}

/** True between 9:30 AM and 4:00 PM ET on a weekday. */
export function isMarketOpenNow(now: Date = new Date()): boolean {
  const { totalMin, dow } = nowEt(now);
  if (dow < 1 || dow > 5) return false;
  return totalMin >= 9 * 60 + 30 && totalMin < 16 * 60;
}

/** True 4:00 AM – 9:30 AM ET on a weekday. */
export function isPreOpenNow(now: Date = new Date()): boolean {
  const { totalMin, dow } = nowEt(now);
  if (dow < 1 || dow > 5) return false;
  return totalMin >= 4 * 60 && totalMin < 9 * 60 + 30;
}

export type MarketMode = "LIVE" | "PREVIEW" | "CLOSED";

export function currentMarketMode(now: Date = new Date()): MarketMode {
  if (isMarketOpenNow(now)) return "LIVE";
  if (isPreOpenNow(now)) return "PREVIEW";
  return "CLOSED";
}

// ─── Granular market state (preferred for new code) ──────────────────────────
export type MarketState =
  | "PRE_MARKET"   // 4:00–9:30 AM ET
  | "OPEN"         // 9:30 AM–4:00 PM ET
  | "AFTER_HOURS"  // 4:00–8:00 PM ET
  | "CLOSED";      // 8:00 PM–4:00 AM ET + weekends

/** Returns the current market session bucket using America/New_York. */
export function getMarketState(now: Date = new Date()): MarketState {
  const { totalMin, dow } = nowEt(now);
  if (dow === 0 || dow === 6) return "CLOSED";
  if (totalMin < 4 * 60) return "CLOSED";       // before 4:00 AM
  if (totalMin < 9 * 60 + 30) return "PRE_MARKET";
  if (totalMin < 16 * 60) return "OPEN";
  if (totalMin < 20 * 60) return "AFTER_HOURS"; // 4:00–8:00 PM
  return "CLOSED";
}

/** Convenience boolean — true only during regular session. */
export function isMarketOpen(now: Date = new Date()): boolean {
  return getMarketState(now) === "OPEN";
}
