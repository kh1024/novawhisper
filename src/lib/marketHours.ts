// Single source of truth for "is the US equity options market open RIGHT NOW".
// Used to switch the scanner between PREVIEW (watchlist-only) and LIVE (full
// score + selector) modes. Replaces ad-hoc time checks scattered through the
// app so 11:51 ET on a regular trading day is GUARANTEED to be LIVE.
//
// NYSE regular hours: 9:30 AM – 4:00 PM America/New_York, Mon–Fri.
// We intentionally ignore half-days and exchange holidays here — those cause
// at most a brief mis-classification and are far less harmful than the
// previous bug (stuck in preview at lunchtime).

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
