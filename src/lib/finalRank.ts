// ─────────────────────────────────────────────────────────────────────────────
// Institutional ranking layer.
//
// Implements Parts 3, 4, 5, 6, 7 of the NOVA scanner spec on top of the
// existing setupScore module:
//
//   • Readiness Score (0–100) — re-derived from existing breakdown so it lines
//     up with the spec's weights (trigger / regime / sector / time-of-day /
//     IV / news).
//   • Options Score (0–100) — strike efficiency, IV edge, liquidity,
//     expiration fit, reward/risk, greeks alignment, capital efficiency.
//   • Penalty Engine — concrete deductions with human-readable reasons.
//   • Final Rank = setup × .40 + readiness × .30 + options × .30 − penalties.
//   • Action Label — ELITE / GO NOW / GOOD / WATCHLIST / PASS.
//
// Pure functions, no I/O — easy to unit test and reuse from edge functions.
// ─────────────────────────────────────────────────────────────────────────────
import type { SetupRow } from "./setupScore";
import type { StrategyDecision } from "./strategySelector";
import { getLabelMultiplier } from "./learningWeights";

// Plain-English action language used across the whole app (institutional spec):
//   BUY NOW    — score ≥ 80, setup triggered now, take the trade
//   WATCHLIST  — score 70–79, setup close, wait for confirmed trigger
//   WAIT       — score 50–69, mixed signals, monitor
//   AVOID      — score < 50 OR poor liquidity / IV trap / earnings risk
//   EXIT       — only emitted for held portfolio positions whose thesis broke;
//                Scanner never returns EXIT.
export type ActionLabel = "BUY NOW" | "WATCHLIST" | "WAIT" | "AVOID" | "EXIT";

/** Map any 0–100 confidence/rank score to the canonical action label.
 *  Never returns EXIT — that label is reserved for portfolio-held positions. */
export function actionFromScore(score: number): ActionLabel {
  if (score >= 80) return "BUY NOW";
  if (score >= 70) return "WATCHLIST";
  if (score >= 50) return "WAIT";
  return "AVOID";
}

export interface Penalty {
  /** Short tag used as a chip / log key. */
  code: string;
  /** Negative integer applied to Final Rank. */
  points: number;
  /** Human-readable reason shown in tooltips. */
  reason: string;
}

