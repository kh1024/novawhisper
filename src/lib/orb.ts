// ─── OPENING RANGE BREAKOUT (ORB) ENGINE ────────────────────────────────────
// Based on backtested Reddit strategy: 41% WR, 2:1 payoff, +59.4% over 27 mo.
// Rules: Mon/Wed/Fri only, 5-min window 9:30–9:35 ET, ATM calls/puts on
// breakout, exit at +100% or –50%. All times resolved in America/New_York.

export interface OrbSetup {
  ticker: string;
  orbHigh: number;
  orbLow: number;
  orbRange: number;
  breakoutDirection: "CALL" | "PUT" | null;
  breakoutConfirmed: boolean;
  entryPrice: number;
  /** Nearest ATM strike (rounded to $1 / $5 for ETFs above $200). */
  targetStrike: number;
  /** Same-day expiry (0DTE). Caller should re-validate against real chain. */
  suggestedExpiry: string;
  /** +100% of premium paid. */
  profitTarget: number;
  /** –50% of premium paid. */
  stopLoss: number;
  /** True 9:35–10:30 AM ET on an ORB day. */
  windowOpen: boolean;
  reason: string;
}

/** Mon = 1, Wed = 3, Fri = 5 in America/New_York. */
export function isOrbDay(now: Date = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  return day === 1 || day === 3 || day === 5;
}

export function getETHourMinute(now: Date = new Date()): { hour: number; minute: number } {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { hour: et.getHours(), minute: et.getMinutes() };
}

export interface OrbStatus {
  isOrbDay: boolean;
  inRangeWindow: boolean;
  inEntryWindow: boolean;
  windowExpired: boolean;
}

export function getOrbStatus(now: Date = new Date()): OrbStatus {
  const orbDay = isOrbDay(now);
  const { hour, minute } = getETHourMinute(now);
  const totalMinutes = hour * 60 + minute;
  const OPEN = 9 * 60 + 30;
  const ORB_END = 9 * 60 + 35;
  const ENTRY_END = 10 * 60 + 30;
  return {
    isOrbDay: orbDay,
    inRangeWindow: orbDay && totalMinutes >= OPEN && totalMinutes < ORB_END,
    inEntryWindow: orbDay && totalMinutes >= ORB_END && totalMinutes < ENTRY_END,
    windowExpired: orbDay && totalMinutes >= ENTRY_END,
  };
}

/** True when *tomorrow* is an ORB day in America/New_York. */
export function isTomorrowOrbDay(now: Date = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() + 1);
  const day = et.getDay();
  return day === 1 || day === 3 || day === 5;
}

export function evaluateOrbBreakout(
  ticker: string,
  orbHigh: number,
  orbLow: number,
  currentPrice: number,
): OrbSetup {
  const orbRange = Math.max(0, orbHigh - orbLow);
  const buffer = orbRange * 0.1;
  let breakoutDirection: "CALL" | "PUT" | null = null;
  let breakoutConfirmed = false;
  let reason = "";

  if (currentPrice > orbHigh + buffer) {
    breakoutDirection = "CALL";
    breakoutConfirmed = true;
    reason = `Price ${currentPrice} broke above ORB high ${orbHigh.toFixed(2)} — CALL breakout`;
  } else if (currentPrice < orbLow - buffer) {
    breakoutDirection = "PUT";
    breakoutConfirmed = true;
    reason = `Price ${currentPrice} broke below ORB low ${orbLow.toFixed(2)} — PUT breakout`;
  } else {
    reason = `Price ${currentPrice} inside ORB range ${orbLow.toFixed(2)}–${orbHigh.toFixed(2)} — no breakout`;
  }

  const strikeIncrement = currentPrice > 200 ? 5 : 1;
  const targetStrike = Math.round(currentPrice / strikeIncrement) * strikeIncrement;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD

  return {
    ticker, orbHigh, orbLow, orbRange,
    breakoutDirection, breakoutConfirmed,
    entryPrice: currentPrice,
    targetStrike,
    suggestedExpiry: today,
    profitTarget: 1.0,
    stopLoss: -0.5,
    windowOpen: getOrbStatus().inEntryWindow,
    reason,
  };
}
