// Fail-soft pick-tier classifier. The old pipeline used a long chain of
// AND-gates which produced "0 BUY NOW" days mid-market. This module replaces
// the binary TradeReady/WatchlistOnly decision with three score-based tiers
// so each risk bucket is never empty during market hours.
//
//   • CLEAN          — safetyPass && score ≥ 70  (the gold standard)
//   • NEAR-LIMIT     — safetyPass && score ≥ 60  AND one soft rule relaxed
//                       (over-budget within 50%, or IVP slightly above cap)
//   • BEST-OF-WAIT   — safetyPass && score ≥ 55  AND ≤1 non-safety rule fails
//
// Selector contract: pull CLEAN first, then NEAR-LIMIT, then BEST-OF-WAIT
// until MIN_BUY_NOW_PER_BUCKET (default 3) is hit per bucket.

export type PickTier = "CLEAN" | "NEAR-LIMIT" | "BEST-OF-WAIT" | "OVER_BUDGET_WATCHLIST" | "EXCLUDED";

/** Min raw setup score to qualify a severely-over-budget pick as "Worth Watching". */
export const OVER_BUDGET_WATCHLIST_MIN_SCORE = 65;

export const MIN_BUY_NOW_PER_BUCKET = 3;
/** Soft budget band — picks within ±50% of cap incur only a small penalty. */
export const BUDGET_SOFT_BAND_PCT = 0.5;
/** Hard cap — anything above 20× the per-trade target is auto-dropped. */
export const BUDGET_HARD_DROP_MULT = 20;

export interface TierInputs {
  /** Final 0-100 score from rankSetup. */
  score: number;
  /** True only when basic safety gates pass (liquidity, spread, etc.). */
  safetyPass: boolean;
  /** Per-contract cost in $ (premium × 100). */
  contractCost: number;
  /** Per-trade $ cap from user's budget settings. */
  cap: number;
  /** Number of non-safety rules currently failing (e.g. weak vol, gap). */
  nonSafetyRuleFailures: number;
  /** IV rank/percentile; > 80 is "elevated". */
  ivRank?: number | null;
}

export interface TierResult {
  tier: PickTier;
  /** Score AFTER soft-penalty deductions (used for ranking). */
  adjustedScore: number;
  /** The penalties subtracted from raw score. */
  penalties: { code: string; points: number; reason: string }[];
  /** Why this pick is NEAR-LIMIT or BEST-OF-WAIT (UI tooltip). */
  caveat: string | null;
  /** True when contractCost > 10× cap — caller should hard-drop. */
  hardDrop: boolean;
  /** True when raw score >= OVER_BUDGET_WATCHLIST_MIN_SCORE AND contract is
   *  severely over budget (>50% of cap). The Scanner pipeline uses this
   *  flag to surface the pick in the "Strong Setups — Over Budget" section
   *  even though it's also routed to budgetBlocked for back-compat. */
  overBudgetWorthWatching: boolean;
}

