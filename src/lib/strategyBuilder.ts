// Strategy Builder — pure heuristic decision tree.
// No external data feeds: everything is derived from the user's TraderProfile.
// Maps the high-level "match strategy to risk + outlook + event" rubric into a
// concrete list of strategy templates with rationale, defined risk, and the
// disclosures every retail options idea needs.

import type {
  AccountSize,
  EventBias,
  Horizon,
  Outlook,
  RiskTolerance,
  TraderProfile,
} from "./settings";

export type StrategyKind =
  | "bull_put_spread"      // credit, neutral-to-bullish
  | "bear_call_spread"     // credit, neutral-to-bearish
  | "covered_call"         // income vs long stock
  | "cash_secured_put"     // income, get-paid-to-buy
  | "bull_call_spread"     // debit, moderately bullish
  | "bear_put_spread"      // debit, moderately bearish
  | "iron_condor"          // defined-risk neutral on event
  | "long_straddle"        // big-move bet
  | "long_strangle"        // big-move, cheaper than straddle
  | "long_call"            // pure bullish
  | "long_put"             // pure bearish
  | "stock_replacement_call"  // deep ITM call as stock proxy
  | "zero_dte_call"        // 0-DTE momentum
  | "zero_dte_put";        // 0-DTE momentum

export type RiskBucket = "safe" | "mild" | "aggressive";

export interface StrategySuggestion {
  kind: StrategyKind;
  name: string;
  bucket: RiskBucket;
  // 1-line tagline shown under the name.
  tagline: string;
  // What the structure does, in retail-friendly language.
  mechanics: string;
  // Why we chose it for this profile (filled per-recommendation).
  why: string;
  // Defined risk + reward summary.
  maxLoss: string;
  maxGain: string;
  // Event/IV considerations.
  ivStance: "needs low IV" | "needs high IV" | "IV-neutral";
  // Suggested DTE range.
  dteHint: string;
  // Suggested moneyness.
  strikeHint: string;
  // Position-sizing hint based on account size.
  sizingHint: string;
  // Trap badges.
  warnings: string[];
}

