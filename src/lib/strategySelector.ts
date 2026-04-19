// ─────────────────────────────────────────────────────────────────────────────
// Institutional-grade strategy selector.
//
// Implements Steps 2–7 + 10 of the NOVA scanner spec:
//   2. IV-AWARE strategy engine (IVR > 80 → spreads; < 40 → debit/long)
//   3. CHASE filter (>3% → require pullback; >5% → downgrade)
//   4. ATR risk filter (>4% → reduce size, prefer spreads; >6% → danger)
//   5. Strike selection by delta band (rejects deep ITM)
//   6. Expiration logic by DTE bucket
//   7. Reward / risk math (max loss, target, breakeven, expected move, R/R, P-of-profit)
//  10. Position-size warnings
//
// Pure functions — no React, no I/O. Easy to unit test and reuse from edge
// functions later (e.g. pre-flight a NOVA pick before persistence).
// ─────────────────────────────────────────────────────────────────────────────
import type { Bias } from "./setupScore";

export type StrategyAction =
  | "Long Call"
  | "Long Put"
  | "Bull Call Spread"
  | "Bear Put Spread"
  | "Put Credit Spread"
  | "Call Credit Spread"
  | "Iron Condor"
  | "Calendar"
  | "WAIT — no edge";

export type DirectionalLeaning = "bullish" | "bearish" | "neutral";
export type SizingClass = "Aggressive" | "Balanced" | "Conservative";
export type RewardRiskLabel = "Excellent" | "Good" | "Fair" | "Poor";

export interface StrategyDecision {
  /** "WAIT" if no edge — caller should suppress trade UI. */
  action: StrategyAction;
  /** Friendly one-liner for UI ("Bull call spread — IVR rich, prefer defined risk"). */
  rationale: string;
  /** Why we picked this expiry bucket. */
  expiryReason: string;
  /** Effective directional leaning after chase / IV adjustments. */
  leaning: DirectionalLeaning;
  /** Strike(s). For spreads, both legs. */
  longStrike: number | null;
  shortStrike: number | null;
  /** Days-to-expiration bucket midpoint we recommend. */
  dte: number;
  /** Concrete expiry date YYYY-MM-DD. */
  expiry: string;
  /** Entry trigger description ("Pull back to 218 / EMA20", "Break + close > 232 on 1.5× vol"). */
  entry: string;
  /** Profit target ($ underlying or % of premium). */
  target: string;
  /** Stop ($ underlying). */
  stop: string;
  /** Breakeven (underlying). */
  breakeven: number | null;
  /** Expected 1-σ move over DTE in $. */
  expectedMoveDollars: number;
  /** Estimated max loss per contract in $. */
  maxLossPerContract: number;
  /** Estimated profit target in $. */
  targetProfitPerContract: number;
  /** Reward-to-risk ratio (target/max-loss). */
  rewardRisk: number;
  rewardRiskLabel: RewardRiskLabel;
  /** Probability of profit estimate (0–100). */
  probabilityOfProfit: number;
  /** Position sizing recommendation. */
  sizing: SizingClass;
  /** Soft warnings the UI should surface. */
  warnings: string[];
}

// ── Inputs the selector needs about a single setup row ──────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
const round05 = (n: number) => Math.round(n * 2) / 2;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Return next monthly Friday DTE-ish (rough — UI displays the date). */
function expiryFromDte(dte: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dte);
  // Snap to next Friday so the date is a real listed expiry.
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Step 6 — pick a DTE bucket from setup quality + bias. */
function pickDte(inp: StrategyInputs, leaning: DirectionalLeaning): { dte: number; reason: string } {
  // Earnings within a week → only catalyst trades, short DTE.
  if (inp.earningsInDays != null && inp.earningsInDays <= 7) {
    return { dte: Math.max(7, inp.earningsInDays + 2), reason: "Catalyst-driven — keep DTE short, exit on the event." };
  }
  // Neutral → calendar / condor wants ~30 DTE for theta.
  if (leaning === "neutral") return { dte: 28, reason: "Neutral / range — 28 DTE for theta capture." };
  // Strong directional with high score → swing.
  if (inp.setupScore >= 75) return { dte: 45, reason: "Best general swing window — 30–60 DTE balances theta + delta." };
  if (inp.setupScore >= 60) return { dte: 35, reason: "30–45 DTE keeps gamma manageable for a tactical swing." };
  return { dte: 21, reason: "Lower-conviction setup — keep capital tied up briefly (≤ 30 DTE)." };
}

