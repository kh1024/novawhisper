// Strategy Builder — single-leg only (calls and puts).
// The app was downgraded to call/put-only trading. Spreads, condors, straddles,
// strangles, calendars, covered calls and CSPs were removed. Recommendations now
// always resolve to one of:
//   • Long Call
//   • Long Put
//   • Stock-Replacement Call (deep-ITM call as stock proxy)
//   • 0-DTE Call / 0-DTE Put (intraday only)
//
// Pure heuristic — no external data. Inputs come entirely from the user's
// TraderProfile (risk, horizon, outlook, event, account, IV stance).

import type {
  AccountSize,
  EventBias,
  Horizon,
  Outlook,
  RiskTolerance,
  TraderProfile,
} from "./settings";

export type StrategyKind =
  | "long_call"               // pure bullish
  | "long_put"                // pure bearish
  | "stock_replacement_call"  // deep ITM call as stock proxy
  | "zero_dte_call"           // 0-DTE momentum
  | "zero_dte_put";           // 0-DTE momentum

export type RiskBucket = "safe" | "mild" | "aggressive";

export interface StrategySuggestion {
  kind: StrategyKind;
  name: string;
  bucket: RiskBucket;
  tagline: string;
  mechanics: string;
  why: string;
  maxLoss: string;
  maxGain: string;
  ivStance: "needs low IV" | "needs high IV" | "IV-neutral";
  dteHint: string;
  strikeHint: string;
  sizingHint: string;
  warnings: string[];
}

const TEMPLATES: Record<StrategyKind, Omit<StrategySuggestion, "why" | "sizingHint" | "warnings">> = {
  long_call: {
    kind: "long_call",
    name: "Long Call",
    bucket: "mild",
    tagline: "Pure bullish bet. 100% premium at risk, theoretically unlimited upside.",
    mechanics:
      "Buy a call. Maximum loss is the premium; gains accrue once price exceeds strike + premium.",
    maxLoss: "Premium paid (100%)",
    maxGain: "Unlimited",
    ivStance: "needs low IV",
    dteHint: "≥ 30 DTE for swings, ≥ 60 DTE if you want margin for time decay",
    strikeHint: "ATM (40–55 delta) for aggressive sizing, slight ITM (60–70 delta) for balanced.",
  },
  long_put: {
    kind: "long_put",
    name: "Long Put",
    bucket: "mild",
    tagline: "Pure bearish bet. 100% premium at risk, large downside profit.",
    mechanics:
      "Buy a put. Maximum loss is the premium; gains accrue once price falls below strike − premium.",
    maxLoss: "Premium paid (100%)",
    maxGain: "Strike − premium (large)",
    ivStance: "needs low IV",
    dteHint: "≥ 30 DTE for swings",
    strikeHint: "ATM (40–55 delta) for aggressive sizing, slight ITM (60–70 delta) for balanced.",
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
  if (kind === "long_call" || kind === "long_put") {
    if (profile.ivStance === "high") w.push("⚠ Premium likely rich — IV crush will hurt P&L. Consider waiting for IV to cool.");
    if (profile.event === "earnings") w.push("⚠ Long premium into earnings = IV crush risk. Size small or skip.");
  }
  if (kind === "zero_dte_call" || kind === "zero_dte_put") {
    w.push("⚠ 0-DTE: monitor live. Pre-set a stop (e.g. −40% premium) and a profit-take rule before entry.");
  }
  if (kind === "stock_replacement_call" && profile.ivStance === "high") {
    w.push("⚠ High IV inflates extrinsic — the deep-ITM premium gets pricey. Wait for IV to cool if possible.");
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
 * Decision tree — returns 1–3 single-leg suggestions ordered by fit.
 * Always falls back to a long call OR long put with a "wait for setup"
 * caveat if no clear directional read exists, since the app no longer
 * supports neutral structures.
 */
export function recommendStrategies(profile: TraderProfile): StrategySuggestion[] {
  const { risk, horizon, outlook, ivStance } = profile;
  const out: StrategySuggestion[] = [];

  const bullishBias = outlook === "bullish" || outlook === "slightly_bullish";
  const bearishBias = outlook === "bearish" || outlook === "slightly_bearish";

  // ── LOW RISK ──────────────────────────────────────────────────────────
  if (risk === "low") {
    if (bullishBias && horizon !== "intraday") {
      out.push(pick("stock_replacement_call", "Low risk + bullish: deep-ITM call mimics owning the stock with less capital, low theta exposure.", profile));
      out.push(pick("long_call", "Low risk + bullish: a slightly-ITM long call keeps premium small and gives directional exposure with capped loss.", profile));
    }
    if (bearishBias && horizon !== "intraday") {
      out.push(pick("long_put", "Low risk + bearish: ITM long put gives downside exposure with defined loss = premium paid.", profile));
    }
  }

  // ── MEDIUM RISK ───────────────────────────────────────────────────────
  if (risk === "medium") {
    if (bullishBias) {
      out.push(pick("long_call", "Medium risk + bullish: ATM/slight-ITM long call, defined max loss, full directional exposure.", profile));
      if (horizon !== "intraday") {
        out.push(pick("stock_replacement_call", "Medium risk + multi-week bullish: deep-ITM call as a leveraged stock proxy.", profile));
      }
    }
    if (bearishBias) {
      out.push(pick("long_put", "Medium risk + bearish: ATM/slight-ITM long put, defined max loss, full directional exposure.", profile));
    }
  }

  // ── HIGH RISK ─────────────────────────────────────────────────────────
  if (risk === "high") {
    if (horizon === "intraday") {
      if (bullishBias) out.push(pick("zero_dte_call", "Intraday + bullish: 0-DTE call, max gamma. Hard stops mandatory.", profile));
      if (bearishBias) out.push(pick("zero_dte_put", "Intraday + bearish: 0-DTE put, max gamma. Hard stops mandatory.", profile));
    }
    if (bullishBias && horizon !== "intraday") {
      out.push(pick("long_call", "High risk + bullish swing: ATM call for full directional convexity.", profile));
    }
    if (bearishBias && horizon !== "intraday") {
      out.push(pick("long_put", "High risk + bearish swing: ATM put for full directional convexity.", profile));
    }
    if (ivStance === "low" && bullishBias && horizon !== "intraday") {
      out.push(pick("long_call", "IV cheap + bullish — premium is on sale, ideal time to be long convexity.", profile));
    }
  }

  // Fallback: no clear bias chosen → still suggest something so the user
  // sees the playbook. Lean on outlook tilt.
  if (out.length === 0) {
    if (bearishBias) out.push(pick("long_put", "Default fallback for a bearish lean — single-leg long put keeps risk capped at premium.", profile));
    else out.push(pick("long_call", "Default fallback — single-leg long call keeps risk capped at premium while you wait for a better setup.", profile));
  }

  // Dedupe by kind.
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
