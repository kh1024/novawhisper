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

/**
 * Returns a Date representing the next 9:30 AM America/New_York open
 * (skipping weekends). Returned as an absolute UTC instant suitable for
 * `getTime()` diffing against `Date.now()`.
 */
export function getNextMarketOpen(now: Date = new Date()): Date {
  // Build a YMD in ET regardless of viewer's local zone.
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(etParts.find((p) => p.type === t)?.value);
  let y = get("year"), m = get("month"), d = get("day");
  const hh = get("hour"), mm = get("minute");

  // If today's 9:30 ET has already passed (or it's the weekend), advance days.
  let advance = 0;
  if (hh > 9 || (hh === 9 && mm >= 30)) advance = 1;

  const candidate = new Date(Date.UTC(y, m - 1, d));
  candidate.setUTCDate(candidate.getUTCDate() + advance);

  // Skip Sat/Sun in ET.
  for (let guard = 0; guard < 7; guard++) {
    const dow = new Date(candidate.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
    if (dow !== 0 && dow !== 6) break;
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  // Convert "9:30 ET on candidate's date" to an absolute UTC instant.
  // Strategy: probe an arbitrary UTC instant on that date, measure ET offset,
  // and shift accordingly so we land exactly on 09:30 ET.
  y = candidate.getUTCFullYear();
  m = candidate.getUTCMonth();
  d = candidate.getUTCDate();
  const probe = new Date(Date.UTC(y, m, d, 14, 30, 0)); // 14:30 UTC ≈ 9:30/10:30 ET
  const etProbe = new Date(probe.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMin = (probe.getTime() - etProbe.getTime()) / 60_000;
  return new Date(Date.UTC(y, m, d, 9, 30, 0) + offsetMin * 60_000);
}

/** Returns the next ET calendar date (YYYY-MM-DD) used for tomorrow's-event lookups. */
export function getTomorrowET(now: Date = new Date()): Date {
  const open = getNextMarketOpen(now);
  // open is already next trading session — its calendar day in ET is "tomorrow".
  return open;
}

// ─── Session mode (NovaWhisper Quote Integrity engine) ───────────────────────
// Coarser-grained label than MarketState used by the scanner UI banner and
// the auto-refresh loop. Equivalent semantics, kept separate so we can tune
// thresholds (max quote age, BUY NOW eligibility) without touching the
// existing MarketMode / MarketState consumers.

export type SessionMode =
  | "PRE_MARKET"   // before 9:30 ET (Mon-Fri)
  | "MARKET_OPEN"  // 9:30-16:00 ET
  | "AFTER_HOURS"  // 16:00-20:00 ET
  | "CLOSED";      // overnight / weekend

export function getSessionMode(now: Date = new Date()): SessionMode {
  const state = getMarketState(now);
  if (state === "OPEN")        return "MARKET_OPEN";
  if (state === "PRE_MARKET")  return "PRE_MARKET";
  if (state === "AFTER_HOURS") return "AFTER_HOURS";
  return "CLOSED";
}

/** True only during the regular session — every other window forces WATCHLIST. */
export function buyNowAllowed(sessionMode: SessionMode = getSessionMode()): boolean {
  return sessionMode === "MARKET_OPEN";
}

/** Maximum allowed quote age (seconds) before a quote is treated as STALE. */
export function maxQuoteAge(sessionMode: SessionMode = getSessionMode()): number {
  switch (sessionMode) {
    case "MARKET_OPEN": return 15;
    case "PRE_MARKET":  return 120;
    case "AFTER_HOURS": return 300;
    case "CLOSED":      return Number.POSITIVE_INFINITY;
  }
}
