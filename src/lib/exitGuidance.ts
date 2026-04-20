// Exit Guidance Engine — pure function that turns an open portfolio position
// + live market context into an exit recommendation + plain-English reason.
//
// Rules (in order):
//   1) Hard stop hit          → SELL_AT_LOSS
//   2) Target 2 hit           → TAKE_PROFIT
//   3) Target 1 hit           → TRIM_PARTIAL
//   4) Time decay (DTE ≤ 1)   → TIME_EXIT
//   5) Direction broke down + weak volume + below VWAP → SELL_AT_LOSS or NO_SIGNAL
//   6) Otherwise              → HOLD
//
// Pure / no I/O / no React. Used by both the /portfolio UI (live preview) and
// the cron worker (writes back to portfolio_positions every 5 min).

export type ExitRecommendation =
  | "HOLD"
  | "TRIM_PARTIAL"
  | "TAKE_PROFIT"
  | "SELL_AT_LOSS"
  | "TIME_EXIT"
  | "NO_SIGNAL";

export interface ExitPosition {
  side: "CALL" | "PUT";
  entry_price: number;
  hard_stop_pct: number;   // e.g. -30
  target_1_pct: number;    // e.g.  50
  target_2_pct: number;    // e.g. 100
  max_hold_days: number | null;
  thesis_bias: "bullish" | "bearish";
}

export interface MarketContext {
  underlyingPrice: number;
  optionMidPrice: number;
  vwap: number;
  intradayMA: number;
  openingRangeHigh: number;
  openingRangeLow: number;
  /** Current vs avg for this time of day. 1.0 = on pace. */
  relVolume: number;
  /** Minutes since 09:30 ET. < 0 means pre-market. */
  timeOfDayMinutes: number;
  daysToExpiry: number;
}

export interface ExitDecision {
  recommendation: ExitRecommendation;
  reason: string;
  profitPct: number;
}

export function getExitRecommendation(
  position: ExitPosition,
  ctx: MarketContext,
): ExitDecision {
  const { entry_price, hard_stop_pct, target_1_pct, target_2_pct } = position;
  if (!Number.isFinite(entry_price) || entry_price <= 0) {
    return { recommendation: "NO_SIGNAL", reason: "Entry price unknown — can't compute P&L.", profitPct: 0 };
  }

  const profitPct = ((ctx.optionMidPrice - entry_price) / entry_price) * 100;

  // 1) Hard stop
  if (profitPct <= hard_stop_pct) {
    return {
      recommendation: "SELL_AT_LOSS",
      reason: `Premium down ${profitPct.toFixed(1)}% vs entry; below ${hard_stop_pct}% hard stop. Cut loss and preserve capital.`,
      profitPct,
    };
  }

  // 2) Target 2
  if (profitPct >= target_2_pct) {
    return {
      recommendation: "TAKE_PROFIT",
      reason: `Premium up ${profitPct.toFixed(1)}%, above target_2 (${target_2_pct}%). Lock in full profits.`,
      profitPct,
    };
  }

  // 3) Target 1
  if (profitPct >= target_1_pct) {
    return {
      recommendation: "TRIM_PARTIAL",
      reason: `Premium up ${profitPct.toFixed(1)}%, above target_1 (${target_1_pct}%). Take partial profits, move stop to breakeven.`,
      profitPct,
    };
  }

  // 4) Time exit
  if (position.max_hold_days != null && ctx.daysToExpiry <= 1) {
    return {
      recommendation: "TIME_EXIT",
      reason: "Option is near expiration with limited time value left. Flatten risk before last-day decay.",
      profitPct,
    };
  }

  // 5) Direction + volume degradation. Only meaningful intraday (after open).
  if (ctx.timeOfDayMinutes >= 30) {
    const lostVwap = position.thesis_bias === "bullish"
      ? ctx.underlyingPrice < ctx.vwap
      : ctx.underlyingPrice > ctx.vwap;
    const lostMa = position.thesis_bias === "bullish"
      ? ctx.underlyingPrice < ctx.intradayMA
      : ctx.underlyingPrice > ctx.intradayMA;
    const weakVolume = ctx.relVolume < 0.8;

    if (lostVwap && lostMa && weakVolume) {
      // If the position is already losing, cut. If still slightly green, just neutralize.
      if (profitPct < 0) {
        return {
          recommendation: "SELL_AT_LOSS",
          reason: `Thesis broken — price below VWAP and intraday MA on weak volume (${ctx.relVolume.toFixed(2)}× avg). Cut and reset.`,
          profitPct,
        };
      }
      return {
        recommendation: "NO_SIGNAL",
        reason: `Direction confirmation lost — below VWAP/MA on weak volume. Tighten stop to breakeven; no fresh entry.`,
        profitPct,
      };
    }
  }

  // 6) Default — hold
  return {
    recommendation: "HOLD",
    reason: "Position within risk parameters; trend and volume not broken. Hold and re-evaluate intraday.",
    profitPct,
  };
}

// ─── UI helpers ────────────────────────────────────────────────────────────

export const EXIT_LABEL: Record<ExitRecommendation, string> = {
  HOLD:         "HOLD",
  TRIM_PARTIAL: "TRIM PARTIAL",
  TAKE_PROFIT:  "TAKE PROFIT",
  SELL_AT_LOSS: "SELL AT LOSS",
  TIME_EXIT:    "TIME EXIT",
  NO_SIGNAL:    "NO SIGNAL",
};

export const EXIT_TONE: Record<ExitRecommendation, "bullish" | "bearish" | "warning" | "muted"> = {
  HOLD:         "muted",
  TRIM_PARTIAL: "bullish",
  TAKE_PROFIT:  "bullish",
  SELL_AT_LOSS: "bearish",
  TIME_EXIT:    "bearish",
  NO_SIGNAL:    "muted",
};

export const EXIT_CLASSES: Record<ExitRecommendation, string> = {
  HOLD:         "border-border bg-muted/30 text-muted-foreground",
  TRIM_PARTIAL: "border-bullish/40 bg-bullish/10 text-bullish",
  TAKE_PROFIT:  "border-bullish/40 bg-bullish/10 text-bullish",
  SELL_AT_LOSS: "border-bearish/40 bg-bearish/10 text-bearish",
  TIME_EXIT:    "border-bearish/40 bg-bearish/10 text-bearish",
  NO_SIGNAL:    "border-border bg-surface/40 text-muted-foreground",
};

/** Default max-hold based on DTE bucket (used by the Add-to-Portfolio dialog). */
export function defaultMaxHoldDays(dte: number): number {
  if (dte <= 7) return 5;
  if (dte <= 21) return 10;
  if (dte <= 60) return 21;
  return 45;
}