/**
 * Step 5 — strike selection.
 * Aggressive: ATM-ish (~0.50 delta) → strike ≈ price.
 * Balanced:   slight ITM (~0.65 delta) → strike ≈ price ± ~3% (call: below, put: above).
 * Conservative: ITM (~0.75 delta) → strike ≈ price ± ~6%.
 * For credit spreads, we sell OTM (~0.30 delta) and buy further OTM as wing.
 */
function pickStrikes(inp: StrategyInputs, action: StrategyAction, sizing: SizingClass): { longStrike: number | null; shortStrike: number | null } {
  const p = inp.price;
  if (p <= 0) return { longStrike: null, shortStrike: null };
  const itmShift = sizing === "Aggressive" ? 0 : sizing === "Balanced" ? 0.03 : 0.06;

  switch (action) {
    case "Long Call":
      return { longStrike: round05(p * (1 - itmShift)), shortStrike: null };
    case "Long Put":
      return { longStrike: round05(p * (1 + itmShift)), shortStrike: null };
    case "Bull Call Spread": {
      const long = round05(p * (1 - itmShift));
      const short = round05(p * 1.05);
      return { longStrike: long, shortStrike: short };
    }
    case "Bear Put Spread": {
      const long = round05(p * (1 + itmShift));
      const short = round05(p * 0.95);
      return { longStrike: long, shortStrike: short };
    }
    case "Put Credit Spread": {
      // Sell OTM put ~5% below, buy further OTM ~8% below as wing.
      const short = round05(p * 0.95);
      const long = round05(p * 0.92);
      return { longStrike: long, shortStrike: short };
    }
    case "Call Credit Spread": {
      const short = round05(p * 1.05);
      const long = round05(p * 1.08);
      return { longStrike: long, shortStrike: short };
    }
    case "Iron Condor": {
      // Caller can read both as the "wing" reference; UI shows range.
      const short = round05(p * 1.04);
      const long = round05(p * 0.96);
      return { longStrike: long, shortStrike: short };
    }
    case "Calendar":
      return { longStrike: round05(p), shortStrike: round05(p) };
    default:
      return { longStrike: null, shortStrike: null };
  }
}

/** Estimate 1-σ expected move = price × (atr% / 100) × √(DTE/avg-trading-days-month). */
function expectedMove(price: number, atrPct: number, dte: number): number {
  const sigmaDay = (atrPct / 100) * price;
  return +(sigmaDay * Math.sqrt(Math.max(1, dte))).toFixed(2);
}

/**
 * Quick-and-honest reward/risk math. Real fills will differ; we want
 * directionally correct numbers a trader can sanity-check.
 */