export function classifyPickTier(i: TierInputs): TierResult {
  const penalties: TierResult["penalties"] = [];
  const cap = Math.max(1, i.cap);

  // ── Soft budget penalty ─────────────────────────────────────────────────
  // Within band → 0.  Outside band → up to -15.  >10× cap → hard drop.
  const ratio = i.contractCost / cap;
  let budgetNearLimit = false;
  // Severe-but-not-hard-drop overshoot (>50% over cap, ≤20× cap) AND a
  // strong raw setup score → flag as "worth watching" so the Scanner can
  // surface this in its dedicated section even though it's still over budget.
  const severeOverBudget = ratio > 1 + BUDGET_SOFT_BAND_PCT && ratio <= BUDGET_HARD_DROP_MULT;
  const overBudgetWorthWatching = severeOverBudget && i.score >= OVER_BUDGET_WATCHLIST_MIN_SCORE && i.safetyPass;

  if (ratio > BUDGET_HARD_DROP_MULT) {
    return {
      tier: "EXCLUDED",
      adjustedScore: 0,
      penalties: [{ code: "BUDGET_HARD_DROP", points: 0,
        reason: `Cost $${i.contractCost.toFixed(0)} > ${BUDGET_HARD_DROP_MULT}× cap $${cap}` }],
      caveat: "Cost > 10× per-trade cap",
      hardDrop: true,
      overBudgetWorthWatching: false,
    };
  }
  if (ratio > 1 + BUDGET_SOFT_BAND_PCT) {
    // Outside the +50% band — meaningful penalty proportional to overshoot.
    const over = Math.min(2, ratio - 1);              // cap at 200% over
    const pts = -Math.round(over * 12);               // up to -24
    penalties.push({
      code: "BUDGET_OVER_BAND", points: pts,
      reason: `Cost $${i.contractCost.toFixed(0)} is ${((ratio - 1) * 100).toFixed(0)}% over cap $${cap}`,
    });
  } else if (ratio > 1) {
    budgetNearLimit = true;
    penalties.push({
      code: "BUDGET_NEAR_LIMIT", points: -4,
      reason: `Cost $${i.contractCost.toFixed(0)} slightly above cap $${cap} (within +50%)`,
    });
  }

  // ── IVP near-limit flag (only used to qualify NEAR-LIMIT tier) ───────────
  const ivpNearLimit = (i.ivRank ?? 0) > 75 && (i.ivRank ?? 0) <= 90;
  if (ivpNearLimit) {
    penalties.push({ code: "IVP_ELEVATED", points: -3,
      reason: `IV rank ${i.ivRank} is elevated but not extreme.` });
  }

  const penaltyTotal = penalties.reduce((s, p) => s + p.points, 0);
  const adjustedScore = Math.max(0, Math.min(100, Math.round(i.score + penaltyTotal)));

  // ── Tier decision ────────────────────────────────────────────────────────
  if (!i.safetyPass) {
    return { tier: "EXCLUDED", adjustedScore, penalties, caveat: "Failed safety gate", hardDrop: false, overBudgetWorthWatching: false };
  }

  if (adjustedScore >= 60 && !budgetNearLimit && !ivpNearLimit && i.nonSafetyRuleFailures === 0) {
    return { tier: "CLEAN", adjustedScore, penalties, caveat: null, hardDrop: false, overBudgetWorthWatching };
  }

  if (adjustedScore >= 50 && (budgetNearLimit || ivpNearLimit || i.nonSafetyRuleFailures <= 1)) {
    const reasons: string[] = [];
    if (budgetNearLimit) reasons.push("slightly over budget");
    if (ivpNearLimit) reasons.push("IV elevated");
    if (i.nonSafetyRuleFailures > 0) reasons.push("1 soft rule relaxed");
    return { tier: "NEAR-LIMIT", adjustedScore, penalties,
      caveat: reasons.join(" · ") || "near limits", hardDrop: false, overBudgetWorthWatching };
  }

  if (adjustedScore >= 45 && i.nonSafetyRuleFailures <= 1) {
    return { tier: "BEST-OF-WAIT", adjustedScore, penalties,
      caveat: "Best of WAIT — 1 rule relaxed", hardDrop: false, overBudgetWorthWatching };
  }

  return { tier: "EXCLUDED", adjustedScore, penalties,
    caveat: `score ${adjustedScore} too low or >1 rule failing`, hardDrop: false, overBudgetWorthWatching };
}

export const TIER_LABEL: Record<PickTier, string> = {
  "CLEAN":                 "✅ Clean Pass",
  "NEAR-LIMIT":            "⚠️ Near limits — reduce size",
  "BEST-OF-WAIT":          "🟡 Best of WAIT — 1 rule relaxed",
  "OVER_BUDGET_WATCHLIST": "💰 Worth watching — over budget",
  "EXCLUDED":              "⛔ Excluded",
};

export const TIER_CLASSES: Record<PickTier, string> = {
  "CLEAN":                 "border-bullish/40 bg-bullish/10 text-bullish",
  "NEAR-LIMIT":            "border-warning/40 bg-warning/10 text-warning",
  "BEST-OF-WAIT":          "border-primary/40 bg-primary/10 text-primary",
  "OVER_BUDGET_WATCHLIST": "border-orange-600/40 bg-orange-600/10 text-orange-300",
  "EXCLUDED":              "border-bearish/40 bg-bearish/10 text-bearish",
};

/** Numeric rank for ordering: CLEAN > NEAR-LIMIT > BEST-OF-WAIT > OVER_BUDGET_WATCHLIST > EXCLUDED. */
export function tierRank(t: PickTier): number {
  if (t === "CLEAN") return 4;
  if (t === "NEAR-LIMIT") return 3;
  if (t === "BEST-OF-WAIT") return 2;
  if (t === "OVER_BUDGET_WATCHLIST") return 1;
  return 0;
}

export const TIER_LABEL: Record<PickTier, string> = {
  "CLEAN":        "✅ Clean Pass",
  "NEAR-LIMIT":   "⚠️ Near limits — reduce size",
  "BEST-OF-WAIT": "🟡 Best of WAIT — 1 rule relaxed",
  "EXCLUDED":     "⛔ Excluded",
};

export const TIER_CLASSES: Record<PickTier, string> = {
  "CLEAN":        "border-bullish/40 bg-bullish/10 text-bullish",
  "NEAR-LIMIT":   "border-warning/40 bg-warning/10 text-warning",
  "BEST-OF-WAIT": "border-primary/40 bg-primary/10 text-primary",
  "EXCLUDED":     "border-bearish/40 bg-bearish/10 text-bearish",
};

/** Numeric rank for ordering: CLEAN > NEAR-LIMIT > BEST-OF-WAIT > EXCLUDED. */
export function tierRank(t: PickTier): number {
  return t === "CLEAN" ? 3 : t === "NEAR-LIMIT" ? 2 : t === "BEST-OF-WAIT" ? 1 : 0;
}