const TEMPLATES: Record<StrategyKind, Omit<StrategySuggestion, "why" | "sizingHint" | "warnings">> = {
  bull_put_spread: {
    kind: "bull_put_spread",
    name: "Bull Put Spread (credit)",
    bucket: "safe",
    tagline: "Sell put, buy lower-strike put. Get paid if price stays above short strike.",
    mechanics:
      "Sell a higher-strike put, buy a lower-strike put. You collect a credit; max loss is the spread width minus the credit.",
    maxLoss: "Spread width − credit (defined)",
    maxGain: "Credit received",
    ivStance: "needs high IV",
    dteHint: "21–45 DTE",
    strikeHint: "Short put 1 standard deviation OTM, long put 1 strike below.",
  },
  bear_call_spread: {
    kind: "bear_call_spread",
    name: "Bear Call Spread (credit)",
    bucket: "safe",
    tagline: "Sell call, buy higher-strike call. Get paid if price stays below short strike.",
    mechanics:
      "Sell a lower-strike call, buy a higher-strike call. Credit at entry; max loss is width − credit.",
    maxLoss: "Spread width − credit (defined)",
    maxGain: "Credit received",
    ivStance: "needs high IV",
    dteHint: "21–45 DTE",
    strikeHint: "Short call ~1 SD OTM, long call 1 strike above.",
  },
  covered_call: {
    kind: "covered_call",
    name: "Covered Call",
    bucket: "safe",
    tagline: "Sell upside on stock you already own. Income with capped upside.",
    mechanics:
      "Hold 100 shares per contract, sell a call against them. Premium reduces cost basis; upside is capped at strike + premium.",
    maxLoss: "Stock can still fall — credit only buffers",
    maxGain: "Strike − cost basis + credit",
    ivStance: "needs high IV",
    dteHint: "30–45 DTE",
    strikeHint: "Strike above your target exit / ~30 delta.",
  },
  cash_secured_put: {
    kind: "cash_secured_put",
    name: "Cash-Secured Put",
    bucket: "safe",
    tagline: "Get paid to wait for a lower entry on a stock you actually want.",
    mechanics:
      "Sell a put, hold cash to cover assignment. You pocket premium; if assigned, you buy the stock at strike − credit.",
    maxLoss: "Strike × 100 − credit (you own the stock)",
    maxGain: "Credit received",
    ivStance: "needs high IV",
    dteHint: "21–45 DTE",
    strikeHint: "Strike at the price you'd happily own the stock.",
  },
  bull_call_spread: {
    kind: "bull_call_spread",
    name: "Bull Call Spread (debit)",
    bucket: "mild",
    tagline: "Buy ATM call, sell higher-strike call. Defined cost, defined upside.",
    mechanics:
      "Buy a call, sell a higher-strike call. Pay net debit; max gain is width − debit if price closes above the long strike.",
    maxLoss: "Net debit paid",
    maxGain: "Spread width − debit",
    ivStance: "IV-neutral",
    dteHint: "21–45 DTE (cover the catalyst)",
    strikeHint: "Long ATM, short ~1 expected-move OTM.",
  },
  bear_put_spread: {
    kind: "bear_put_spread",
    name: "Bear Put Spread (debit)",
    bucket: "mild",
    tagline: "Buy ATM put, sell lower-strike put. Defined cost, defined downside profit.",
    mechanics:
      "Buy a put, sell a lower-strike put. Net debit; max gain is width − debit on a moderate down-move.",
    maxLoss: "Net debit paid",
    maxGain: "Spread width − debit",
    ivStance: "IV-neutral",
    dteHint: "21–45 DTE",
    strikeHint: "Long ATM, short ~1 expected-move OTM.",
  },
  iron_condor: {
    kind: "iron_condor",
    name: "Iron Condor",
    bucket: "mild",
    tagline: "Defined-risk neutral. Profit if price stays inside the wings.",
    mechanics:
      "Sell an OTM call spread + OTM put spread. Collect a credit; max loss = wider spread width − credit.",
    maxLoss: "Wing width − credit",
    maxGain: "Credit received",
    ivStance: "needs high IV",
    dteHint: "30–45 DTE",
    strikeHint: "Short strikes ~1 SD OTM both sides.",
  },
  long_straddle: {
    kind: "long_straddle",
    name: "Long Straddle",
    bucket: "aggressive",
    tagline: "Buy ATM call + ATM put. Profits on a big move either way.",
    mechanics:
      "Long a call and a put at the same strike. Profits if the stock moves more than the combined premium; loses to time decay otherwise.",
    maxLoss: "Total premium paid",
    maxGain: "Unlimited (call leg) / Strike − premium (put leg)",
    ivStance: "needs low IV",
    dteHint: "Cover the catalyst + 1 week",
    strikeHint: "Both legs ATM.",
  },
  long_strangle: {
    kind: "long_strangle",
    name: "Long Strangle",
    bucket: "aggressive",
    tagline: "Cheaper version of a straddle: OTM call + OTM put.",
    mechanics:
      "Buy an OTM call + OTM put. Lower cost than a straddle but needs a bigger move to break even.",
    maxLoss: "Total premium paid",
    maxGain: "Unlimited (call) / Strike − premium (put)",
    ivStance: "needs low IV",
    dteHint: "Cover the catalyst + 1 week",
    strikeHint: "Call ~1 SD OTM, put ~1 SD OTM.",
  },
  long_call: {
    kind: "long_call",
    name: "Long Call",
    bucket: "aggressive",
    tagline: "Pure bullish bet. 100% premium at risk, theoretically unlimited upside.",
    mechanics:
      "Buy a call. Maximum loss is the premium; gains accrue once price exceeds strike + premium.",
    maxLoss: "Premium paid (100%)",
    maxGain: "Unlimited",
    ivStance: "needs low IV",
    dteHint: "≥ 30 DTE for swings, ≥ 60 DTE if you want margin for time decay",
    strikeHint: "ATM (40–55 delta) — never deep ITM in the Aggressive bucket.",
  },
  long_put: {
    kind: "long_put",
    name: "Long Put",
    bucket: "aggressive",
    tagline: "Pure bearish bet. 100% premium at risk, large downside profit.",
    mechanics:
      "Buy a put. Maximum loss is the premium; gains accrue once price falls below strike − premium.",
    maxLoss: "Premium paid (100%)",
    maxGain: "Strike − premium (large)",
    ivStance: "needs low IV",
    dteHint: "≥ 30 DTE for swings",
    strikeHint: "ATM (40–55 delta).",
  },
  stock_replacement_call: {
    kind: "stock_replacement_call",
    name: "Stock-Replacement Call (deep ITM)",
    bucket: "safe",
    tagline: "Deep-ITM call (Δ ≥ 0.80) acts like 100 shares with less capital.",
    mechanics:
      "Buy a deep-ITM call. High delta tracks the stock 1:1; lower theta because most of the price is intrinsic.",
    maxLoss: "Premium paid (mostly intrinsic)",
    maxGain: "Tracks stock minus extrinsic decay",
    ivStance: "IV-neutral",
    dteHint: "≥ 60 DTE — give the trade room",
    strikeHint: "Strike 5–10% ITM (Δ 0.75–0.90).",
  },
  zero_dte_call: {
    kind: "zero_dte_call",
    name: "0-DTE Call (intraday only)",
    bucket: "aggressive",
    tagline: "Same-day expiry call on intraday momentum. All or nothing.",
    mechanics:
      "Buy a 0-DTE call near ATM. High gamma, decays to zero by close. Hard stops mandatory.",
    maxLoss: "Premium paid (100%, fast)",
    maxGain: "Large but time-bound",
    ivStance: "needs low IV",
    dteHint: "Same session",
    strikeHint: "ATM or 1 strike OTM.",
  },
  zero_dte_put: {
    kind: "zero_dte_put",
    name: "0-DTE Put (intraday only)",
    bucket: "aggressive",
    tagline: "Same-day expiry put on intraday breakdown. All or nothing.",
    mechanics:
      "Buy a 0-DTE put near ATM. High gamma, decays to zero by close. Hard stops mandatory.",
    maxLoss: "Premium paid (100%, fast)",
    maxGain: "Large but time-bound",
    ivStance: "needs low IV",
    dteHint: "Same session",
    strikeHint: "ATM or 1 strike OTM.",
  },
};