function computeRewardRisk(
  inp: StrategyInputs,
  action: StrategyAction,
  longStrike: number | null,
  shortStrike: number | null,
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

  switch (action) {
    case "Long Call": {
      maxLoss = atmPremium * 100;
      target = atmPremium * 100; // 1R target
      breakeven = (longStrike ?? inp.price) + atmPremium;
      pop = inp.bias === "bullish" ? 48 : 38;
      break;
    }
    case "Long Put": {
      maxLoss = atmPremium * 100;
      target = atmPremium * 100;
      breakeven = (longStrike ?? inp.price) - atmPremium;
      pop = inp.bias === "bearish" ? 48 : 38;
      break;
    }
    case "Bull Call Spread":
    case "Bear Put Spread": {
      const width = Math.abs((shortStrike ?? 0) - (longStrike ?? 0));
      const debit = Math.max(0.1, +(width * 0.4).toFixed(2));
      maxLoss = debit * 100;
      target = (width - debit) * 100 * 0.6; // exit at 60% of max
      breakeven = action === "Bull Call Spread" ? (longStrike ?? 0) + debit : (longStrike ?? 0) - debit;
      pop = 55;
      break;
    }
    case "Put Credit Spread":
    case "Call Credit Spread": {
      const width = Math.abs((shortStrike ?? 0) - (longStrike ?? 0));
      const credit = Math.max(0.1, +(width * 0.33).toFixed(2));
      maxLoss = (width - credit) * 100;
      target = credit * 100 * 0.6; // close at 60% of max profit (per spec step 7)
      breakeven = action === "Put Credit Spread" ? (shortStrike ?? 0) - credit : (shortStrike ?? 0) + credit;
      pop = 70; // OTM credit spreads typically ~70%
      break;
    }
    case "Iron Condor": {
      const width = Math.abs((shortStrike ?? 0) - (longStrike ?? 0));
      const credit = Math.max(0.2, +(width * 0.5).toFixed(2));
      maxLoss = (width - credit) * 100;
      target = credit * 100 * 0.5;
      pop = 65;
      break;
    }
    case "Calendar": {
      maxLoss = atmPremium * 100 * 0.6;
      target = maxLoss * 0.5;
      pop = 55;
      break;
    }
    default: {
      maxLoss = 0;
      target = 0;
      pop = 0;
    }
  }

  // High IVR cuts the edge for buyers, lifts it for sellers.
  if (inp.ivRank > 75 && (action === "Long Call" || action === "Long Put")) pop -= 8;
  if (inp.ivRank > 75 && (action.includes("Credit") || action === "Iron Condor")) pop += 5;
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

/** Step 4 — ATR-aware sizing. */
function sizingFor(inp: StrategyInputs): SizingClass {
  if (inp.atrPct > 6) return "Conservative";
  if (inp.atrPct > 4) return "Conservative";
  if (inp.setupScore >= 75 && inp.atrPct < 2.5) return "Aggressive";
  return "Balanced";
}

/** Step 1 — refine the bias engine into a tradeable leaning + chase guard. */
function effectiveLeaning(inp: StrategyInputs): { leaning: DirectionalLeaning; chaseNote: string | null } {
  // Step 3 — chase filter. Anything up >3% needs pullback; >5% is over-extended.
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

/** Step 2 — IV-aware strategy. */
function pickAction(inp: StrategyInputs, leaning: DirectionalLeaning): { action: StrategyAction; rationale: string } {
  const ivr = inp.ivRank;
  if (leaning === "neutral") {
    if (ivr >= 60) return { action: "Iron Condor", rationale: `IVR ${ivr} rich — sell premium with defined risk.` };
    if (ivr <= 35) return { action: "Calendar", rationale: `IVR ${ivr} cheap — calendar exploits term-structure.` };
    return { action: "WAIT — no edge", rationale: "Mixed signals + middling IV — no clean edge here." };
  }

  const isBull = leaning === "bullish";
  if (ivr > 80) {
    // High IV → defined risk, prefer credit spread (sell premium with directional bias).
    return isBull
      ? { action: "Put Credit Spread", rationale: `IVR ${ivr} elevated — sell put credit for bullish thesis.` }
      : { action: "Call Credit Spread", rationale: `IVR ${ivr} elevated — sell call credit for bearish thesis.` };
  }
  if (ivr >= 40) {
    // Mid IV → debit spread balances cost vs leverage.
    return isBull
      ? { action: "Bull Call Spread", rationale: `IVR ${ivr} moderate — debit spread caps cost.` }
      : { action: "Bear Put Spread", rationale: `IVR ${ivr} moderate — debit spread caps cost.` };
  }
  // Cheap IV → buy premium outright.
  return isBull
    ? { action: "Long Call", rationale: `IVR ${ivr} cheap — premium pricing favors long calls.` }
    : { action: "Long Put", rationale: `IVR ${ivr} cheap — premium pricing favors long puts.` };
}

// ── Main entry point ────────────────────────────────────────────────────────
export function selectStrategy(inp: StrategyInputs): StrategyDecision {
  const warnings: string[] = [];

  // Liquidity gate first — Step 8/10 spirit. No trade with bad fills.
  if (inp.optionsLiquidity < 40) {
    warnings.push("Thin options chain — fills will hurt R/R; skip or paper-trade only.");
  }

  // Step 4 — ATR-aware sizing + warnings.
  const sizing = sizingFor(inp);
  if (inp.atrPct > 6) warnings.push(`ATR ${inp.atrPct}% — danger mode, only aggressive accounts.`);
  else if (inp.atrPct > 4) warnings.push(`ATR ${inp.atrPct}% — reduce size 50%, prefer spreads.`);

  // Step 1 + Step 3 — leaning + chase guard.
  const { leaning, chaseNote } = effectiveLeaning(inp);
  if (chaseNote) warnings.push(chaseNote);

  // Step 2 — strategy.
  const { action, rationale } = pickAction(inp, leaning);

  // Setup-score floor — if the brain says no, we say WAIT.
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

  // Step 5 — strikes.
  const { longStrike, shortStrike } = pickStrikes(inp, action, sizing);

  // Step 6 — DTE.
  const { dte, reason: expiryReason } = pickDte(inp, leaning);
  const expiry = expiryFromDte(dte);

  // Step 7 — reward / risk.
  const rr = computeRewardRisk(inp, action, longStrike, shortStrike, dte);

  // Entry / target / stop strings (underlying-driven so trader can place stops).
  const stopUnderlying = leaning === "bullish"
    ? round1(inp.price * (1 - inp.atrPct / 100 * 1.5))
    : round1(inp.price * (1 + inp.atrPct / 100 * 1.5));
  const targetUnderlying = leaning === "bullish"
    ? round1(inp.price + rr.expectedMoveDollars * 0.8)
    : round1(inp.price - rr.expectedMoveDollars * 0.8);

  const entry = chaseNote
    ? `Wait for pullback to ~$${round1(inp.price * (leaning === "bullish" ? 0.97 : 1.03))} or volume-confirmed continuation.`
    : action.includes("Credit") || action === "Iron Condor"
      ? `Open at current price ($${round1(inp.price)}) on a quiet tape; close at 50–60% of max profit.`
      : `Enter on a hold of $${round1(inp.price)} with rel-vol ≥ 1.3×.`;

  const target = action.includes("Credit") || action === "Iron Condor"
    ? `Close at $${rr.targetProfitPerContract} profit (≈60% of max).`
    : `Underlying $${targetUnderlying} (1σ move) → ~$${rr.targetProfitPerContract} per contract.`;

  const stop = action.includes("Credit") || action === "Iron Condor"
    ? `Close if loss exceeds 2× credit (~$${rr.maxLossPerContract}).`
    : `Underlying $${stopUnderlying} or 50% of premium (~$${Math.round(rr.maxLossPerContract * 0.5)}).`;

  // Step 10 — flag oversized premiums (caller knows account size; we just hint).
  if (rr.maxLossPerContract > 500) {
    warnings.push(`Max loss per contract $${rr.maxLossPerContract} — keep size ≤ 1–2% of account.`);
  }
  if (rr.rewardRiskLabel === "Poor") {
    warnings.push("Reward/risk is poor — consider waiting or restructuring.");
  }

  return {
    action,
    rationale,
    expiryReason,
    leaning,
    longStrike,
    shortStrike,
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
