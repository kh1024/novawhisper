// TradeStatus Middleware — post-processing layer that sits on top of the
// existing scanner pipeline. It does NOT alter setup detection, scoring, or
// ranking; it only adds a trade-readiness validation that asks the simple
// real-world question: *would I actually press BUY on this right now?*
//
// Five sub-statuses, all derived from data we already have on the row +
// contract. Each one short-circuits TradeReady when it fails a critical gate:
//
//   1. DirectionStatus  — Bullish / Bearish / Waiting
//      → bias must be confirmed by intraday momentum (changePct + RSI side).
//        Pre-open, we cannot confirm direction → Waiting.
//
//   2. VolumeStatus     — Strong / Average / Weak
//      → relVolume vs 1.0× baseline. Weak volume = breakouts that fade.
//
//   3. GapStatus        — Safe / Extended / DoNotChase
//      → |changePct| classifies how much the stock has already moved today.
//        > +4% bullish or < -4% bearish without a pullback = chase risk.
//
//   4. BudgetStatus     — Fits / OverCap
//      → Already evaluated upstream; we mirror it here for the badge UI.
//
//   5. LiquidityStatus  — Liquid / Thin
//      → optionsLiquidity score (existing 0-100 proxy) vs threshold.
//
// Final TradeStatus:
//   - WatchlistOnly  — pre-market window OR any critical gate not green
//   - TradeReady     — all five gates green
//   - Skip           — direction Waiting + low conviction (rank < 60)
//
// Pre-market picks are ALWAYS WatchlistOnly per spec — options markets are
// closed and intraday confirmation is impossible.

import type { SetupRow } from "@/lib/setupScore";

export type DirectionStatus = "Bullish" | "Bearish" | "Waiting";
export type VolumeStatus = "Strong" | "Average" | "Weak";
export type GapStatus = "Safe" | "Extended" | "DoNotChase";
export type BudgetStatus = "Fits" | "OverCap";
export type LiquidityStatus = "Liquid" | "Thin";
export type TradeStatus = "TradeReady" | "WatchlistOnly" | "Skip";

export interface TradeStatusResult {
  tradeStatus: TradeStatus;
  direction: DirectionStatus;
  volume: VolumeStatus;
  gap: GapStatus;
  budget: BudgetStatus;
  liquidity: LiquidityStatus;
  /** One-line plain-English summary for the UI tooltip. */
  reason: string;
  /** Which sub-statuses blocked TradeReady (empty when ready). */
  blockers: string[];
}

export interface TradeStatusInput {
  row: SetupRow;
  /** True between 4:00 AM and 9:30 AM ET — always WatchlistOnly. */
  preMarket: boolean;
  /** Already evaluated upstream by the strike-ladder budget filter. */
  fitsCap: boolean;
  /** Final rank (0-100) — used to demote Waiting picks to Skip. */
  finalRank: number | null;
}

const VOLUME_STRONG = 1.5;   // ≥ 1.5× avg = institutional participation
const VOLUME_WEAK = 0.8;     // < 0.8× = thin tape, breakouts unreliable
const GAP_EXTENDED = 2.5;    // |chg| 2.5–4% = stretched but workable
const GAP_DO_NOT_CHASE = 4;  // > 4% gap with no pullback = chase risk
const LIQUIDITY_MIN = 55;    // optionsLiquidity score threshold

function classifyDirection(row: SetupRow, preMarket: boolean): DirectionStatus {
  if (preMarket) return "Waiting";          // can't confirm without RTH tape
  // Intraday confirmation: bias must align with same-day momentum.
  // changePct + RSI side both have to agree with the row's bias.
  const momentumUp = row.changePct > 0.2 && row.rsi >= 50;
  const momentumDn = row.changePct < -0.2 && row.rsi <= 50;
  if (row.bias === "bullish" && momentumUp) return "Bullish";
  if (row.bias === "bearish" && momentumDn) return "Bearish";
  // Reversal/neutral or bias vs momentum mismatch → Waiting.
  return "Waiting";
}

function classifyVolume(row: SetupRow): VolumeStatus {
  if (!Number.isFinite(row.relVolume)) return "Average";
  if (row.relVolume >= VOLUME_STRONG) return "Strong";
  if (row.relVolume < VOLUME_WEAK) return "Weak";
  return "Average";
}

