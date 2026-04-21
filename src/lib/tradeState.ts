// ─────────────────────────────────────────────────────────────────────────────
// Trade State Machine — the single source of truth for "what should the UI say
// and which buttons should it show?"
//
// Replaces the old loose mix of pickTier + tradeStatus + verdict labels with
// FOUR strictly mutually-exclusive states:
//
//   • EXCLUDED              — not safe / not good / too many problems → hide CTA
//   • WATCHLIST_ONLY        — interesting setup, NOT confirmed/ready → no Buy CTA
//   • NEAR_LIMIT_CONFIRMED  — confirmed + tradable, but cost or IV near limit → reduced-size Buy
//   • TRADE_READY           — clean + confirmed + safe → full Buy
//
// Two-axis decision:
//
//   1. IDEA QUALITY        — is this an interesting setup? (score-based)
//   2. EXECUTION ELIGIBILITY — is it safe/ready to trade right now? (hard gates)
//
// State capping rule: a high score CANNOT promote a candidate above what its
// execution eligibility allows. A low score CANNOT demote a confirmed-clean
// pick — the score still has to hit the floor for TRADE_READY.
//
// State-blocking penalties (override score):
//   • EARNINGS_48H → cap at WATCHLIST_ONLY (binary event risk)
//   • DEEP_ITM     → cap at WATCHLIST_ONLY (capital inefficient)
//   • CHASE        → cap at WATCHLIST_ONLY (already up >5% today)
//   • HIGH_ATR + (weak vol OR not confirmed) → cap at WATCHLIST_ONLY
//   • IV_TRAP (severe) → cap at WATCHLIST_ONLY
//   • ILLIQUID_OI / WIDE_SPREAD beyond safety → EXCLUDED (handled upstream)
//
// "Both must pass" trigger confirmation:
//   triggerConfirmed = readinessTrigger ≥ 25 AND relVol ≥ 1.5 AND |chgPct| > 0.4
//   AND bias-aligned move (bullish bias needs up move, bearish needs down).
//
// Quote validity: caller passes quoteValid + quoteFresh; if either is false the
// state is capped at WATCHLIST_ONLY and the CTA reads "waiting for reliable
// pricing."
// ─────────────────────────────────────────────────────────────────────────────

import type { SetupRow } from "./setupScore";
import type { RankResult } from "./finalRank";
import type { TradeStatusResult } from "./tradeStatus";
import type { TierResult } from "./pickTier";
import { getMarketState } from "./marketHours";

// ── State enum ──────────────────────────────────────────────────────────────
export type TradeState =
  | "TRADE_READY"
  | "NEAR_LIMIT_CONFIRMED"
  | "WATCHLIST_ONLY"
  | "EXCLUDED";

// ── Configurable thresholds (centralized; runtime-overridable per profile) ──
export const TRADE_STATE_CONFIG = {
  /** Minimum final score to qualify as TRADE_READY. */
  TRADE_READY_MIN_SCORE: 63,
  /** Minimum final score to qualify as NEAR_LIMIT_CONFIRMED. */
  NEAR_LIMIT_MIN_SCORE: 65,
  /** Minimum final score to be worth watching at all. Below this → EXCLUDED. */
  WATCHLIST_MIN_SCORE: 50,
  /** Trigger sub-score floor (out of 30, from finalRank.readinessBreakdown). */
  TRIGGER_MIN_SUBSCORE: 25,
  /** RelVol floor for trigger confirmation. */
  TRIGGER_MIN_RELVOL: 1.5,
  /** Intraday move floor (absolute %) for trigger confirmation. */
  TRIGGER_MIN_MOVE_PCT: 0.4,
  /** Max soft failures allowed at TRADE_READY. */
  TRADE_READY_MAX_SOFT_FAILS: 0,
  /** Max soft failures allowed at NEAR_LIMIT_CONFIRMED. */
  NEAR_LIMIT_MAX_SOFT_FAILS: 1,
  /** Max soft failures allowed at WATCHLIST_ONLY (default; overridable). */
  WATCHLIST_MAX_SOFT_FAILS: 3,
  /** Default trigger mode — false = relaxed (2-of-3), true = strict (all 3). */
  TRIGGER_REQUIRE_ALL: false,
} as const;

/** Per-evaluation override knobs read from the active StrategyProfile. */
export interface ScoringOverrides {
  tradeReadyMinScore?: number;
  watchlistMinScore?: number;
  maxSoftFailures?: number;
  triggerRequireAll?: boolean;
}

