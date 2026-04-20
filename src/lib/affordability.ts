// ─────────────────────────────────────────────────────────────────────────────
// Affordability — the SINGLE source of truth for "can I actually afford
// this trade given my Settings budget?".
//
// Why this file exists:
//   The user's per-trade budget (from Settings → Capital) is a HARD rule, not
//   a hint. Every recommendation surface (Dashboard "Top Opportunities", the
//   Scanner, the Research Drawer's Trade Plan card, Nova) must run prospective
//   trades through `classifyAffordability()` BEFORE scoring/ranking and must
//   never display a Blocked trade as a top pick.
//
// What "total cost" means here:
//   For long calls/puts:  optionAsk × 100 + entry-side fees
//   For debit spreads:    netDebit  × 100 + entry-side fees
//   For unknown pricing:  null  → tier = "unavailable"  (excluded)
//   For stale data:       null  → tier = "stale"        (excluded)
//
// Tiers (relative to user budget B):
//   Comfortable  total ≤ 0.70 × B
//   Affordable   total ≤ 1.00 × B
//   Blocked      total >  1.00 × B
//   Unavailable  total cannot be calculated
//   Stale        live quote feed marked the contract stale ($0 mid/last etc.)
// ─────────────────────────────────────────────────────────────────────────────
import type { AppSettings } from "./settings";
import { feeOneSide } from "./fees";

export type AffordabilityTier =
  | "comfortable"
  | "affordable"
  | "blocked"
  | "unavailable"
  | "stale";

export interface AffordabilityInput {
  /** The "you'd pay this per share" number — broker ASK for longs, NET DEBIT for spreads. */
  perShareCost: number | null | undefined;
  /** Number of contracts. Defaults to 1. We enforce per-1-contract by default. */
  contracts?: number;
  /** True if the underlying quote / option chain is stale (e.g. weekend frozen). */
  stale?: boolean;
  /** Settings — used for fees. */
  settings?: AppSettings | null;
}

export interface AffordabilityResult {
  tier: AffordabilityTier;
  /** Dollar cost the user would actually pay to OPEN this trade (ask × 100 + entry fees). */
  totalCost: number | null;
  /** Entry-side fees included in totalCost. */
  feeCost: number;
  /** User's per-trade cap from Settings. */
  budget: number;
  /** Positive when over budget — exact dollar gap the trade exceeds the cap by. */
  overBy: number;
  /** Human reason — short enough to render in a chip. */
  reason: string;
  /** True only when tier is "comfortable" or "affordable" AND totalCost is real. */
  recommendable: boolean;
}

/** 70% of budget = the "Comfortable" threshold per spec. */
export const COMFORTABLE_FRACTION = 0.70;

/**
 * Classify a single prospective trade against the user's Settings budget.
 * This function is INTENTIONALLY pure (no React, no I/O) so it can run inside
 * memoized selectors and unit tests.
 */
export function classifyAffordability(
  budget: number,
  input: AffordabilityInput,
): AffordabilityResult {
  const contracts = Math.max(1, Math.floor(input.contracts ?? 1));
  const safeBudget = Number.isFinite(budget) && budget > 0 ? budget : 0;
  const fee = input.settings ? feeOneSide(input.settings, contracts) : 0;

  // ── 1. Stale quote → exclude entirely. Pricing isn't trustworthy. ──
  if (input.stale) {
    return {
      tier: "stale",
      totalCost: null,
      feeCost: fee,
      budget: safeBudget,
      overBy: 0,
      reason: "Stale quote — wait for live data",
      recommendable: false,
    };
  }

  // ── 2. No usable price → "Pricing unavailable". Excluded per spec §9. ──
  const ps = input.perShareCost;
  if (!Number.isFinite(ps as number) || (ps as number) <= 0) {
    return {
      tier: "unavailable",
      totalCost: null,
      feeCost: fee,
      budget: safeBudget,
      overBy: 0,
      reason: "Pricing unavailable",
      recommendable: false,
    };
  }

  const totalCost = (ps as number) * 100 * contracts + fee;

  // ── 3. No budget set → caller should require one. We mark unavailable so
  //       no recommendation slips through, but pass through totalCost so the
  //       UI can still render the dollar amount as a hint. ──
  if (safeBudget <= 0) {
    return {
      tier: "unavailable",
      totalCost,
      feeCost: fee,
      budget: 0,
      overBy: 0,
      reason: "Set a budget in Settings first",
      recommendable: false,
    };
  }

  // ── 4. Bucket by fraction of budget. ──
  if (totalCost > safeBudget) {
    return {
      tier: "blocked",
      totalCost,
      feeCost: fee,
      budget: safeBudget,
      overBy: +(totalCost - safeBudget).toFixed(2),
      reason: `Exceeds budget by $${Math.round(totalCost - safeBudget).toLocaleString()}`,
      recommendable: false,
    };
  }
  if (totalCost <= safeBudget * COMFORTABLE_FRACTION) {
    return {
      tier: "comfortable",
      totalCost,
      feeCost: fee,
      budget: safeBudget,
      overBy: 0,
      reason: "Comfortably within budget",
      recommendable: true,
    };
  }
  return {
    tier: "affordable",
    totalCost,
    feeCost: fee,
    budget: safeBudget,
    overBy: 0,
    reason: "Within budget",
    recommendable: true,
  };
}

/** Display label for a tier — short, color-coded by `tierTone()`. */
export function tierLabel(tier: AffordabilityTier): string {
  switch (tier) {
    case "comfortable": return "Comfortable";
    case "affordable":  return "Affordable";
    case "blocked":     return "Blocked";
    case "unavailable": return "Pricing unavailable";
    case "stale":       return "Stale quote";
  }
}

/** Tailwind tone bucket for a tier — used by pills/badges across surfaces. */
export function tierTone(tier: AffordabilityTier): "good" | "ok" | "bad" | "muted" {
  switch (tier) {
    case "comfortable": return "good";
    case "affordable":  return "ok";
    case "blocked":     return "bad";
    case "unavailable":
    case "stale":       return "muted";
  }
}

/**
 * Convenience: split a list of prospective trades into the recommendation
 * group (Comfortable/Affordable, sorted as caller decides) and the Blocked
 * group (sorted cheapest first so users see the closest-to-budget option),
 * with a final "out" bucket of unavailable / stale items.
 *
 * Callers MUST sort/score AFTER this split — never let a Blocked trade
 * outrank an Affordable one (spec §8).
 */
export function partitionByAffordability<T>(
  items: T[],
  budget: number,
  pickInput: (t: T) => AffordabilityInput,
): {
  recommendable: Array<{ item: T; aff: AffordabilityResult }>;
  blocked:       Array<{ item: T; aff: AffordabilityResult }>;
  unavailable:   Array<{ item: T; aff: AffordabilityResult }>;
} {
  const recommendable: Array<{ item: T; aff: AffordabilityResult }> = [];
  const blocked:       Array<{ item: T; aff: AffordabilityResult }> = [];
  const unavailable:   Array<{ item: T; aff: AffordabilityResult }> = [];
  for (const item of items) {
    const aff = classifyAffordability(budget, pickInput(item));
    if (aff.recommendable) recommendable.push({ item, aff });
    else if (aff.tier === "blocked") blocked.push({ item, aff });
    else unavailable.push({ item, aff });
  }
  // Cheapest blocked first — most likely candidate to swap into.
  blocked.sort((a, b) => (a.aff.totalCost ?? Infinity) - (b.aff.totalCost ?? Infinity));
  return { recommendable, blocked, unavailable };
}