function sizingFor(account: AccountSize, bucket: RiskBucket): string {
  const cap =
    account === "small" ? { safe: "1–2%", mild: "0.5–1%", aggressive: "≤ 0.5%" } :
    account === "medium" ? { safe: "2–4%", mild: "1–2%", aggressive: "≤ 1%" } :
                            { safe: "3–5%", mild: "1–3%", aggressive: "≤ 1.5%" };
  return `Risk ${cap[bucket]} of account on this trade.`;
}

function warningsFor(kind: StrategyKind, profile: TraderProfile): string[] {
  const w: string[] = [];
  if (kind === "long_straddle" || kind === "long_strangle") {
    if (profile.ivStance === "high") w.push("⚠ IV stance is High — expect IV crush after the catalyst, premium can collapse even if the stock moves.");
  }
  if (kind === "long_call" || kind === "long_put") {
    if (profile.ivStance === "high") w.push("⚠ Premium likely rich — consider a debit spread instead to cap cost.");
  }
  if (kind === "zero_dte_call" || kind === "zero_dte_put") {
    w.push("⚠ 0-DTE: monitor live. Pre-set a stop (e.g. −40% premium) and a profit-take rule before entry.");
  }
  if (kind === "covered_call" && profile.outlook === "bullish") {
    w.push("⚠ You're capping upside on a bullish thesis. Consider a higher strike or skip this leg.");
  }
  if ((kind === "bull_put_spread" || kind === "bear_call_spread" || kind === "iron_condor") && profile.ivStance === "low") {
    w.push("⚠ Low IV means thin credits — risk-to-reward may not be worth it.");
  }
  return w;
}


function pick(kind: StrategyKind, why: string, profile: TraderProfile): StrategySuggestion {
  const t = TEMPLATES[kind];
  return {
    ...t,
    why,
    sizingHint: sizingFor(profile.account, t.bucket),
    warnings: warningsFor(kind, profile),
  };
}

/**
 * Decision tree mirroring the user's spec. Returns 1–4 suggestions ordered by
 * fit. Always includes at least one defined-risk option so a beginner has a
 * sane fallback.
 */
