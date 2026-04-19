// Date sync helpers — make sure a pick's suggested expiry is still tradeable.
//
// Rules:
//   • If the pick's expiry has already passed → pivot to the next monthly.
//   • If it's > 365 days out (LEAPS) we leave it alone — those are intentional.
//   • Otherwise we keep the original date.
//
// Monthlies are the third Friday of each month — the most liquid expiries on
// every major US stock and ETF. Weeklies exist but are far thinner outside
// SPY/QQQ/AAPL/TSLA/NVDA, so monthlies are the safe default fallback.

/** Parse YYYY-MM-DD into a Date at noon local — avoids TZ flip issues. */
function parseISODate(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Third Friday of the given (year, monthIndex). */
function thirdFriday(year: number, monthIndex: number): Date {
  const d = new Date(year, monthIndex, 1, 12, 0, 0);
  // Day of week: Sun=0…Sat=6. Friday=5.
  const firstFridayOffset = (5 - d.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + firstFridayOffset + 14, 12, 0, 0);
}

/** Nearest monthly expiry on or after `from`. */
export function nearestMonthlyExpiry(from: Date = new Date()): Date {
  // Try the current month's third-Friday first; if it has passed, walk forward.
  for (let i = 0; i < 6; i++) {
    const candidate = thirdFriday(from.getFullYear(), from.getMonth() + i);
    if (candidate.getTime() >= from.getTime()) return candidate;
  }
  // Should never get here, but keep TS happy.
  return thirdFriday(from.getFullYear() + 1, 0);
}

/** Days between two dates (signed, calendar days). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface ExpirySync {
  /** Expiry actually used after pivoting (YYYY-MM-DD). */
  expiry: string;
  /** Was the original expiry replaced? */
  pivoted: boolean;
  /** Days until the (post-sync) expiry. */
  dte: number;
  /** Plain-English reason for any change. */
  reason?: string;
}

/**
 * Cross-references a pick's `expiryDate` against today and pivots to the
 * nearest monthly when stale. Leaves intentional LEAPS (>365 DTE) alone.
 */
export function syncExpiry(expiry: string | null | undefined, now: Date = new Date()): ExpirySync {
  const original = expiry ? parseISODate(expiry) : null;
  if (!original) {
    const fallback = nearestMonthlyExpiry(now);
    return {
      expiry: toISODate(fallback),
      pivoted: true,
      dte: daysBetween(now, fallback),
      reason: "No expiry on the pick — pivoted to the nearest liquid monthly.",
    };
  }
  const dte = daysBetween(now, original);
  if (dte < 0) {
    const fallback = nearestMonthlyExpiry(now);
    return {
      expiry: toISODate(fallback),
      pivoted: true,
      dte: daysBetween(now, fallback),
      reason: `Original expiry ${expiry} already passed — pivoted to nearest liquid monthly.`,
    };
  }
  // Within the next year: keep the original.
  return {
    expiry: toISODate(original),
    pivoted: false,
    dte,
  };
}
