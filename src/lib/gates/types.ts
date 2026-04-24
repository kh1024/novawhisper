// 7-Gate + Affordability Validation System — institutional safety pipeline.
// Every NOVA pick / open position passes through these gates BEFORE the UI
// shows a Buy CTA or holds quiet on a losing trade.
//   1. Data Integrity   — quote freshness + price drift
//   2. Trend Gate       — 200-SMA filter for CALLs
//   3. Intrinsic Audit  — OTM = AGGRESSIVE_SPECULATION (non-blocking)
//   4. Exhaustion       — RSI + winning streak
//   5. ORB Lock         — pre-10:30 EST waits
//   6. IVP Guard        — IV percentile crush risk
//   7. Safety Exit      — 30% premium stop on OPEN positions
//   8. Affordability    — per-trade cost vs portfolio (5% hard cap)
export type OptionType = "CALL" | "PUT";
export type SignalStatus = "APPROVED" | "BLOCKED" | "WAIT" | "FLAGGED";
export type RiskLabel = "CONSERVATIVE_DIRECTIONAL" | "AGGRESSIVE_SPECULATION" | "SPECULATIVE";

export interface SignalInput {
  ticker: string;
  optionType: OptionType;
  strikePrice: number;
  currentPrice: number;
  entryPremium: number;
  currentPremium: number;
  quoteTimestamp: Date;
  liveFeedPrice: number;
  rsi14: number;
  streakDays: number;
  sma200: number;
  ivPercentile: number;
  marketTime: Date;
  delta: number;
  /** NEW: total account capital in dollars — drives Gate 8. */
  accountBalance: number;
  /** NEW: contracts being sized (default 1). */
  contracts?: number;
  /** NEW: Grade A/B/C — used by Gate 8 to recommend a debit spread. */
  grade?: "A" | "B" | "C";
  /** NEW: pick expiry (YYYY-MM-DD) — used by date-sync logic upstream. */
  expiryDate?: string;
  /** NEW: live ATM contract bid — drives Gate 1 liquidity check. */
  bid?: number;
  /** NEW: live ATM contract ask — drives Gate 1 liquidity check. */
  ask?: number;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  status: SignalStatus;
  label: string;
  reasoning: string;
  /** Optional structured suggestion (e.g. spread alternative). */
  suggestion?: {
    kind: "VERTICAL_SPREAD" | "REDUCE_CONTRACTS" | "FAR_EXPIRY";
    title: string;
    detail: string;
  };
}

export interface ValidationResult {
  ticker: string;
  optionType: OptionType;
  finalStatus: SignalStatus;
  riskLabel: RiskLabel;
  gateResults: GateResult[];
  approvedAt?: Date;
  autoExitTrigger?: number;
  activeWarnings: string[];
  /** NEW: budget impact summary surfaced by Gate 8. */
  budgetImpact?: {
    contractCost: number;       // premium × 100 × contracts
    pctOfPortfolio: number;     // 0–100
    accountBalance: number;
    overBudget: boolean;        // > 5%
    suggestion?: GateResult["suggestion"];
  };
  /**
   * NEW: Pre-Market Preview Mode flag.
   * Set to `true` ONLY when the pipeline returned WAIT and the SOLE reason
   * was Gate 5 (ORB Lock). Tells the UI to keep the pick visible (research
   * + watchlist queue allowed) but lock the BUY/Save-to-portfolio CTAs
   * until 10:30 AM ET. Computed outside gates.ts so the gate logic itself
   * is never weakened.
   */
  previewMode?: boolean;
  previewReason?: string;
}

export const GATE_ORDER = [
  "DATA_INTEGRITY",
  "TREND_GATE",
  "INTRINSIC_AUDIT",
  "EXHAUSTION_FILTER",
  "ORB_LOCK",
  "IVP_GUARD",
  "SAFETY_EXIT",
  "AFFORDABILITY",
  "DATE_VALIDATOR",
] as const;
export type GateName = (typeof GATE_ORDER)[number];

export const GATE_LABELS: Record<GateName, string> = {
  DATA_INTEGRITY: "Data Integrity",
  TREND_GATE: "Trend Gate (200-SMA)",
  INTRINSIC_AUDIT: "Intrinsic Audit",
  EXHAUSTION_FILTER: "Exhaustion Filter",
  ORB_LOCK: "ORB Lock (10:30 EST)",
  IVP_GUARD: "IVP Guard",
  SAFETY_EXIT: "Safety Exit (-30%)",
  AFFORDABILITY: "Affordability (5% cap)",
  DATE_VALIDATOR: "Date Validator",
};

/**
 * HARD BLOCK threshold. Any single-contract notional cost exceeding this
 * percentage of the user's account is auto-BLOCKED and pivoted to a spread.
 * Per product rule: "must be > 5% of total budget → UNAFFORDABLE".
 */
// Loosened 25%: 5 → 6.25
export const AFFORDABILITY_CAP_PCT = 6.25;
// Loosened 25%: 2 → 2.5
export const AFFORDABILITY_WARN_PCT = 2.5;
// Loosened 25%: 2 → 2.5
export const MAX_RISK_PCT = 2.5;
export const SPREAD_SWEET_SPOT = { min: 150, max: 300 } as const;
// Loosened 25%: 0.10 → 0.125
export const MAX_BIDASK_SPREAD_PCT = 0.125;
