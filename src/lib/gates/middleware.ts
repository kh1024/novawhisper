// Short-circuit pipeline. Stops at the first BLOCKED or WAIT so the user sees
// one unambiguous reason rather than a wall of conflicting gate noise.
import type { SignalInput, ValidationResult, GateResult, RiskLabel } from "./types";
import {
  gate1_DataIntegrity, gate2_TrendGate, gate3_IntrinsicAudit,
  gate4_ExhaustionFilter, gate5_OrbLock, gate6_IvpGuard, gate7_SafetyExit,
} from "./gates";

export function validateSignal(input: SignalInput): ValidationResult {
  const gateResults: GateResult[] = [];
  const warnings: string[] = [];

  // Order: integrity → trend → intrinsic → exhaustion → ORB → IVP → safety.
  const pipeline = [
    gate1_DataIntegrity,
    gate2_TrendGate,
    gate3_IntrinsicAudit,    // FLAGGED but non-blocking — never short-circuits
    gate4_ExhaustionFilter,
    gate5_OrbLock,
    gate6_IvpGuard,
    gate7_SafetyExit,
  ];

  let firstBlock: GateResult | null = null;
  for (const fn of pipeline) {
    const r = fn(input);
    gateResults.push(r);
    if (r.status === "FLAGGED") {
      warnings.push(r.label);
      continue;
    }
    if ((r.status === "BLOCKED" || r.status === "WAIT") && !firstBlock) {
      firstBlock = r;
      // Short-circuit AFTER recording the result. Remaining gates marked SKIPPED.
      const remaining = pipeline.slice(pipeline.indexOf(fn) + 1);
      for (const skipFn of remaining) {
        gateResults.push({
          gate: skipFn === gate2_TrendGate ? "TREND_GATE"
            : skipFn === gate3_IntrinsicAudit ? "INTRINSIC_AUDIT"
            : skipFn === gate4_ExhaustionFilter ? "EXHAUSTION_FILTER"
            : skipFn === gate5_OrbLock ? "ORB_LOCK"
            : skipFn === gate6_IvpGuard ? "IVP_GUARD"
            : "SAFETY_EXIT",
          passed: false, status: "WAIT",
          label: "⚪ SKIPPED",
          reasoning: `Not evaluated — pipeline stopped at ${firstBlock.gate}.`,
        });
      }
      break;
    }
  }

  const intrinsicFlagged = gateResults.some((g) => g.gate === "INTRINSIC_AUDIT" && g.status === "FLAGGED");
  const riskLabel: RiskLabel = intrinsicFlagged
    ? "AGGRESSIVE_SPECULATION"
    : input.delta >= 0.80
      ? "CONSERVATIVE_DIRECTIONAL"
      : "SPECULATIVE";

  const finalStatus = firstBlock
    ? firstBlock.status
    : intrinsicFlagged ? "FLAGGED" : "APPROVED";

  const autoExitTrigger = Number.isFinite(input.entryPremium) && input.entryPremium > 0
    ? Number((input.entryPremium * 0.70).toFixed(2))
    : undefined;

  return {
    ticker: input.ticker,
    optionType: input.optionType,
    finalStatus,
    riskLabel,
    gateResults,
    approvedAt: finalStatus === "APPROVED" || finalStatus === "FLAGGED" ? new Date() : undefined,
    autoExitTrigger,
    activeWarnings: warnings,
  };
}
