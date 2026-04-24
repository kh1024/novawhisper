// ─── FINAL CLASSIFIER ────────────────────────────────────────────────────────
// Takes all 4 scores plus hard-block flags and assigns the final pick tier.
// Single source of truth for BUY NOW / WATCHLIST / NEEDS RECHECK / AVOID.
// A pick must pass EVERY required gate to reach BUY NOW. No exceptions.

import type { ContractScoreResult } from "@/lib/scoring/contractScore";
import type { ExecutionScoreResult } from "@/lib/scoring/executionScore";
import type { QuoteIntegrityReport } from "@/lib/quotes/quoteTypes";

// All thresholds loosened by 25% for easier qualification.
export const CLASSIFIER_THRESHOLDS = {
  BUY_NOW_SETUP_MIN: 49,        // 65 → 49
  BUY_NOW_CONTRACT_MIN: 45,     // 60 → 45
  BUY_NOW_EXECUTION_MIN: 49,    // 65 → 49
  BUY_NOW_QUOTE_MIN: 56,        // 75 → 56
  WATCHLIST_SETUP_MIN: 38,      // 50 → 38
  WATCHLIST_CONTRACT_MIN: 30,   // 40 → 30
  AVOID_FINAL_SCORE_MAX: 23,    // 30 → 23
  HARD_BLOCK_CONTRACT_MAX: 15,  // 20 → 15
  HARD_BLOCK_QUOTE_MAX: 15,     // 20 → 15
} as const;

export interface ClassifierInput {
  setup_score: number;
  contract_score: number;
  execution_score: number;
  quote_confidence_score: number;
  final_score: number;
  contractResult: ContractScoreResult;
  executionResult: ExecutionScoreResult;
  quoteReport?: QuoteIntegrityReport;
  userBudgetCap: number;
  sessionMode: string;
  earningsToday?: boolean;
  majorEventToday?: boolean;
}

export type FinalTier = "BUY NOW" | "WATCHLIST" | "NEEDS RECHECK" | "AVOID";

export interface FailingGate {
  gate: string;
  score: number;
  minimum: number;
  reason: string;
}

export interface ClassifierResult {
  tier: FinalTier;
  tier_reason: string;
  failing_gates: FailingGate[];
  upgrade_path: string[];
  is_hard_blocked: boolean;
}

