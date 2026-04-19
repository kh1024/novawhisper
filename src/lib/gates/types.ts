// 7-Gate Validation System — institutional safety pipeline.
// Every NOVA pick / open position passes through these gates BEFORE the UI
// shows a Buy CTA or holds quiet on a losing trade.
//   1. Data Integrity   — quote freshness + price drift
//   2. Trend Gate       — 200-SMA filter for CALLs
//   3. Intrinsic Audit  — OTM = AGGRESSIVE_SPECULATION (non-blocking)
//   4. Exhaustion       — RSI + winning streak
//   5. ORB Lock         — pre-10:30 EST waits
//   6. IVP Guard        — IV percentile crush risk
//   7. Safety Exit      — 30% premium stop on OPEN positions
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
}

export interface GateResult {
  gate: string;
  passed: boolean;
  status: SignalStatus;
  label: string;
  reasoning: string;
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
}

export const GATE_ORDER = [
  "DATA_INTEGRITY",
  "TREND_GATE",
  "INTRINSIC_AUDIT",
  "EXHAUSTION_FILTER",
  "ORB_LOCK",
  "IVP_GUARD",
  "SAFETY_EXIT",
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
};
