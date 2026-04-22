// ─── CONTRACT SCORE ───────────────────────────────────────────────────────────
// Grades an option contract on its own merits:
//   spread quality, liquidity, delta fit, greeks availability,
//   cost vs budget, DTE fit, and quote validity.
//
// Returns 0–100. Below 40 = hard avoid. Below 60 = cannot be Buy Now.
// This score is kept SEPARATE from setup_score on purpose.
// A ticker can have a perfect chart and a terrible contract. They must not blend.

import { QUOTE_THRESHOLDS } from "@/lib/quotes/quoteProvider";
import type { NormalizedOptionQuote } from "@/lib/quotes/quoteTypes";

export interface ContractScoreInput {
  optionQuote: NormalizedOptionQuote;
  userBudgetCap: number;
  targetDteLow: number;
  targetDteHigh: number;
  targetDeltaLow: number;
  targetDeltaHigh: number;
}

export interface ContractScoreComponent {
  label: string;
  points: number;
  note: string;
}

export interface ContractScoreResult {
  contract_score: number;
  contract_grade: "EXCELLENT" | "GOOD" | "MEDIUM" | "POOR" | "BAD";
  spread_pct: number;
  spread_label: "TIGHT" | "OK" | "WIDE" | "TOO_WIDE";
  liquidity_score: number;
  delta_fit: "IDEAL" | "OK" | "TOO_FAR_OTM" | "DEEP_ITM";
  dte_fit: "IDEAL" | "SHORT" | "LONG" | "DANGER";
  greeks_available: boolean;
  realistic_fill: number;
  budget_fit: "GOOD" | "TIGHT" | "OVER_BUDGET";
  budget_pct_used: number;
  hard_blocked: boolean;
  hard_block_reason?: string;
  score_components: ContractScoreComponent[];
  plain_english_reason: string;
}

