// ─────────────────────────────────────────────────────────────────────────────
// Single-leg strategy selector — calls and puts only.
//
// The app was downgraded to single-leg trading; spreads / condors / calendars
// are no longer suggested anywhere. This selector now only emits:
//   • "Long Call"   — bullish, single ATM/ITM call
//   • "Long Put"    — bearish, single ATM/ITM put
//   • "WAIT — no edge" — when conditions don't justify a directional bet
//
// We still apply the institutional rubric (chase filter, ATR sizing, IVR
// cost-of-premium check, setup-score floor) — we just funnel the answer into
// one of the two long-premium paths.
// ─────────────────────────────────────────────────────────────────────────────
import type { Bias } from "./setupScore";

export type StrategyAction = "Long Call" | "Long Put" | "WAIT — no edge";

export type DirectionalLeaning = "bullish" | "bearish" | "neutral";
export type SizingClass = "Aggressive" | "Balanced" | "Conservative";
export type RewardRiskLabel = "Excellent" | "Good" | "Fair" | "Poor";

export interface StrategyDecision {
  /** "WAIT" if no edge — caller should suppress trade UI. */
  action: StrategyAction;
  rationale: string;
  expiryReason: string;
  leaning: DirectionalLeaning;
  /** Strike of the single long leg. */
  longStrike: number | null;
  /** Always null — preserved on the type for back-compat with playbook UI. */
  shortStrike: number | null;
  dte: number;
  expiry: string;
  entry: string;
  target: string;
  stop: string;
  breakeven: number | null;
  expectedMoveDollars: number;
  maxLossPerContract: number;
  targetProfitPerContract: number;
  rewardRisk: number;
  rewardRiskLabel: RewardRiskLabel;
  probabilityOfProfit: number;
  sizing: SizingClass;
  warnings: string[];
}