// ── Penalty codes that CAP the trade state instead of just deducting points ──
const STATE_BLOCKING_PENALTIES = new Set([
  "EARNINGS_48H",
  "DEEP_ITM",
  "CHASE",
  "IV_TRAP",
  "DEEP_ITM",
]);

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface TradeStateInput {
  row: SetupRow;
  rank: RankResult | null;
  tradeStatus: TradeStatusResult;
  tier: TierResult | null;
  /** True when the option chain quote is structurally valid (no NaN, sane bid/ask). */
  quoteValid: boolean;
  /** True when the quote timestamp is recent enough to act on. */
  quoteFresh: boolean;
  /** Pre-market window — options markets closed; auto-cap at WATCHLIST_ONLY. */
  preMarket: boolean;
  /** Strategy profile may opt in to expensive structures / earnings plays. */
  allowsEarnings?: boolean;
  allowsDeepItm?: boolean;
  /** Set when budget checker flagged "near limit" but not hard-dropped. */
  budgetNearLimit?: boolean;
  /** Set when IVP is elevated (75-90) but not extreme. */
  ivpNearLimit?: boolean;
  /** Runtime threshold overrides from the user's StrategyProfile. */
  scoringOverrides?: ScoringOverrides;
}

// ── Output ───────────────────────────────────────────────────────────────────
export interface TradeStateResult {
  state: TradeState;
  /** ISO list of every blocker that contributed to the state (for tooltips). */
  blockers: string[];
  /** Plain-English explanation matching state. */
  reason: string;
  /** Concrete trigger language for WATCHLIST_ONLY ("waiting for X"). */
  triggerNeeded: string | null;
  /** True when we hit a hard cap (e.g. score would qualify higher but didn't). */
  capped: boolean;
  /** State-blocking penalty codes that fired. */
  blockerCodes: string[];
}

// ── Trigger confirmation ─────────────────────────────────────────────────────
// Default mode (TRIGGER_REQUIRE_ALL=false): relaxed — any 2-of-3 of
//   { trigger sub-score ≥ 25, relVol ≥ 1.5, bias-aligned move > 0.4% } pass.
// Strict mode (TRIGGER_REQUIRE_ALL=true): legacy — ALL three required.
// This loosening lets quiet mid-day tickers with strong setup scores qualify
// when volume hasn't spiked yet but direction + trigger sub-score still align.
function isTriggerConfirmed(
  row: SetupRow,
  rank: RankResult | null,
  requireAll: boolean,
): boolean {
  if (!rank) return false;
  const trigOk = rank.readinessBreakdown.trigger >= TRADE_STATE_CONFIG.TRIGGER_MIN_SUBSCORE;
  const relVolOk = (row.relVolume ?? 0) >= TRADE_STATE_CONFIG.TRIGGER_MIN_RELVOL;
  const moveAbs = Math.abs(row.changePct);
  const aligned =
    (row.bias === "bullish" && row.changePct > 0) ||
    (row.bias === "bearish" && row.changePct < 0) ||
    row.bias === "reversal";
  const moveOk = moveAbs > TRADE_STATE_CONFIG.TRIGGER_MIN_MOVE_PCT && aligned;

  const conds = [trigOk, relVolOk, moveOk];
  const passing = conds.filter(Boolean).length;
  return requireAll ? passing === 3 : passing >= 2;
}