export function computeContractScore(input: ContractScoreInput): ContractScoreResult {
  const { optionQuote: q, userBudgetCap, targetDteLow, targetDteHigh, targetDeltaLow, targetDeltaHigh } = input;
  const components: ContractScoreComponent[] = [];
  let score = 50;

  // Hard blocks
  if (q.bid <= 0 || q.ask <= 0) return hardBlock("Invalid quote: bid or ask is zero or negative.", q, userBudgetCap);
  if (q.ask < q.bid) return hardBlock("Crossed market: ask is lower than bid. Quote is broken.", q, userBudgetCap);
  if (q.source === "UNKNOWN") return hardBlock("No quote source available. Cannot evaluate contract.", q, userBudgetCap);

  // Spread (±25)
  let spreadLabel: ContractScoreResult["spread_label"];
  if (q.spreadPct <= QUOTE_THRESHOLDS.SPREAD_NARROW_PCT) {
    score += 25; spreadLabel = "TIGHT";
    components.push({ label: "Spread", points: 25, note: `${(q.spreadPct * 100).toFixed(1)}% — tight, excellent fill quality` });
  } else if (q.spreadPct <= QUOTE_THRESHOLDS.SPREAD_OK_PCT) {
    score += 12; spreadLabel = "OK";
    components.push({ label: "Spread", points: 12, note: `${(q.spreadPct * 100).toFixed(1)}% — acceptable, some slippage expected` });
  } else if (q.spreadPct <= QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT) {
    score -= 10; spreadLabel = "WIDE";
    components.push({ label: "Spread", points: -10, note: `${(q.spreadPct * 100).toFixed(1)}% — wide, fill quality poor` });
  } else {
    score -= 25; spreadLabel = "TOO_WIDE";
    components.push({ label: "Spread", points: -25, note: `${(q.spreadPct * 100).toFixed(1)}% — too wide, execution risk severe` });
  }

  // Volume (±15)
  if (q.volume >= 500) { score += 15; components.push({ label: "Option Volume", points: 15, note: `${q.volume.toLocaleString()} contracts today — strong` }); }
  else if (q.volume >= 200) { score += 10; components.push({ label: "Option Volume", points: 10, note: `${q.volume.toLocaleString()} contracts — good` }); }
  else if (q.volume >= 50) { score += 4; components.push({ label: "Option Volume", points: 4, note: `${q.volume.toLocaleString()} contracts — acceptable` }); }
  else if (q.volume >= 10) { score -= 8; components.push({ label: "Option Volume", points: -8, note: `${q.volume.toLocaleString()} contracts — thin, exit risk` }); }
  else { score -= 18; components.push({ label: "Option Volume", points: -18, note: `${q.volume} contracts — very low, illiquid` }); }

  // OI (±12)
  if (q.openInterest >= 2000) { score += 12; components.push({ label: "Open Interest", points: 12, note: `${q.openInterest.toLocaleString()} OI — deep market` }); }
  else if (q.openInterest >= 500) { score += 7; components.push({ label: "Open Interest", points: 7, note: `${q.openInterest.toLocaleString()} OI — good depth` }); }
  else if (q.openInterest >= 100) { score += 2; components.push({ label: "Open Interest", points: 2, note: `${q.openInterest.toLocaleString()} OI — acceptable` }); }
  else { score -= 15; components.push({ label: "Open Interest", points: -15, note: `${q.openInterest} OI — very low, hard to exit` }); }

  const liquidityScore = Math.max(0, Math.min(100,
    (q.volume >= 200 ? 40 : q.volume >= 50 ? 25 : 10) +
    (q.openInterest >= 500 ? 40 : q.openInterest >= 100 ? 25 : 8) +
    (q.spreadPct <= 0.10 ? 20 : q.spreadPct <= 0.15 ? 12 : 0)
  ));

  // Delta (±18)
  const absDelta = Math.abs(q.delta);
  let deltaFit: ContractScoreResult["delta_fit"];
  if (absDelta >= targetDeltaLow && absDelta <= targetDeltaHigh) {
    score += 12; deltaFit = "IDEAL";
    components.push({ label: "Delta", points: 12, note: `Δ${absDelta.toFixed(2)} — ATM/near-ATM, ideal risk/reward` });
  } else if (absDelta >= 0.28 && absDelta < targetDeltaLow) {
    score += 5; deltaFit = "OK";
    components.push({ label: "Delta", points: 5, note: `Δ${absDelta.toFixed(2)} — slightly OTM, acceptable` });
  } else if (absDelta > targetDeltaHigh && absDelta <= 0.75) {
    score += 6; deltaFit = "OK";
    components.push({ label: "Delta", points: 6, note: `Δ${absDelta.toFixed(2)} — slightly ITM, higher cost but higher probability` });
  } else if (absDelta < 0.20) {
    score -= 18; deltaFit = "TOO_FAR_OTM";
    components.push({ label: "Delta", points: -18, note: `Δ${absDelta.toFixed(2)} — far OTM lottery ticket. Avoid.` });
  } else {
    score -= 6; deltaFit = "DEEP_ITM";
    components.push({ label: "Delta", points: -6, note: `Δ${absDelta.toFixed(2)} — deep ITM, expensive, low leverage` });
  }

  // DTE (±20)
  let dteFit: ContractScoreResult["dte_fit"];
  if (q.dte >= targetDteLow && q.dte <= targetDteHigh) {
    score += 10; dteFit = "IDEAL";
    components.push({ label: "DTE", points: 10, note: `${q.dte} DTE — ideal window (${targetDteLow}–${targetDteHigh} days)` });
  } else if (q.dte > targetDteHigh && q.dte <= 60) {
    score += 4; dteFit = "LONG";
    components.push({ label: "DTE", points: 4, note: `${q.dte} DTE — longer than ideal but manageable` });
  } else if (q.dte >= 14 && q.dte < targetDteLow) {
    score -= 5; dteFit = "SHORT";
    components.push({ label: "DTE", points: -5, note: `${q.dte} DTE — short, theta accelerating` });
  } else if (q.dte < 14) {
    score -= 20; dteFit = "DANGER";
    components.push({ label: "DTE", points: -20, note: `${q.dte} DTE — too short, theta destroying value daily` });
  } else {
    dteFit = "LONG";
    components.push({ label: "DTE", points: 0, note: `${q.dte} DTE — very long, limited leverage` });
  }

  // Greeks
  const greeksAvailable = q.iv > 0 && q.delta !== 0 && q.theta !== 0;
  if (greeksAvailable) { score += 8; components.push({ label: "Greeks", points: 8, note: "IV, delta, theta available — full risk picture visible" }); }
  else { score -= 12; components.push({ label: "Greeks", points: -12, note: "Greeks missing or zero — cannot assess risk properly" }); }

  // IV sanity
  if (q.iv > 0) {
    if (q.iv < 0.20) { score += 5; components.push({ label: "IV", points: 5, note: `IV ${(q.iv * 100).toFixed(0)}% — low, premium cheap` }); }
    else if (q.iv > 1.00) { score -= 8; components.push({ label: "IV", points: -8, note: `IV ${(q.iv * 100).toFixed(0)}% — very high, buying expensive premium` }); }
    else if (q.iv > 0.60) { score -= 4; components.push({ label: "IV", points: -4, note: `IV ${(q.iv * 100).toFixed(0)}% — elevated, be cautious` }); }
  }

  // Budget
  const realisticFill = q.ask * 100;
  const budgetPctUsed = userBudgetCap > 0 ? realisticFill / userBudgetCap : 0;
  let budgetFit: ContractScoreResult["budget_fit"] = "GOOD";
  if (userBudgetCap > 0) {
    if (realisticFill > userBudgetCap * 2.0) {
      score -= 20; budgetFit = "OVER_BUDGET";
      components.push({ label: "Budget", points: -20, note: `$${realisticFill.toFixed(0)} is ${(budgetPctUsed * 100).toFixed(0)}% of your $${userBudgetCap} cap — severely over budget` });
    } else if (realisticFill > userBudgetCap) {
      score -= 8; budgetFit = "OVER_BUDGET";
      components.push({ label: "Budget", points: -8, note: `$${realisticFill.toFixed(0)} exceeds your $${userBudgetCap} cap` });
    } else if (realisticFill > userBudgetCap * 0.85) {
      score -= 3; budgetFit = "TIGHT";
      components.push({ label: "Budget", points: -3, note: `$${realisticFill.toFixed(0)} — near your cap, tight fit` });
    } else {
      components.push({ label: "Budget", points: 0, note: `$${realisticFill.toFixed(0)} — fits budget well` });
    }
  }

  // BS-lite penalty
  if (q.source === "BSLITE") {
    score -= 20;
    components.push({ label: "Quote Source", points: -20, note: "Price estimated via model (BS-lite) — not a real market quote. Verify in broker." });
  }

  score = Math.max(0, Math.min(100, score));
  const grade: ContractScoreResult["contract_grade"] =
    score >= 80 ? "EXCELLENT" :
    score >= 65 ? "GOOD" :
    score >= 50 ? "MEDIUM" :
    score >= 35 ? "POOR" : "BAD";

  const worstComponent = [...components].sort((a, b) => a.points - b.points)[0];
  const plainEnglishReason = buildContractReason(grade, spreadLabel, deltaFit, dteFit, budgetFit, worstComponent, q);

  return {
    contract_score: score,
    contract_grade: grade,
    spread_pct: q.spreadPct,
    spread_label: spreadLabel,
    liquidity_score: liquidityScore,
    delta_fit: deltaFit,
    dte_fit: dteFit,
    greeks_available: greeksAvailable,
    realistic_fill: realisticFill,
    budget_fit: budgetFit,
    budget_pct_used: budgetPctUsed,
    hard_blocked: false,
    score_components: components,
    plain_english_reason: plainEnglishReason,
  };
}