export interface StrategyInputs {
  symbol: string;
  bias: Bias;
  price: number;
  changePct: number;
  ivRank: number;
  atrPct: number;
  rsi: number;
  optionsLiquidity: number;
  earningsInDays: number | null;
  setupScore: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const round05 = (n: number) => Math.round(n * 2) / 2;
const round1 = (n: number) => Math.round(n * 10) / 10;

function expiryFromDte(dte: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dte);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function pickDte(inp: StrategyInputs): { dte: number; reason: string } {
  if (inp.earningsInDays != null && inp.earningsInDays <= 7) {
    return { dte: Math.max(7, inp.earningsInDays + 2), reason: "Catalyst-driven — keep DTE short, exit on the event." };
  }
  if (inp.setupScore >= 75) return { dte: 45, reason: "Best general swing window — 30–60 DTE balances theta + delta." };
  if (inp.setupScore >= 60) return { dte: 35, reason: "30–45 DTE keeps gamma manageable for a tactical swing." };
  return { dte: 21, reason: "Lower-conviction setup — keep capital tied up briefly (≤ 30 DTE)." };
}

/**
 * Strike selection for single-leg longs.
 *  • Aggressive: ATM (~0.50 delta) → strike ≈ price.
 *  • Balanced:   slight ITM (~0.65 delta) → call ≈ −3%, put ≈ +3%.
 *  • Conservative: ITM (~0.75 delta) → call ≈ −6%, put ≈ +6%.
 */
function pickStrike(inp: StrategyInputs, action: StrategyAction, sizing: SizingClass): number | null {
  const p = inp.price;
  if (p <= 0) return null;
  const itmShift = sizing === "Aggressive" ? 0 : sizing === "Balanced" ? 0.03 : 0.06;
  if (action === "Long Call") return round05(p * (1 - itmShift));
  if (action === "Long Put") return round05(p * (1 + itmShift));
  return null;
}

function expectedMove(price: number, atrPct: number, dte: number): number {
  const sigmaDay = (atrPct / 100) * price;
  return +(sigmaDay * Math.sqrt(Math.max(1, dte))).toFixed(2);
}

function computeRewardRisk(
  inp: StrategyInputs,
  action: StrategyAction,
  longStrike: number | null,
  dte: number,
): {
  maxLossPerContract: number;
  targetProfitPerContract: number;
  rewardRisk: number;
  rewardRiskLabel: RewardRiskLabel;
  breakeven: number | null;
  probabilityOfProfit: number;
  expectedMoveDollars: number;
} {
  const em = expectedMove(inp.price, inp.atrPct, dte);
  // Naive premium model: ATM premium ≈ 0.4 × σ for a long single-leg.
  const atmPremium = Math.max(0.05, +(0.4 * em).toFixed(2));

  let maxLoss = 0;
  let target = 0;
  let breakeven: number | null = null;
  let pop = 50;

  if (action === "Long Call") {
    maxLoss = atmPremium * 100;
    target = atmPremium * 100; // 1R target
    breakeven = (longStrike ?? inp.price) + atmPremium;
    pop = inp.bias === "bullish" ? 48 : 38;
  } else if (action === "Long Put") {
    maxLoss = atmPremium * 100;
    target = atmPremium * 100;
    breakeven = (longStrike ?? inp.price) - atmPremium;
    pop = inp.bias === "bearish" ? 48 : 38;
  }

  // High IVR cuts the edge for buyers.
  if (inp.ivRank > 75) pop -= 8;
  pop = Math.max(5, Math.min(92, Math.round(pop)));

  const rr = maxLoss > 0 ? +(target / maxLoss).toFixed(2) : 0;
  let label: RewardRiskLabel = "Poor";
  if (rr >= 1.5) label = "Excellent";
  else if (rr >= 1) label = "Good";
  else if (rr >= 0.5) label = "Fair";

  return {
    maxLossPerContract: Math.round(maxLoss),
    targetProfitPerContract: Math.round(target),
    rewardRisk: rr,
    rewardRiskLabel: label,
    breakeven: breakeven != null ? +breakeven.toFixed(2) : null,
    probabilityOfProfit: pop,
    expectedMoveDollars: em,
  };
}

function sizingFor(inp: StrategyInputs): SizingClass {
  if (inp.atrPct > 4) return "Conservative";
  if (inp.setupScore >= 75 && inp.atrPct < 2.5) return "Aggressive";
  return "Balanced";
}

function effectiveLeaning(inp: StrategyInputs): { leaning: DirectionalLeaning; chaseNote: string | null } {
  if (inp.bias === "bullish" && inp.changePct > 5) {
    return { leaning: "neutral", chaseNote: `Up ${inp.changePct.toFixed(1)}% — over-extended, wait for pullback.` };
  }
  if (inp.bias === "bullish" && inp.changePct > 3) {
    return { leaning: "bullish", chaseNote: `Up ${inp.changePct.toFixed(1)}% — only enter on pullback or confirmed continuation.` };
  }
  if (inp.bias === "bearish" && inp.changePct < -5) {
    return { leaning: "neutral", chaseNote: `Down ${inp.changePct.toFixed(1)}% — short over-extended, wait for bounce-and-fail.` };
  }
  if (inp.bias === "neutral" || inp.bias === "reversal") {
    return { leaning: "neutral", chaseNote: null };
  }
  return { leaning: inp.bias as DirectionalLeaning, chaseNote: null };
}

/** Single-leg only: bullish → Long Call, bearish → Long Put, else WAIT. */
function pickAction(inp: StrategyInputs, leaning: DirectionalLeaning): { action: StrategyAction; rationale: string } {
  if (leaning === "neutral") {
    return { action: "WAIT — no edge", rationale: "No directional read — single-leg-only setup means we sit out neutral tape." };
  }
  const ivr = inp.ivRank;
  const ivNote = ivr > 75
    ? `IVR ${ivr} elevated — premium is rich, size down or wait for IV to cool.`
    : ivr < 30
      ? `IVR ${ivr} cheap — premium pricing favors long premium.`
      : `IVR ${ivr} moderate — premium fair.`;
  if (leaning === "bullish") return { action: "Long Call", rationale: ivNote };
  return { action: "Long Put", rationale: ivNote };
}

// ── Main entry point ───────────────────────────────────────────────────────
export function selectStrategy(inp: StrategyInputs): StrategyDecision {
  const warnings: string[] = [];

  if (inp.optionsLiquidity < 40) {
    warnings.push("Thin options chain — fills will hurt R/R; skip or paper-trade only.");
  }

  const sizing = sizingFor(inp);
  if (inp.atrPct > 6) warnings.push(`ATR ${inp.atrPct}% — danger mode, only aggressive accounts.`);
  else if (inp.atrPct > 4) warnings.push(`ATR ${inp.atrPct}% — reduce size 50%, keep premium small.`);

  const { leaning, chaseNote } = effectiveLeaning(inp);
  if (chaseNote) warnings.push(chaseNote);

  if (inp.ivRank > 75) {
    warnings.push(`IVR ${inp.ivRank} — premium is rich, expect IV crush hurting long-premium P&L.`);
  }

  const { action, rationale } = pickAction(inp, leaning);

  if (inp.setupScore < 45 || action === "WAIT — no edge") {
    return {
      action: "WAIT — no edge",
      rationale: action === "WAIT — no edge" ? rationale : "Setup score below threshold — no actionable trade.",
      expiryReason: "—",
      leaning,
      longStrike: null,
      shortStrike: null,
      dte: 0,
      expiry: "—",
      entry: "Wait for a cleaner setup or higher relative volume.",
      target: "—",
      stop: "—",
      breakeven: null,
      expectedMoveDollars: 0,
      maxLossPerContract: 0,
      targetProfitPerContract: 0,
      rewardRisk: 0,
      rewardRiskLabel: "Poor",
      probabilityOfProfit: 0,
      sizing,
      warnings,
    };
  }

  const longStrike = pickStrike(inp, action, sizing);
  const { dte, reason: expiryReason } = pickDte(inp);
  const expiry = expiryFromDte(dte);
  const rr = computeRewardRisk(inp, action, longStrike, dte);

  const stopUnderlying = leaning === "bullish"
    ? round1(inp.price * (1 - inp.atrPct / 100 * 1.5))
    : round1(inp.price * (1 + inp.atrPct / 100 * 1.5));
  const targetUnderlying = leaning === "bullish"
    ? round1(inp.price + rr.expectedMoveDollars * 0.8)
    : round1(inp.price - rr.expectedMoveDollars * 0.8);

  const entry = chaseNote
    ? `Wait for pullback to ~$${round1(inp.price * (leaning === "bullish" ? 0.97 : 1.03))} or volume-confirmed continuation.`
    : `Enter on a hold of $${round1(inp.price)} with rel-vol ≥ 1.3×.`;

  const target = `Underlying $${targetUnderlying} (1σ move) → ~$${rr.targetProfitPerContract} per contract.`;
  const stop = `Underlying $${stopUnderlying} or 50% of premium (~$${Math.round(rr.maxLossPerContract * 0.5)}).`;

  if (rr.maxLossPerContract > 500) {
    warnings.push(`Max loss per contract $${rr.maxLossPerContract} — keep size ≤ 1–2% of account.`);
  }
  if (rr.rewardRiskLabel === "Poor") {
    warnings.push("Reward/risk is poor — consider waiting for a better setup.");
  }

  return {
    action,
    rationale,
    expiryReason,
    leaning,
    longStrike,
    shortStrike: null,
    dte,
    expiry,
    entry,
    target,
    stop,
    breakeven: rr.breakeven,
    expectedMoveDollars: rr.expectedMoveDollars,
    maxLossPerContract: rr.maxLossPerContract,
    targetProfitPerContract: rr.targetProfitPerContract,
    rewardRisk: rr.rewardRisk,
    rewardRiskLabel: rr.rewardRiskLabel,
    probabilityOfProfit: rr.probabilityOfProfit,
    sizing,
    warnings,
  };
}
