// Short-circuit pipeline. Stops at the first BLOCKED or WAIT so the user sees
// one unambiguous reason rather than a wall of conflicting gate noise.
import type { SignalInput, ValidationResult, GateResult, RiskLabel } from "./types";
import { AFFORDABILITY_CAP_PCT } from "./types";
import {
  gate1_DataIntegrity, gate2_TrendGate, gate3_IntrinsicAudit,
  gate4_ExhaustionFilter, gate5_OrbLock, gate6_IvpGuard, gate7_SafetyExit,
  gate8_Affordability, gate9_DateValidator,
} from "./gates";

export function validateSignal(input: SignalInput): ValidationResult {
  const gateResults: GateResult[] = [];
  const warnings: string[] = [];

  const pipeline = [
    gate1_DataIntegrity,
    gate2_TrendGate,
    gate3_IntrinsicAudit,    // FLAGGED but non-blocking
    gate4_ExhaustionFilter,
    gate5_OrbLock,
    gate6_IvpGuard,
    gate7_SafetyExit,
    gate8_Affordability,
    gate9_DateValidator,     // NEW — confirms expiry is real, future, liquid
  ];

  const gateNameByFn = new Map<typeof pipeline[number], string>([
    [gate1_DataIntegrity,    "DATA_INTEGRITY"],
    [gate2_TrendGate,        "TREND_GATE"],
    [gate3_IntrinsicAudit,   "INTRINSIC_AUDIT"],
    [gate4_ExhaustionFilter, "EXHAUSTION_FILTER"],
    [gate5_OrbLock,          "ORB_LOCK"],
    [gate6_IvpGuard,         "IVP_GUARD"],
    [gate7_SafetyExit,       "SAFETY_EXIT"],
    [gate8_Affordability,    "AFFORDABILITY"],
    [gate9_DateValidator,    "DATE_VALIDATOR"],
  ]);

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
      const remaining = pipeline.slice(pipeline.indexOf(fn) + 1);
      for (const skipFn of remaining) {
        gateResults.push({
          gate: gateNameByFn.get(skipFn) ?? "UNKNOWN",
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

  // ── Budget impact summary (always computed when we have the data) ──
  const contracts = Math.max(1, Math.floor(input.contracts ?? 1));
  const contractCost = Number.isFinite(input.entryPremium) && input.entryPremium > 0
    ? input.entryPremium * 100 * contracts
    : 0;
  const account = Number.isFinite(input.accountBalance) ? input.accountBalance : 0;
  const pctOfPortfolio = account > 0 ? (contractCost / account) * 100 : 0;
  const affordabilityResult = gateResults.find((g) => g.gate === "AFFORDABILITY");
  const budgetImpact = contractCost > 0 && account > 0 ? {
    contractCost,
    pctOfPortfolio,
    accountBalance: account,
    overBudget: pctOfPortfolio > AFFORDABILITY_CAP_PCT,
    suggestion: affordabilityResult?.suggestion,
  } : undefined;

  return {
    ticker: input.ticker,
    optionType: input.optionType,
    finalStatus,
    riskLabel,
    gateResults,
    approvedAt: finalStatus === "APPROVED" || finalStatus === "FLAGGED" ? new Date() : undefined,
    autoExitTrigger,
    activeWarnings: warnings,
    budgetImpact,
  };
}