export interface RankResult {
  setupScore: number;
  readinessScore: number;
  optionsScore: number;
  finalRank: number;
  label: ActionLabel;
  penalties: Penalty[];
  /** Sub-component breakdown for the Options Score (0–100 contributions). */
  optionsBreakdown: {
    strikeEfficiency: number;
    ivEdge: number;
    liquidity: number;
    expirationFit: number;
    rewardRisk: number;
    greeksAlignment: number;
    capitalEfficiency: number;
  };
  readinessBreakdown: {
    trigger: number;
    regime: number;
    sector: number;
    timeOfDay: number;
    ivOpportunity: number;
    newsTiming: number;
  };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// ── Readiness Score (Part 3) ────────────────────────────────────────────────
// We re-weight signals we already have on SetupRow into the spec's buckets.
function computeReadinessScore(row: SetupRow): RankResult["readinessBreakdown"] & { total: number } {
  // Trigger (0–30): high relative volume + a real intraday move = confirmed trigger.
  const move = Math.abs(row.changePct);
  let trigger = 5;
  if (row.relVolume >= 2 && move > 0.8) trigger = 30;          // breakout confirmed
  else if (row.relVolume >= 1.5 && move > 0.4) trigger = 25;    // bounce / continuation
  else if (row.relVolume >= 1.1) trigger = 15;                  // almost ready

  // Market regime alignment (0–20).
  const bullStock = row.bias === "bullish";
  const bearStock = row.bias === "bearish";
  const bullMkt = row.regime === "bull" || row.regime === "meltup";
  const bearMkt = row.regime === "bear" || row.regime === "panic";
  let regime = 10;
  if ((bullStock && bullMkt) || (bearStock && bearMkt)) regime = 20;
  else if ((bullStock && bearMkt) || (bearStock && bullMkt)) regime = 3;
  else if (bullStock || bearStock) regime = 12;

  // Sector strength (0–15) — proxy from technical score (sector strength isn't
  // tracked per-row, so we use trend agreement quality as a stand-in).
  const sector = Math.round((row.breakdown.technical / 100) * 15);

  // Time of day (0–15) — derive from the existing label.
  const tlabel = row.timeStateLabel.toLowerCase();
  let timeOfDay = 5;
  if (tlabel.includes("open")) timeOfDay = 15;
  else if (tlabel.includes("power")) timeOfDay = 12;
  else if (tlabel.includes("midday") || tlabel.includes("lunch")) timeOfDay = 5;
  else if (tlabel.includes("closed") || tlabel.includes("weekend")) timeOfDay = 2;
  else if (tlabel.includes("pre") || tlabel.includes("post")) timeOfDay = 8;

  // IV opportunity (0–10).
  const ivr = row.ivRank;
  let ivOpportunity = 4;
  if (ivr >= 40 && ivr <= 75) ivOpportunity = 10;
  else if (ivr < 30) ivOpportunity = 8;
  else if (ivr > 85) ivOpportunity = 3;

  // News timing (0–10) — earnings inside the window = catalyst, but very close
  // is risky (penalty engine handles that separately).
  let newsTiming = 4;
  if (row.earningsInDays != null) {
    if (row.earningsInDays <= 7 && row.earningsInDays > 2) newsTiming = 10;
    else if (row.earningsInDays <= 2) newsTiming = 6; // catalyst but binary
    else if (row.earningsInDays <= 14) newsTiming = 7;
  } else if (row.relVolume > 2) newsTiming = 8; // unusual volume often = news

  const total = clamp(trigger + regime + sector + timeOfDay + ivOpportunity + newsTiming);
  return { trigger, regime, sector, timeOfDay, ivOpportunity, newsTiming, total };
}

// ── Options Score (Part 4) ──────────────────────────────────────────────────
function computeOptionsScore(row: SetupRow, decision: StrategyDecision): RankResult["optionsBreakdown"] & { total: number } {
  const isWait = decision.action === "WAIT — no edge";

  // Strike efficiency (0–25) — uses sizing class as a proxy for delta band.
  let strikeEfficiency = 0;
  if (!isWait) {
    if (decision.sizing === "Balanced") strikeEfficiency = 22;
    else if (decision.sizing === "Aggressive") strikeEfficiency = 18;
    else strikeEfficiency = 16; // Conservative — fine but expensive
  }

  // IV edge (0–20) — single-leg only, so we just reward Long Premium taken in
  // a friendly IVR band and penalize buying calls/puts when IV is rich.
  const ivr = row.ivRank;
  const isLongPremium = decision.action === "Long Call" || decision.action === "Long Put";
  let ivEdge = 8;
  if (isWait) ivEdge = 0;
  else if (ivr < 40 && isLongPremium) ivEdge = 18;
  else if (ivr > 80 && isLongPremium) ivEdge = 4;  // wrong tool, IV will crush

  // Liquidity (0–15) — straight from the proxy.
  const liquidity = Math.round((row.optionsLiquidity / 100) * 15);

  // Expiration fit (0–15) — 30–60 DTE is the spec's sweet spot.
  let expirationFit = 6;
  if (isWait) expirationFit = 0;
  else if (decision.dte >= 30 && decision.dte <= 60) expirationFit = 15;
  else if (decision.dte >= 14 && decision.dte < 30) expirationFit = 11;
  else if (decision.dte > 60 && decision.dte <= 120) expirationFit = 12;
  else if (decision.dte > 0 && decision.dte < 14) expirationFit = 5;
  else if (decision.dte > 120) expirationFit = 8;

  // Reward/risk (0–10).
  let rewardRisk = 0;
  if (decision.rewardRiskLabel === "Excellent") rewardRisk = 10;
  else if (decision.rewardRiskLabel === "Good") rewardRisk = 8;
  else if (decision.rewardRiskLabel === "Fair") rewardRisk = 5;

  // Greeks alignment (0–10) — proxy from PoP × directional fit.
  const greeksAlignment = Math.round((decision.probabilityOfProfit / 100) * 10);

  // Capital efficiency (0–5) — penalize fat single-contract premiums.
  let capitalEfficiency = 5;
  if (decision.maxLossPerContract > 1500) capitalEfficiency = 1;
  else if (decision.maxLossPerContract > 800) capitalEfficiency = 3;
  else if (decision.maxLossPerContract > 400) capitalEfficiency = 4;

  const total = clamp(
    strikeEfficiency + ivEdge + liquidity + expirationFit + rewardRisk + greeksAlignment + capitalEfficiency,
  );
  return { strikeEfficiency, ivEdge, liquidity, expirationFit, rewardRisk, greeksAlignment, capitalEfficiency, total };
}

// ── Penalty Engine (Part 5) ─────────────────────────────────────────────────
function computePenalties(row: SetupRow, decision: StrategyDecision): Penalty[] {
  const out: Penalty[] = [];
  const isLongPremium = decision.action === "Long Call" || decision.action === "Long Put";

  if (row.ivRank > 90 && isLongPremium) {
    out.push({ code: "IV_TRAP", points: -15, reason: `IVR ${row.ivRank} + long premium = IV crush trap.` });
  }
  if (row.atrPct > 5) {
    out.push({ code: "HIGH_ATR", points: -10, reason: `ATR ${row.atrPct}% — outsized realized volatility.` });
  }
  if (row.changePct > 5) {
    out.push({ code: "CHASE", points: -8, reason: `Already up ${row.changePct.toFixed(1)}% today — chase risk.` });
  }
  if (row.earningsInDays != null && row.earningsInDays <= 2) {
    out.push({ code: "EARNINGS_48H", points: -15, reason: `Earnings in ${row.earningsInDays}d — binary event.` });
  }
  // Wide spread / illiquid OI proxies — we don't have a real chain, but the
  // optionsLiquidity score is a reasonable stand-in.
  if (row.optionsLiquidity < 30) {
    out.push({ code: "ILLIQUID_OI", points: -12, reason: "Thin options chain — open interest too low for clean fills." });
  } else if (row.optionsLiquidity < 50) {
    out.push({ code: "WIDE_SPREAD", points: -10, reason: "Estimated bid/ask spread is wide — slippage will hurt R/R." });
  }
  // Deep ITM proxy: any single-leg long with conservative sizing where strike
  // is meaningfully below price (call) or above (put).
  if (decision.action === "Long Call" && decision.longStrike != null && decision.longStrike < row.price * 0.92) {
    out.push({ code: "DEEP_ITM", points: -15, reason: "Strike is deep ITM — capital-inefficient, skip unless stock replacement." });
  }
  if (decision.action === "Long Put" && decision.longStrike != null && decision.longStrike > row.price * 1.08) {
    out.push({ code: "DEEP_ITM", points: -15, reason: "Strike is deep ITM — capital-inefficient." });
  }
  return out;
}

// ── Action Label (Part 7) ───────────────────────────────────────────────────
// Spec mapping: Scanner only emits BUY NOW / WATCHLIST / WAIT / AVOID.
// EXIT is portfolio-only and never produced here.
function labelFor(rank: number, decision: StrategyDecision, penalties: Penalty[]): ActionLabel {
  if (decision.action === "WAIT — no edge") return "AVOID";
  // Hard-AVOID triggers — these dominate the score-based label.
  const hardAvoid = penalties.some((p) =>
    p.code === "ILLIQUID_OI" || p.code === "IV_TRAP" || p.code === "EARNINGS_48H" || p.code === "DEEP_ITM",
  );
  if (hardAvoid && rank < 75) return "AVOID";
  return actionFromScore(rank);
}

// ── Public entry point ──────────────────────────────────────────────────────
export function rankSetup(row: SetupRow, decision: StrategyDecision): RankResult {
  const readiness = computeReadinessScore(row);
  const options = computeOptionsScore(row, decision);
  const penalties = computePenalties(row, decision);
  const penaltyTotal = penalties.reduce((s, p) => s + p.points, 0);

  // Part 6 — final rank formula. Reweighted to mirror the institutional spec:
  // trend/regime/relVol live in readiness (45%), liquidity/IV-edge/R-R live in
  // options (40%), raw setup quality (15%), then penalties.
  const baseRank = clamp(
    Math.round(row.setupScore * 0.15 + readiness.total * 0.45 + options.total * 0.40 + penaltyTotal),
  );
  // Self-learning bias: gently nudge the score per label using historical
  // hit-rate multipliers (clamped to 0.85–1.15 in the DB).
  const provisionalLabel = labelFor(baseRank, decision, penalties);
  const mult = getLabelMultiplier(provisionalLabel);
  const rank = clamp(Math.round(baseRank * mult));

  return {
    setupScore: row.setupScore,
    readinessScore: readiness.total,
    optionsScore: options.total,
    finalRank: rank,
    label: labelFor(rank, decision, penalties),
    penalties,
    optionsBreakdown: {
      strikeEfficiency: options.strikeEfficiency,
      ivEdge: options.ivEdge,
      liquidity: options.liquidity,
      expirationFit: options.expirationFit,
      rewardRisk: options.rewardRisk,
      greeksAlignment: options.greeksAlignment,
      capitalEfficiency: options.capitalEfficiency,
    },
    readinessBreakdown: {
      trigger: readiness.trigger,
      regime: readiness.regime,
      sector: readiness.sector,
      timeOfDay: readiness.timeOfDay,
      ivOpportunity: readiness.ivOpportunity,
      newsTiming: readiness.newsTiming,
    },
  };
}

/** Tailwind classes for an Action Label badge. */
export function labelClasses(label: ActionLabel): string {
  switch (label) {
    case "BUY NOW":     return "bg-bullish/20 text-bullish border-bullish/50";
    case "WATCHLIST":   return "bg-primary/10 text-primary border-primary/40";
    case "WAIT":        return "bg-warning/10 text-warning border-warning/40";
    case "AVOID":       return "bg-bearish/15 text-bearish border-bearish/40";
    case "EXIT":        return "bg-bearish/25 text-bearish border-bearish/60";
  }
}