export function classifyPick(input: ClassifierInput): ClassifierResult {
  const {
    setup_score, contract_score, execution_score, quote_confidence_score,
    final_score, contractResult, executionResult, quoteReport,
    userBudgetCap, sessionMode,
  } = input;

  const failingGates: FailingGate[] = [];
  const upgradePath: string[] = [];

  // ── HARD BLOCKS ──
  if (contractResult.hard_blocked) {
    return {
      tier: "AVOID",
      tier_reason: contractResult.hard_block_reason ?? "Contract data invalid.",
      failing_gates: [{ gate: "Contract", score: 0, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_CONTRACT_MIN, reason: contractResult.hard_block_reason ?? "" }],
      upgrade_path: ["Fix contract data or choose a different strike/expiry."],
      is_hard_blocked: true,
    };
  }

  const hardQuoteBlocks = quoteReport?.blockReasons ?? [];
  if (hardQuoteBlocks.length > 0) {
    return {
      tier: "AVOID",
      tier_reason: hardQuoteBlocks[0],
      failing_gates: [{ gate: "Quote Integrity", score: quote_confidence_score, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_QUOTE_MIN, reason: hardQuoteBlocks[0] }],
      upgrade_path: ["Wait for fresh quote data before evaluating this pick."],
      is_hard_blocked: true,
    };
  }

  if (contractResult.budget_fit === "OVER_BUDGET" && contractResult.realistic_fill > userBudgetCap * 2) {
    return {
      tier: "AVOID",
      tier_reason: `Contract costs $${contractResult.realistic_fill.toFixed(0)} — over 2× your $${userBudgetCap} cap.`,
      failing_gates: [{ gate: "Budget", score: 0, minimum: 1, reason: `Contract cost $${contractResult.realistic_fill.toFixed(0)} vs cap $${userBudgetCap}` }],
      upgrade_path: [`Find a lower-strike or further-dated contract under $${userBudgetCap}.`],
      is_hard_blocked: true,
    };
  }

  if (input.earningsToday) {
    return {
      tier: "AVOID",
      tier_reason: "Earnings today — IV crush risk makes entry extremely dangerous.",
      failing_gates: [{ gate: "Earnings Risk", score: 0, minimum: 1, reason: "Earnings event today" }],
      upgrade_path: ["Wait until after earnings if the setup survives."],
      is_hard_blocked: true,
    };
  }

  if (contract_score <= CLASSIFIER_THRESHOLDS.HARD_BLOCK_CONTRACT_MAX) {
    return {
      tier: "AVOID",
      tier_reason: `Contract score ${contract_score}/100 — ${contractResult.plain_english_reason}`,
      failing_gates: [{ gate: "Contract Quality", score: contract_score, minimum: CLASSIFIER_THRESHOLDS.HARD_BLOCK_CONTRACT_MAX, reason: contractResult.plain_english_reason }],
      upgrade_path: ["Choose a different strike with tighter spread, better liquidity, and appropriate delta."],
      is_hard_blocked: true,
    };
  }

  // ── BUY NOW GATES ──
  if (setup_score < CLASSIFIER_THRESHOLDS.BUY_NOW_SETUP_MIN) {
    failingGates.push({ gate: "Setup Quality", score: setup_score, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_SETUP_MIN, reason: `Setup score ${setup_score} — trend or momentum not strong enough.` });
    upgradePath.push("Wait for stronger trend alignment (EMA cross, price above key MA, volume pickup).");
  }
  if (contract_score < CLASSIFIER_THRESHOLDS.BUY_NOW_CONTRACT_MIN) {
    failingGates.push({ gate: "Contract Quality", score: contract_score, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_CONTRACT_MIN, reason: contractResult.plain_english_reason });
    upgradePath.push("Find a more liquid contract with tighter spread and appropriate delta.");
  }
  if (execution_score < CLASSIFIER_THRESHOLDS.BUY_NOW_EXECUTION_MIN) {
    failingGates.push({ gate: "Execution Readiness", score: execution_score, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_EXECUTION_MIN, reason: executionResult.plain_english_reason });
    upgradePath.push(executionResult.execution_label === "WATCH_FOR_TRIGGER"
      ? "Wait for live trigger confirmation and volume pickup."
      : "Wait for regular market hours with fresh quotes.");
  }
  if (quote_confidence_score < CLASSIFIER_THRESHOLDS.BUY_NOW_QUOTE_MIN) {
    failingGates.push({ gate: "Quote Confidence", score: quote_confidence_score, minimum: CLASSIFIER_THRESHOLDS.BUY_NOW_QUOTE_MIN, reason: `Quote confidence ${quote_confidence_score}/100 — data quality too low to act on.` });
    upgradePath.push("Wait for a fresh real-time quote from Massive or Polygon.");
  }
  if (contractResult.budget_fit === "OVER_BUDGET") {
    failingGates.push({ gate: "Budget", score: 0, minimum: 1, reason: `Contract $${contractResult.realistic_fill.toFixed(0)} exceeds your $${userBudgetCap} cap.` });
    upgradePath.push(`Choose a lower-cost strike or reduce contract count to fit $${userBudgetCap}.`);
  }
  if (sessionMode !== "MARKET_OPEN") {
    failingGates.push({ gate: "Session", score: 0, minimum: 1, reason: `Market is ${sessionMode.replace("_", " ").toLowerCase()} — no Buy Now outside regular session.` });
    upgradePath.push("Wait for regular market hours (9:30 AM – 4:00 PM ET).");
  }

  if (failingGates.length === 0) {
    return { tier: "BUY NOW", tier_reason: "All 4 score gates passed. Live entry conditions met.", failing_gates: [], upgrade_path: [], is_hard_blocked: false };
  }

  const isWatchlist = (
    setup_score >= CLASSIFIER_THRESHOLDS.WATCHLIST_SETUP_MIN &&
    contract_score >= CLASSIFIER_THRESHOLDS.WATCHLIST_CONTRACT_MIN &&
    failingGates.every((g) => ["Execution Readiness", "Session", "Quote Confidence", "Budget"].includes(g.gate))
  );

  if (isWatchlist) {
    return {
      tier: "WATCHLIST",
      tier_reason: buildWatchlistReason(failingGates[0], executionResult, sessionMode),
      failing_gates: failingGates,
      upgrade_path: upgradePath,
      is_hard_blocked: false,
    };
  }

  const isRecheck = (
    setup_score >= CLASSIFIER_THRESHOLDS.WATCHLIST_SETUP_MIN &&
    contract_score >= CLASSIFIER_THRESHOLDS.WATCHLIST_CONTRACT_MIN &&
    failingGates.some((g) => g.gate === "Quote Confidence") &&
    (quoteReport?.warnReasons.some((r) => r.includes("stale") || r.includes("conflict") || r.includes("disagree")) ?? false)
  );

  if (isRecheck) {
    return {
      tier: "NEEDS RECHECK",
      tier_reason: "Quote data issue — refresh before acting. Setup may still be valid.",
      failing_gates: failingGates,
      upgrade_path: ["Refresh quote data. If data clears up, this could move to Watchlist or Buy Now."],
      is_hard_blocked: false,
    };
  }

  if (final_score <= CLASSIFIER_THRESHOLDS.AVOID_FINAL_SCORE_MAX || failingGates.length >= 3) {
    const topReason = [...failingGates].sort((a, b) => a.score - b.score)[0];
    return {
      tier: "AVOID",
      tier_reason: topReason?.reason ?? "Multiple quality gates failed.",
      failing_gates: failingGates,
      upgrade_path: upgradePath,
      is_hard_blocked: false,
    };
  }

  return {
    tier: "WATCHLIST",
    tier_reason: `Partial qualification — ${failingGates.length} gate(s) not met. Monitor this pick.`,
    failing_gates: failingGates,
    upgrade_path: upgradePath,
    is_hard_blocked: false,
  };
}

function buildWatchlistReason(primaryFail: FailingGate, execution: ExecutionScoreResult, sessionMode: string): string {
  if (sessionMode === "CLOSED") return "Market closed — setting up for next session.";
  if (sessionMode === "AFTER_HOURS") return "After hours — reviewing for tomorrow.";
  if (sessionMode === "PRE_MARKET") return "Pre-market — watching for open confirmation.";

  switch (primaryFail.gate) {
    case "Execution Readiness":
      if (!execution.trigger_confirmed) return "Good idea, not a good entry yet — waiting for trigger.";
      if (!execution.volume_confirmed) return "Setup valid, volume not confirming the move yet.";
      if (execution.price_vs_zone === "TOO_EXTENDED") return "Extended past entry zone — wait for pullback.";
      return execution.plain_english_reason;
    case "Quote Confidence":
      return "Quote quality needs to improve before entering — monitoring.";
    case "Budget":
      return "Contract slightly over budget — tracking. Consider smaller size or different strike.";
    default:
      return `${primaryFail.gate} gate not met — monitoring for improvement.`;
  }
}