// ── Generate the human "what we're waiting for" string ───────────────────────
function describeTriggerNeeded(
  row: SetupRow,
  rank: RankResult | null,
  blockers: string[],
): string | null {
  if (blockers.length === 0) return null;

  // Most informative blocker takes priority.
  if (blockers.includes("quote-stale") || blockers.includes("quote-invalid")) {
    return "Waiting for reliable option pricing — quote is stale or unavailable.";
  }
  if (blockers.includes("pre-market")) {
    return "Waiting for the open at 9:30 AM ET — options markets closed.";
  }
  if (blockers.includes("earnings-48h")) {
    return "Earnings within 48 hours — binary risk; wait for the print.";
  }
  if (blockers.includes("deep-itm")) {
    return "Strike is deep ITM — capital inefficient. Wait for a better entry or use a vertical.";
  }
  if (blockers.includes("chase")) {
    const dir = row.changePct > 0 ? "up" : "down";
    return `Already ${dir} ${Math.abs(row.changePct).toFixed(1)}% today — wait for pullback to VWAP/ORH and a higher-low confirmation.`;
  }
  if (blockers.includes("trigger-not-confirmed")) {
    if ((row.relVolume ?? 0) < TRADE_STATE_CONFIG.TRIGGER_MIN_RELVOL) {
      return `Waiting for relative volume ≥ ${TRADE_STATE_CONFIG.TRIGGER_MIN_RELVOL}× (currently ${(row.relVolume ?? 0).toFixed(2)}×).`;
    }
    if (Math.abs(row.changePct) <= TRADE_STATE_CONFIG.TRIGGER_MIN_MOVE_PCT) {
      return `Waiting for a confirmed intraday move > ${TRADE_STATE_CONFIG.TRIGGER_MIN_MOVE_PCT}% in the bias direction.`;
    }
    if (row.bias === "bullish" && row.changePct < 0) {
      return "Bullish bias but stock is red — waiting for reclaim of VWAP and hold.";
    }
    if (row.bias === "bearish" && row.changePct > 0) {
      return "Bearish bias but stock is green — waiting for breakdown below premarket low.";
    }
    return "Trigger not confirmed — waiting for volume + move + direction to align.";
  }
  if (blockers.includes("high-atr")) {
    return `ATR ${row.atrPct.toFixed(1)}% with weak volume — wait for pullback or volume confirmation.`;
  }
  if (blockers.includes("iv-trap")) {
    return `IV rank ${row.ivRank} is extreme — long premium will get crushed. Wait for IV to bleed off.`;
  }
  if (blockers.includes("wide-spread")) {
    return "Bid/ask spread is wide — slippage will hurt R/R. Wait for tighter market.";
  }
  if (blockers.includes("low-conviction")) {
    return "Score below trade-ready threshold — keep watching for a cleaner setup.";
  }
  if (blockers.includes("budget-over")) {
    return "Cost above per-trade target — reduce contracts or wait for cheaper entry.";
  }
  if (blockers.includes("soft-failures")) {
    return "Multiple soft conditions failing — wait for cleaner alignment before entering.";
  }
  return null;
}

// ── Soft-failure counter (excludes blockers that are already capped to states) ──
function countSoftFailures(input: TradeStateInput): number {
  // tradeStatus.blockers already excludes pre-market/budget; we further exclude
  // anything we treat as a state-blocker so we don't double-count.
  return input.tradeStatus.blockers.filter(
    (b) =>
      !b.includes("budget") &&
      !b.includes("pre-market") &&
      !b.includes("earnings") &&
      !b.includes("chase"),
  ).length;
}