function classifyGap(row: SetupRow): GapStatus {
  const abs = Math.abs(row.changePct);
  if (abs >= GAP_DO_NOT_CHASE) return "DoNotChase";
  if (abs >= GAP_EXTENDED) return "Extended";
  return "Safe";
}

function classifyLiquidity(row: SetupRow): LiquidityStatus {
  return row.optionsLiquidity >= LIQUIDITY_MIN ? "Liquid" : "Thin";
}

export function computeTradeStatus(input: TradeStatusInput): TradeStatusResult {
  const direction = classifyDirection(input.row, input.preMarket);
  const volume = classifyVolume(input.row);
  const gap = classifyGap(input.row);
  const budget: BudgetStatus = input.fitsCap ? "Fits" : "OverCap";
  const liquidity = classifyLiquidity(input.row);

  // Pre-market picks are ALWAYS WatchlistOnly per spec.
  if (input.preMarket) {
    return {
      tradeStatus: "WatchlistOnly",
      direction, volume, gap, budget, liquidity,
      reason: "Pre-market — options closed; queue for the open and re-validate at 9:35 AM ET.",
      blockers: ["pre-market window"],
    };
  }

  const blockers: string[] = [];
  if (direction === "Waiting") blockers.push("direction not confirmed");
  if (volume === "Weak") blockers.push("weak relative volume");
  if (gap === "DoNotChase") blockers.push("gap extended — wait for pullback");
  if (budget === "OverCap") blockers.push("over per-trade cap");
  if (liquidity === "Thin") blockers.push("thin options liquidity");

  if (blockers.length === 0) {
    return {
      tradeStatus: "TradeReady",
      direction, volume, gap, budget, liquidity,
      reason: `${direction} confirmed · ${volume} volume · ${gap} gap · ${liquidity} chain · within budget.`,
      blockers,
    };
  }

  // Demote to Skip when conviction is low AND direction is unconfirmed.
  // High-conviction picks (rank ≥ 60) stay on the watchlist for the open.
  const lowConviction = (input.finalRank ?? 0) < 60;
  if (direction === "Waiting" && lowConviction) {
    return {
      tradeStatus: "Skip",
      direction, volume, gap, budget, liquidity,
      reason: `Skip — direction unconfirmed and rank below 60. ${blockers.join("; ")}.`,
      blockers,
    };
  }

  return {
    tradeStatus: "WatchlistOnly",
    direction, volume, gap, budget, liquidity,
    reason: `Watchlist — ${blockers.join("; ")}.`,
    blockers,
  };
}

// ─── UI helpers ────────────────────────────────────────────────────────────

export const TRADE_STATUS_CLASSES: Record<TradeStatus, string> = {
  TradeReady:    "border-bullish/40 bg-bullish/10 text-bullish",
  WatchlistOnly: "border-warning/40 bg-warning/10 text-warning",
  Skip:          "border-bearish/40 bg-bearish/10 text-bearish",
};

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  TradeReady:    "✅ Trade Ready",
  WatchlistOnly: "👀 Watchlist Only",
  Skip:          "⛔ Skip",
};

export const SUB_STATUS_HINT: Record<string, string> = {
  Direction_Bullish:   "Direction confirmed UP — bias and intraday momentum both bullish.",
  Direction_Bearish:   "Direction confirmed DOWN — bias and intraday momentum both bearish.",
  Direction_Waiting:   "Waiting — bias and intraday tape don't agree yet (or pre-market).",
  Volume_Strong:       "Strong volume — ≥ 1.5× average. Institutional participation.",
  Volume_Average:      "Average volume — adequate but not exceptional.",
  Volume_Weak:         "Weak volume — < 0.8× average. Breakouts here tend to fade.",
  Gap_Safe:            "Gap safe — price hasn't run away today; entry has room.",
  Gap_Extended:        "Gap extended — already moved 2.5-4%. Prefer a small pullback.",
  Gap_DoNotChase:      "Do not chase — moved >4% intraday. Wait for pullback to VWAP/ORH.",
  Budget_Fits:         "Fits your per-trade cap.",
  Budget_OverCap:      "Over your per-trade budget cap.",
  Liquidity_Liquid:    "Liquid options chain — tight spreads, fillable size.",
  Liquidity_Thin:      "Thin options chain — wide spreads, expect slippage.",
};
