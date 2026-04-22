// ─── CALLS & PUTS SCORING ENGINE ────────────────────────────────────────────
// Community-validated rules from r/options backtested strategies.
// Goal: surface high-quality directional long calls and puts.
//
// This is an ADDITIVE scoring overlay — it does NOT replace the existing
// pickTier / tradeState pipeline. The Scanner consumes the result to:
//   • assign pick.direction (CALL / PUT / NEUTRAL)
//   • attach a standard exitPlan (50% profit, 35% stop, 7 DTE close)
//   • mark hard-blocked candidates (DTE < 14, earnings inside window, VIX > 30)
//
// Field mapping note: the spec's wishlist (ema9/ema21/sma50/adx/mfi/delta/
// optionSpreadPct) is partially mapped to fields that already exist on
// SetupRow. Missing fields are treated as `undefined` and contribute 0 to the
// score, so this module is fail-soft.

import type { SetupRow } from "./setupScore";

export interface CPScoreInput {
  /** SetupRow from the existing pipeline. */
  row: SetupRow;
  /** Per-trade $ cap from strategy profile. */
  cap: number;
  /** Per-contract cost in $ (premium × 100), if known. */
  contractCost?: number;
  /** Days to expiry of the chosen contract. */
  dte?: number;
  /** Option absolute delta, if known. Skipped when undefined. */
  delta?: number;
  /** Bid–ask spread as decimal of mid (0.05 = 5%), if known. Skipped when undefined. */
  optionSpreadPct?: number;
  /** Live VIX. Skipped when undefined. */
  vix?: number;
  /** Major macro event today (CPI/FOMC/NFP). Skipped when undefined. */
  majorEventToday?: boolean;
  eventName?: string;
  /** Current ET hour 0-23. Used with majorEventToday. */
  currentHourET?: number;
}

export interface CPScoreResult {
  score: number;
  direction: "CALL" | "PUT" | "NEUTRAL";
  reasons: string[];
  exitPlan: { profitTarget: number; stopLoss: number; maxDte: number };
  hardBlocked: boolean;
  blockReason?: string;
}

const DEFAULT_EXIT = { profitTarget: 0.5, stopLoss: -0.35, maxDte: 7 };