// ── Main evaluator ───────────────────────────────────────────────────────────
export function evaluateExecutionState(input: TradeStateInput): TradeStateResult {
  const { row, rank, tradeStatus, tier, preMarket, quoteValid, quoteFresh } = input;
  const blockers: string[] = [];
  const blockerCodes: string[] = [];

  // ── Resolve runtime-overridable thresholds (StrategyProfile.scoringOverrides) ─
  const o = input.scoringOverrides;
  const tradeReadyMin = o?.tradeReadyMinScore ?? TRADE_STATE_CONFIG.TRADE_READY_MIN_SCORE;
  const watchlistMin  = o?.watchlistMinScore  ?? TRADE_STATE_CONFIG.WATCHLIST_MIN_SCORE;
  const maxSoftFails  = o?.maxSoftFailures    ?? TRADE_STATE_CONFIG.WATCHLIST_MAX_SOFT_FAILS;
  const requireAllTrig = o?.triggerRequireAll ?? TRADE_STATE_CONFIG.TRIGGER_REQUIRE_ALL;

  // ── Hard EXCLUDED conditions (no override possible) ────────────────────────
  // 1. Tier classifier said safety failed or hard-dropped.
  if (!tier) {
    return {
      state: "EXCLUDED",
      blockers: ["no-tier"],
      reason: "No tier classification — pipeline error.",
      triggerNeeded: null,
      capped: false,
      blockerCodes: [],
    };
  }
  if (tier.tier === "EXCLUDED" && tier.hardDrop) {
    return {
      state: "EXCLUDED",
      blockers: ["hard-drop"],
      reason: tier.caveat ?? "Excluded by hard cap (cost or safety).",
      triggerNeeded: null,
      capped: false,
      blockerCodes: tier.penalties.map((p) => p.code),
    };
  }
  // 2. Score below the watch floor → EXCLUDED.
  const score = rank?.finalRank ?? row.setupScore;
  if (score < watchlistMin) {
    return {
      state: "EXCLUDED",
      blockers: ["below-watch-floor"],
      reason: `Score ${score} below watch floor (${watchlistMin}).`,
      triggerNeeded: null,
      capped: false,
      blockerCodes: [],
    };
  }

  // ── Build blocker list (these CAP state but don't auto-exclude) ────────────
  if (preMarket) blockers.push("pre-market");
  if (!quoteValid) blockers.push("quote-invalid");
  if (!quoteFresh) blockers.push("quote-stale");

  // After-hours / closed market: relVolume can never spike and changePct is
  // frozen, so trigger confirmation on EOD data is meaningless. Skip the
  // requirement entirely outside the regular session — score + safety alone
  // determine state. Reactivates automatically at 9:30 AM ET.
  const marketStateNow = getMarketState();
  const requireTrigger = marketStateNow === "OPEN";
  const triggerOk = !requireTrigger || isTriggerConfirmed(row, rank, requireAllTrig);
  if (!triggerOk) blockers.push("trigger-not-confirmed");

  // State-blocking penalties from finalRank.
  const rankPenalties = rank?.penalties ?? [];
  for (const p of rankPenalties) {
    if (!STATE_BLOCKING_PENALTIES.has(p.code)) continue;
    if (p.code === "EARNINGS_48H" && !input.allowsEarnings) {
      blockers.push("earnings-48h");
      blockerCodes.push("EARNINGS_48H");
    } else if (p.code === "DEEP_ITM" && !input.allowsDeepItm) {
      blockers.push("deep-itm");
      blockerCodes.push("DEEP_ITM");
    } else if (p.code === "CHASE") {
      blockers.push("chase");
      blockerCodes.push("CHASE");
    } else if (p.code === "IV_TRAP") {
      blockers.push("iv-trap");
      blockerCodes.push("IV_TRAP");
    }
  }

  // HIGH_ATR is contextual: cap only when volume weak OR trigger unconfirmed.
  const hasHighAtr = rankPenalties.some((p) => p.code === "HIGH_ATR");
  if (hasHighAtr && (tradeStatus.volume === "Weak" || !triggerOk)) {
    blockers.push("high-atr");
    blockerCodes.push("HIGH_ATR");
  }

  // WIDE_SPREAD that's not severe enough to be safety-blocked still caps state.
  const hasWideSpread = rankPenalties.some((p) => p.code === "WIDE_SPREAD");
  if (hasWideSpread) {
    blockers.push("wide-spread");
    blockerCodes.push("WIDE_SPREAD");
  }

  // Soft failure count.
  const softFails = countSoftFailures(input);
  if (softFails > maxSoftFails) {
    return {
      state: "EXCLUDED",
      blockers: [...blockers, "too-many-soft-failures"],
      reason: `${softFails} soft conditions failing — too many to track responsibly.`,
      triggerNeeded: null,
      capped: false,
      blockerCodes,
    };
  }

  // ── State-blocker CAP: any state blocker forces WATCHLIST_ONLY max ─────────
  const hasStateBlocker = blockerCodes.length > 0 || blockers.includes("high-atr");
  const hasQuoteIssue = !quoteValid || !quoteFresh;
  const hasExecutionBlocker = preMarket || hasQuoteIssue || !triggerOk || hasStateBlocker;

  // ── TRADE_READY check (strict) ─────────────────────────────────────────────
  const couldBeTradeReady =
    score >= tradeReadyMin &&
    !hasExecutionBlocker &&
    !input.budgetNearLimit &&
    !input.ivpNearLimit &&
    softFails <= TRADE_STATE_CONFIG.TRADE_READY_MAX_SOFT_FAILS &&
    tier.tier !== "EXCLUDED";

  if (couldBeTradeReady) {
    return {
      state: "TRADE_READY",
      blockers: [],
      reason: `Trade-ready: score ${score}, trigger confirmed, quote valid, no blockers.`,
      triggerNeeded: null,
      capped: false,
      blockerCodes: [],
    };
  }

  // ── NEAR_LIMIT_CONFIRMED check ─────────────────────────────────────────────
  const exactlyOneNearLimit =
    [input.budgetNearLimit, input.ivpNearLimit].filter(Boolean).length === 1;
  const couldBeNearLimit =
    score >= TRADE_STATE_CONFIG.NEAR_LIMIT_MIN_SCORE &&
    !preMarket &&
    !hasQuoteIssue &&
    triggerOk &&
    !hasStateBlocker &&
    softFails <= TRADE_STATE_CONFIG.NEAR_LIMIT_MAX_SOFT_FAILS &&
    exactlyOneNearLimit &&
    tier.tier !== "EXCLUDED";

  if (couldBeNearLimit) {
    const why = input.budgetNearLimit ? "cost is near per-trade limit" : "IV percentile is elevated";
    return {
      state: "NEAR_LIMIT_CONFIRMED",
      blockers: blockers.filter((b) => b !== "trigger-not-confirmed"),
      reason: `Confirmed setup but ${why} — reduce size.`,
      triggerNeeded: null,
      capped: false,
      blockerCodes,
    };
  }

  // ── WATCHLIST_ONLY: anything score-worthy but not executable ───────────────
  const triggerNeeded = describeTriggerNeeded(row, rank, blockers);
  return {
    state: "WATCHLIST_ONLY",
    blockers,
    reason: triggerNeeded ?? `Setup worth watching at score ${score}; not yet ready.`,
    triggerNeeded,
    capped: score >= tradeReadyMin && hasExecutionBlocker,
    blockerCodes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA Resolver — buttons must come ONLY from state. No mixing allowed.
// ─────────────────────────────────────────────────────────────────────────────
export type CtaKind =
  | "BUY_NOW"
  | "BUY_REDUCED"
  | "ADD_WATCHLIST"
  | "NONE";

export interface CtaPlan {
  primary: CtaKind;
  /** Allow Add-to-Portfolio button alongside primary CTA. */
  showAddToPortfolio: boolean;
  /** Helper text for the row (one-liner under buttons). */
  helper: string;
  /** Display label for the badge. */
  badgeLabel: string;
  /** Tailwind classes for the badge. */
  badgeClasses: string;
}

export function resolveCta(state: TradeState, result?: TradeStateResult): CtaPlan {
  switch (state) {
    case "TRADE_READY":
      return {
        primary: "BUY_NOW",
        showAddToPortfolio: true,
        helper: "Clean pass — full size OK per your risk profile.",
        badgeLabel: "✅ Trade Ready",
        badgeClasses: "border-bullish/40 bg-bullish/10 text-bullish",
      };
    case "NEAR_LIMIT_CONFIRMED":
      return {
        primary: "BUY_REDUCED",
        showAddToPortfolio: true,
        helper: result?.reason ?? "Confirmed but near limit — reduce size.",
        badgeLabel: "⚠️ Buy Reduced Size",
        badgeClasses: "border-warning/40 bg-warning/10 text-warning",
      };
    case "WATCHLIST_ONLY":
      return {
        primary: "ADD_WATCHLIST",
        showAddToPortfolio: false, // explicitly forbidden per spec
        helper: result?.triggerNeeded ?? result?.reason ?? "Watchlist only — not confirmed yet.",
        badgeLabel: "👀 Watchlist Only",
        badgeClasses: "border-primary/40 bg-primary/10 text-primary",
      };
    case "EXCLUDED":
      return {
        primary: "NONE",
        showAddToPortfolio: false,
        helper: result?.reason ?? "Excluded.",
        badgeLabel: "⛔ Excluded",
        badgeClasses: "border-bearish/40 bg-bearish/10 text-bearish",
      };
  }
}

// ── Quick label/classes lookups for compact badges ──────────────────────────
export const TRADE_STATE_LABEL: Record<TradeState, string> = {
  TRADE_READY: "✅ Trade Ready",
  NEAR_LIMIT_CONFIRMED: "⚠️ Buy Reduced Size",
  WATCHLIST_ONLY: "👀 Watchlist Only",
  EXCLUDED: "⛔ Excluded",
};

export const TRADE_STATE_CLASSES: Record<TradeState, string> = {
  TRADE_READY: "border-bullish/40 bg-bullish/10 text-bullish",
  NEAR_LIMIT_CONFIRMED: "border-warning/40 bg-warning/10 text-warning",
  WATCHLIST_ONLY: "border-primary/40 bg-primary/10 text-primary",
  EXCLUDED: "border-bearish/40 bg-bearish/10 text-bearish",
};

/** Numeric rank for sorting (TRADE_READY first). */
export function tradeStateRank(s: TradeState): number {
  return s === "TRADE_READY" ? 3
       : s === "NEAR_LIMIT_CONFIRMED" ? 2
       : s === "WATCHLIST_ONLY" ? 1
       : 0;
}