export function recommendStrategies(profile: TraderProfile): StrategySuggestion[] {
  const { risk, horizon, outlook, event, ivStance } = profile;
  const out: StrategySuggestion[] = [];

  const bullishBias = outlook === "bullish" || outlook === "slightly_bullish";
  const bearishBias = outlook === "bearish" || outlook === "slightly_bearish";
  const neutralBias = outlook === "neutral" || outlook === "uncertain";

  // ── LOW RISK ───────────────────────────────────────────────────────────
  if (risk === "low") {
    if (bullishBias || neutralBias) {
      out.push(pick("bull_put_spread", "Low risk + non-bearish outlook → collect premium, defined max loss.", profile));
    }
    if (bullishBias) {
      out.push(pick("covered_call", "Low risk + bullish: monetise shares you'd hold anyway, cap upside in exchange for income.", profile));
      out.push(pick("cash_secured_put", "Low risk + bullish: get paid to wait for a better entry on a name you actually want.", profile));
    }
    if (bearishBias) {
      out.push(pick("bear_call_spread", "Low risk + bearish: collect credit while staying defined-risk.", profile));
    }
    if (neutralBias) {
      out.push(pick("iron_condor", "Low risk + neutral: defined-risk income while price drifts inside the wings.", profile));
    }
  }

  // ── MEDIUM RISK ────────────────────────────────────────────────────────
  if (risk === "medium") {
    if (event === "earnings" && bullishBias) {
      out.push(pick("bull_call_spread", "Earnings + bullish: defined-risk debit spread sized to the expected move.", profile));
    }
    if (event === "earnings" && bearishBias) {
      out.push(pick("bear_put_spread", "Earnings + bearish: defined-risk debit spread to fade the move.", profile));
    }
    if (event === "earnings" && (neutralBias || outlook === "uncertain")) {
      out.push(pick("iron_condor", "Earnings + uncertain: defined-risk neutral, profits if the move stays inside the wings.", profile));
    }
    if (!event || event === "none" || event === "macro") {
      if (bullishBias) out.push(pick("bull_call_spread", "Medium risk + bullish swing: capped cost, capped reward, no IV-crush surprise.", profile));
      if (bearishBias) out.push(pick("bear_put_spread", "Medium risk + bearish swing: capped cost, capped reward.", profile));
      if (neutralBias) out.push(pick("iron_condor", "Medium risk + range-bound: defined-risk income while price chops.", profile));
    }
    // Always offer a stock-replacement option for medium risk + strong direction.
    if (outlook === "bullish" && horizon !== "intraday") {
      out.push(pick("stock_replacement_call", "Strong bullish + multi-week horizon: deep-ITM call gives ~1:1 upside with less capital.", profile));
    }
  }

  // ── HIGH RISK ──────────────────────────────────────────────────────────
  if (risk === "high") {
    // Big-move expectation + cheap IV → straddle/strangle.
    if (event === "earnings" && ivStance !== "high") {
      out.push(pick("long_straddle", "Earnings + IV not stretched: pay for the move both ways.", profile));
      out.push(pick("long_strangle", "Cheaper alternative if you want the same shape with less premium.", profile));
    }
    // Strong directional conviction → ATM single leg (NOT deep ITM — that's stock-replacement, which is Safe).
    if (bullishBias && horizon !== "intraday") {
      out.push(pick("long_call", "High risk + bullish conviction: ATM call, tight cost, full directional exposure.", profile));
    }
    if (bearishBias && horizon !== "intraday") {
      out.push(pick("long_put", "High risk + bearish conviction: ATM put, tight cost, full directional exposure.", profile));
    }
    // Day-trade mentality → 0-DTE.
    if (horizon === "intraday") {
      if (bullishBias) out.push(pick("zero_dte_call", "Intraday momentum + bullish: 0-DTE call. Hard stops mandatory.", profile));
      if (bearishBias) out.push(pick("zero_dte_put",  "Intraday momentum + bearish: 0-DTE put. Hard stops mandatory.", profile));
    }
  }

  // Always include at least one defined-risk fallback if we're empty (e.g. high
  // risk + uncertain outlook + intraday + no event → nothing matches above).
  if (out.length === 0) {
    out.push(pick("iron_condor", "No clear directional read — defined-risk neutral keeps you in the game without overcommitting.", profile));
  }

  // Dedupe by kind (in case multiple branches added the same template).
  const seen = new Set<StrategyKind>();
  return out.filter((s) => (seen.has(s.kind) ? false : (seen.add(s.kind), true)));
}

// ─── Display helpers ────────────────────────────────────────────────────────
export const RISK_LABELS: Record<RiskTolerance, string> = { low: "Low", medium: "Medium", high: "High" };
export const HORIZON_LABELS: Record<Horizon, string> = { intraday: "Intraday", swing: "Swing (days)", position: "Position (weeks+)" };
export const OUTLOOK_LABELS: Record<Outlook, string> = {
  bullish: "Bullish",
  slightly_bullish: "Slightly bullish",
  neutral: "Neutral",
  slightly_bearish: "Slightly bearish",
  bearish: "Bearish",
  uncertain: "Uncertain",
};
export const EVENT_LABELS: Record<EventBias, string> = { earnings: "Earnings ahead", macro: "Macro release", none: "No catalyst" };
export const ACCOUNT_LABELS: Record<AccountSize, string> = { small: "Small (<$10k)", medium: "Medium ($10k–$100k)", large: "Large ($100k+)" };
export const IV_LABELS = { low: "Low (cheap premium)", average: "Average", high: "High (rich premium)" } as const;