function hardBlock(reason: string, q: NormalizedOptionQuote, budgetCap: number): ContractScoreResult {
  return {
    contract_score: 0,
    contract_grade: "BAD",
    spread_pct: q.spreadPct,
    spread_label: "TOO_WIDE",
    liquidity_score: 0,
    delta_fit: "TOO_FAR_OTM",
    dte_fit: q.dte < 14 ? "DANGER" : "SHORT",
    greeks_available: false,
    realistic_fill: q.ask * 100,
    budget_fit: q.ask * 100 > budgetCap ? "OVER_BUDGET" : "GOOD",
    budget_pct_used: budgetCap > 0 ? (q.ask * 100) / budgetCap : 0,
    hard_blocked: true,
    hard_block_reason: reason,
    score_components: [{ label: "Hard Block", points: -100, note: reason }],
    plain_english_reason: reason,
  };
}

function buildContractReason(
  grade: string, spread: string, delta: string, dte: string, budget: string,
  worst: ContractScoreComponent | undefined, q: NormalizedOptionQuote,
): string {
  if (budget === "OVER_BUDGET") return `Contract costs $${(q.ask * 100).toFixed(0)} — over your budget using real ask price.`;
  if (spread === "TOO_WIDE") return `Option spread ${(q.spreadPct * 100).toFixed(1)}% — too wide for a clean fill.`;
  if (delta === "TOO_FAR_OTM") return `Strike is too far out of the money (Δ${Math.abs(q.delta).toFixed(2)}). Needs big move just to profit.`;
  if (dte === "DANGER") return `Only ${q.dte} days to expiration — theta eating value daily.`;
  if (spread === "WIDE") return `Spread ${(q.spreadPct * 100).toFixed(1)}% — wide, expect slippage on fill.`;
  if (grade === "EXCELLENT") return `Clean contract. Tight spread, good liquidity, ATM strike.`;
  if (grade === "GOOD") return `Solid contract. ${worst?.note ?? "Minor issues only."}`;
  return worst?.note ?? "Contract quality is marginal.";
}