export function scoreCandidateCP(i: CPScoreInput): CPScoreResult {
  const r = i.row;
  let score = 50;
  const reasons: string[] = [];
  let direction: "CALL" | "PUT" | "NEUTRAL" = "NEUTRAL";

  // ── HARD BLOCKS ──────────────────────────────────────────────────────────
  if (i.dte !== undefined && i.dte < 14) {
    return { score: 0, direction, reasons: [`DTE ${i.dte} < 14 — theta risk too high`], exitPlan: DEFAULT_EXIT, hardBlocked: true, blockReason: `DTE ${i.dte} < 14` };
  }
  if (r.earningsInDays != null && i.dte !== undefined && r.earningsInDays <= i.dte) {
    const reason = `Earnings in ${r.earningsInDays}d — inside ${i.dte}d hold window. IV crush risk.`;
    return { score: 0, direction, reasons: [reason], exitPlan: DEFAULT_EXIT, hardBlocked: true, blockReason: reason };
  }
  if (i.vix !== undefined && i.vix > 30) {
    const reason = `VIX ${i.vix.toFixed(1)} > 30 — premium too expensive, skip buying`;
    return { score: 0, direction, reasons: [reason], exitPlan: DEFAULT_EXIT, hardBlocked: true, blockReason: reason };
  }
  if (i.majorEventToday && (i.currentHourET ?? 0) >= 13) {
    const reason = `Major macro event today (${i.eventName ?? "event"}) — no entries after 1 PM ET`;
    return { score: 0, direction, reasons: [reason], exitPlan: DEFAULT_EXIT, hardBlocked: true, blockReason: reason };
  }

  // ── DIRECTION (mapped to existing bias + EMA distances on SetupRow) ──────
  const bullish = r.bias === "bullish" || (r.emaDist20 > 0 && r.emaDist50 > 0);
  const bearish = r.bias === "bearish" || (r.emaDist20 < 0 && r.emaDist50 < 0);
  if (bullish && !bearish) {
    direction = "CALL";
    score += 12;
    reasons.push("Bullish trend: EMA20 & EMA50 distances above zero (+12)");
  } else if (bearish && !bullish) {
    direction = "PUT";
    score += 12;
    reasons.push("Bearish trend: EMA20 & EMA50 distances below zero (+12)");
  } else {
    score -= 5;
    reasons.push("No clear trend — mixed signals (-5)");
  }

  // ── RSI momentum ─────────────────────────────────────────────────────────
  if (direction === "CALL" && r.rsi >= 50 && r.rsi <= 70) {
    score += 8; reasons.push(`RSI ${r.rsi.toFixed(0)} — bullish momentum, not overbought (+8)`);
  } else if (direction === "PUT" && r.rsi >= 30 && r.rsi <= 50) {
    score += 8; reasons.push(`RSI ${r.rsi.toFixed(0)} — bearish momentum, not oversold (+8)`);
  } else if ((direction === "CALL" && r.rsi > 75) || (direction === "PUT" && r.rsi < 25)) {
    score -= 10; reasons.push(`RSI ${r.rsi.toFixed(0)} — extreme reading, reversal risk (-10)`);
  }

  // ── Volume confirmation ──────────────────────────────────────────────────
  if (r.relVolume >= 1.5) {
    score += 10; reasons.push(`Relative volume ${r.relVolume.toFixed(1)}× — strong confirmation (+10)`);
  } else if (r.relVolume >= 1.2) {
    score += 5; reasons.push(`Relative volume ${r.relVolume.toFixed(1)}× — moderate (+5)`);
  } else if (r.relVolume < 0.8) {
    score -= 8; reasons.push(`Relative volume ${r.relVolume.toFixed(1)}× — weak, low conviction (-8)`);
  }

  // ── DTE quality ──────────────────────────────────────────────────────────
  if (i.dte !== undefined) {
    if (i.dte >= 21 && i.dte <= 45) { score += 10; reasons.push(`DTE ${i.dte} — ideal 21–45 (+10)`); }
    else if (i.dte > 45 && i.dte <= 60) { score += 5; reasons.push(`DTE ${i.dte} — slightly long (+5)`); }
    else if (i.dte >= 14 && i.dte < 21) { score -= 5; reasons.push(`DTE ${i.dte} — short, theta accelerating (-5)`); }
  }

  // ── Strike selection (delta band) ────────────────────────────────────────
  if (i.delta !== undefined) {
    const ad = Math.abs(i.delta);
    if (ad >= 0.4 && ad <= 0.6)      { score += 12; reasons.push(`Delta ${ad.toFixed(2)} — ATM, best R/R (+12)`); }
    else if (ad >= 0.3 && ad < 0.4)  { score += 6;  reasons.push(`Delta ${ad.toFixed(2)} — slightly OTM (+6)`); }
    else if (ad > 0.6 && ad <= 0.7)  { score += 8;  reasons.push(`Delta ${ad.toFixed(2)} — slightly ITM (+8)`); }
    else if (ad < 0.25)              { score -= 15; reasons.push(`Delta ${ad.toFixed(2)} — too far OTM, lottery (-15)`); }
  }

  // ── IV environment (low IV = cheap premium) ──────────────────────────────
  if (r.ivRank <= 30)       { score += 10; reasons.push(`IV rank ${r.ivRank}% — low, ideal to buy (+10)`); }
  else if (r.ivRank <= 50)  { score += 5;  reasons.push(`IV rank ${r.ivRank}% — moderate (+5)`); }
  else if (r.ivRank > 70)   { score -= 12; reasons.push(`IV rank ${r.ivRank}% — high, expensive premium (-12)`); }

  // ── VIX environment ──────────────────────────────────────────────────────
  if (i.vix !== undefined) {
    if (i.vix < 19)                      { score += 8; reasons.push(`VIX ${i.vix.toFixed(1)} < 19 — calm market (+8)`); }
    else if (i.vix <= 25)                { score += 2; reasons.push(`VIX ${i.vix.toFixed(1)} — moderate (+2)`); }
    else if (i.vix > 25 && i.vix <= 30)  { score -= 8; reasons.push(`VIX ${i.vix.toFixed(1)} — elevated (-8)`); }
  }

  // ── Liquidity (use existing optionsLiquidity 0–100 proxy when no spread) ──
  if (i.optionSpreadPct !== undefined) {
    if (i.optionSpreadPct <= 0.05)      { score += 5;  reasons.push(`Tight spread ${(i.optionSpreadPct * 100).toFixed(1)}% (+5)`); }
    else if (i.optionSpreadPct > 0.15)  { score -= 10; reasons.push(`Wide spread ${(i.optionSpreadPct * 100).toFixed(1)}% (-10)`); }
  } else {
    if (r.optionsLiquidity >= 80)       { score += 5;  reasons.push(`Options liquidity ${r.optionsLiquidity} — deep chain (+5)`); }
    else if (r.optionsLiquidity < 50)   { score -= 10; reasons.push(`Options liquidity ${r.optionsLiquidity} — thin chain (-10)`); }
  }

  // ── Budget soft penalty (real hard-drop happens in pickTier) ─────────────
  if (i.contractCost !== undefined && i.cap > 0) {
    if (i.contractCost > i.cap * 1.5) {
      score -= 5;
      reasons.push(`Contract $${i.contractCost.toFixed(0)} vs cap $${i.cap} — budget stretch (shown in watchlist)`);
    } else if (i.contractCost > i.cap) {
      score -= 2;
      reasons.push(`Contract $${i.contractCost.toFixed(0)} slightly over cap`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, direction, reasons, exitPlan: { ...DEFAULT_EXIT }, hardBlocked: false };
}

// ── Tier thresholds for the C&P engine (display-only; doesn't replace tradeState) ──
export const CP_TIERS = {
  BUY_NOW:  { min: 78, label: "BUY NOW",  color: "#00C853" },
  WATCH:    { min: 63, label: "WATCH",    color: "#FFB300" },
  ON_RADAR: { min: 50, label: "ON RADAR", color: "#42A5F5" },
  SKIP:     { min: 0,  label: "SKIP",     color: "#9E9E9E" },
} as const;

export function getTierCP(score: number): { label: string; color: string } {
  if (score >= CP_TIERS.BUY_NOW.min)  return CP_TIERS.BUY_NOW;
  if (score >= CP_TIERS.WATCH.min)    return CP_TIERS.WATCH;
  if (score >= CP_TIERS.ON_RADAR.min) return CP_TIERS.ON_RADAR;
  return CP_TIERS.SKIP;
}
