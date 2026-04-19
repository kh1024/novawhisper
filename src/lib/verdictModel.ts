// ─────────────────────────────────────────────────────────────────────────────
// Shared verdict model — single source of truth for every pick row in the app.
//
// Each function maps to ONE dimension of the trade. The UI must never invent
// its own labels; it must call these functions and render whatever they say.
// That guarantees the summary cards, scanner rows, watchlist cards, dashboard
// opportunities, and market-page rows can never disagree.
//
//   computeBias()         → "Bullish" | "Bearish" | "Neutral"
//   computeTiming()       → "Ready" | "Wait for Open" | "Wait for Confirmation" | "Too Late"
//   computeRisk()         → "Conservative" | "Moderate" | "Aggressive"
//   computeContractFit()  → fit + suggested contract string + affordability
//   computeVerdict()      → "Buy Now" | "Watchlist" | "Wait" | "Avoid"
//   validateRowConsistency() → catches contradictions BEFORE render
//
// All functions are pure. Inputs come from the existing scanner / watchlist
// data; we don't fetch anything here.
// ─────────────────────────────────────────────────────────────────────────────

export type Bias = "Bullish" | "Bearish" | "Neutral";
export type Timing =
  | "Ready"
  | "Wait for Open"
  | "Wait for Confirmation"
  | "Too Late";
export type Risk = "Conservative" | "Moderate" | "Aggressive";
export type Verdict = "Buy Now" | "Watchlist" | "Wait" | "Avoid";

// ── Tooltips (single source of help text) ───────────────────────────────────
export const FIELD_TOOLTIPS = {
  bias: "Bias: directional setup based on trend, momentum, and signal stack.",
  timing: "Timing: whether entry conditions are active right now.",
  risk: "Risk: how aggressive this trade is — affects sizing and chase risk.",
  contract: "Contract: suggested option chosen for affordability and liquidity.",
  verdict: "Verdict: overall action recommendation combining setup, timing, risk, and contract fit.",
  setupScore: "Setup Score: 80–100 = strong setup · 65–79 = workable, needs context · <65 = weak / mixed.",
} as const;

export const VERDICT_TOOLTIP: Record<Verdict, string> = {
  "Buy Now": "Setup is valid, timing is Ready, contract is affordable & liquid, no hard blockers.",
  Watchlist: "Setup is close but missing one trigger or confirmation — track and wait.",
  Wait: "Mixed signals or open-dependent — acceptable setup but not actionable yet.",
  Avoid: "Hard blocker present: poor liquidity, bad contract fit, overextended, or no edge.",
};

export const TIMING_TOOLTIP: Record<Timing, string> = {
  Ready: "Entry conditions are live — trigger fired and market is open.",
  "Wait for Open": "Market is closed (overnight / weekend). Live triggers resume at open.",
  "Wait for Confirmation": "Setup is close but the trigger hasn't confirmed yet.",
  "Too Late": "Move is already extended (chase risk) — let it cool off.",
};

export const RISK_TOOLTIP: Record<Risk, string> = {
  Conservative: "Lower-volatility, deeper-ITM or established trend trade.",
  Moderate: "Balanced setup — typical sizing and standard chase risk.",
  Aggressive: "High-volatility, OTM, or extended setup — small size only.",
};

// ── Inputs ──────────────────────────────────────────────────────────────────
/**
 * Everything the verdict model needs from a scanner/watchlist row. All fields
 * optional so it works for thin watchlist items too — missing data biases the
 * verdict to "Wait" rather than throwing.
 */
export interface VerdictInputs {
  /** Underlying symbol — used in suggested contract string. */
  symbol?: string;
  /** Live underlying price. */
  price?: number | null;
  /** Today's % change. */
  changePct?: number | null;
  /** Setup quality 0–100. */
  setupScore?: number | null;
  /** Final composite rank 0–100 (Scanner's institutional rank). */
  finalRank?: number | null;
  /** RSI (14). Used for "Too Late" / chase. */
  rsi?: number | null;
  /** Options-liquidity proxy 0–100. <30 = hard block. */
  optionsLiquidity?: number | null;
  /** Days until next earnings release, if known. */
  earningsInDays?: number | null;
  /** Bias as it lives on existing rows. */
  rawBias?: "bullish" | "bearish" | "neutral" | "reversal" | string | null;
  /** Option type (call/put) for the suggested contract. */
  optionType?: "call" | "put" | string | null;
  /** Strike of the recommended contract, if any. */
  strike?: number | string | null;
  /** Per-contract premium (single share, NOT × 100). */
  premium?: number | null;
  /** Per-trade dollar cap from settings (computeBudget()). */
  budget?: number | null;
  /** True if scanner verdict is forced to BUY. */
  isReady?: boolean;
  /** True if a hard NOVA Guard / safety gate is blocking the trade. */
  isHardBlocked?: boolean;
  /** True if data is stale (weekend zombie quote, expired feed). */
  isStale?: boolean;
  /** Pick expired / timed out without confirming. */
  isTimedOut?: boolean;
  /** When provided, the live verdict from the upstream rank engine
   *  (BUY NOW / WATCHLIST / WAIT / AVOID / BLOCKED / EXIT). Used to *guide* the
   *  final verdict — but local consistency rules can still override. */
  upstreamLabel?: string | null;
  /** Risk bucket from upstream engine (safe / mild / aggressive / lottery). */
  riskBucket?: string | null;
}

// ── Bias ────────────────────────────────────────────────────────────────────
export function computeBias(inp: VerdictInputs): Bias {
  const raw = (inp.rawBias ?? "").toString().toLowerCase();
  if (raw === "bullish") return "Bullish";
  if (raw === "bearish") return "Bearish";
  // Reversal/neutral collapse to whichever side the option type implies.
  if (inp.optionType === "put") return "Bearish";
  if (inp.optionType === "call") return "Bullish";
  return "Neutral";
}

// ── Market clock ────────────────────────────────────────────────────────────
/** True when US equities cash session is open right now. */
export function isMarketOpen(now: Date = new Date()): boolean {
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = est.getDay();
  const min = est.getHours() * 60 + est.getMinutes();
  return dow >= 1 && dow <= 5 && min >= 9 * 60 + 30 && min < 16 * 60;
}

/** True for Saturday / Sunday in EST. */
export function isWeekend(now: Date = new Date()): boolean {
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = est.getDay();
  return dow === 0 || dow === 6;
}

// ── Timing ──────────────────────────────────────────────────────────────────
export function computeTiming(inp: VerdictInputs, now: Date = new Date()): Timing {
  // Stale / weekend → never allow Ready.
  if (!isMarketOpen(now)) {
    // If RSI is screaming chase, prefer "Too Late" over "Wait for Open" so the
    // user knows that even if the bell rings, this one's gone.
    if (typeof inp.rsi === "number" && inp.rsi > 78) return "Too Late";
    if (typeof inp.changePct === "number" && inp.changePct > 6) return "Too Late";
    return "Wait for Open";
  }

  // Hard chase guard.
  if (typeof inp.rsi === "number" && inp.rsi > 78) return "Too Late";
  if (typeof inp.changePct === "number" && inp.changePct > 6) return "Too Late";

  // Ready: explicit BUY label OR strong final rank during market hours.
  const upstream = (inp.upstreamLabel ?? "").toUpperCase();
  if (inp.isReady || upstream === "BUY NOW" || upstream === "BUY") return "Ready";
  if (typeof inp.finalRank === "number" && inp.finalRank >= 80) return "Ready";

  // Strong setup but waiting on trigger / pullback / confirmation.
  return "Wait for Confirmation";
}

// ── Risk ────────────────────────────────────────────────────────────────────
export function computeRisk(inp: VerdictInputs): Risk {
  const bucket = (inp.riskBucket ?? "").toString().toLowerCase();
  if (bucket === "safe" || bucket.startsWith("conserv")) return "Conservative";
  if (bucket === "aggressive" || bucket === "lottery") return "Aggressive";
  if (bucket === "mild" || bucket.startsWith("mod") || bucket === "mid") return "Moderate";
  // Derive from setup score + change% if no explicit bucket.
  const score = inp.setupScore ?? 0;
  const move = Math.abs(inp.changePct ?? 0);
  if (score >= 80 && move < 2) return "Conservative";
  if (move > 4 || (score < 60 && move > 2)) return "Aggressive";
  return "Moderate";
}

// ── Contract fit ────────────────────────────────────────────────────────────
export interface ContractFit {
  /** Suggested contract label, e.g. "$120C". */
  label: string;
  /** Estimated single-contract debit ($premium × 100), or null if unknown. */
  costPerContract: number | null;
  /** Pass/fail decision against budget + liquidity. */
  affordable: boolean;
  /** True if the chain is liquid enough to trade cleanly. */
  liquid: boolean;
  /** Plain-English explanation, surfaced in tooltips. */
  reason: string;
}

export function computeContractFit(inp: VerdictInputs): ContractFit {
  const isPut = inp.optionType === "put";
  const symbolStrike =
    inp.strike == null || inp.strike === ""
      ? null
      : Number.isFinite(Number(inp.strike))
        ? Number(inp.strike)
        : String(inp.strike);
  const strikeText =
    typeof symbolStrike === "number"
      ? Number.isInteger(symbolStrike)
        ? `${symbolStrike}`
        : symbolStrike.toFixed(2)
      : symbolStrike ?? "";
  const label = strikeText
    ? `$${strikeText}${isPut ? "P" : "C"}`
    : isPut
      ? "PUT"
      : "CALL";

  const premium = typeof inp.premium === "number" && inp.premium > 0 ? inp.premium : null;
  const cost = premium != null ? Math.round(premium * 100) : null;
  const budget = inp.budget && inp.budget > 0 ? inp.budget : null;
  const liquid = (inp.optionsLiquidity ?? 100) >= 30;

  let affordable = true;
  let reason = "Within budget and liquid.";
  if (!liquid) {
    affordable = false;
    reason = "Options chain too thin — wide spreads will hurt fills.";
  } else if (cost != null && budget != null && cost > budget) {
    affordable = false;
    reason = `Single contract ≈ $${cost} exceeds your $${budget} per-trade cap.`;
  } else if (cost != null && budget != null) {
    reason = `Single contract ≈ $${cost} fits inside your $${budget} per-trade cap.`;
  } else if (cost == null) {
    reason = "Premium not yet available — cost check pending.";
  }

  return { label, costPerContract: cost, affordable, liquid, reason };
}

// ── Final Verdict ───────────────────────────────────────────────────────────
export interface VerdictResult {
  verdict: Verdict;
  bias: Bias;
  timing: Timing;
  risk: Risk;
  contract: ContractFit;
  /** Why the verdict landed where it did — surfaced in tooltips. */
  reason: string;
}

export function computeVerdict(inp: VerdictInputs): VerdictResult {
  const bias = computeBias(inp);
  const timing = computeTiming(inp);
  const risk = computeRisk(inp);
  const contract = computeContractFit(inp);

  // Hard blockers — collapse to Avoid no matter what else happens.
  const upstream = (inp.upstreamLabel ?? "").toUpperCase();
  if (inp.isHardBlocked || upstream === "BLOCKED") {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: "Safety gate blocked the trade." };
  }
  if (inp.isStale) {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: "Quote is stale — refusing to act on zombie data." };
  }
  if (inp.isTimedOut) {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: "Setup expired without confirming." };
  }
  if (!contract.liquid) {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: contract.reason };
  }
  if (!contract.affordable) {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: contract.reason };
  }
  if (typeof inp.earningsInDays === "number" && inp.earningsInDays >= 0 && inp.earningsInDays <= 2) {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: `Earnings in ${inp.earningsInDays}d — binary event risk.` };
  }
  if (timing === "Too Late") {
    return { verdict: "Avoid", bias, timing, risk, contract, reason: "Already extended — chase risk too high." };
  }

  // Soft outcomes ranked by timing × score.
  const score = inp.finalRank ?? inp.setupScore ?? 0;

  if (timing === "Ready" && score >= 75) {
    return { verdict: "Buy Now", bias, timing, risk, contract, reason: `Setup score ${score} · trigger live · contract fits budget.` };
  }
  if (timing === "Wait for Open") {
    if (score >= 70) {
      return { verdict: "Watchlist", bias, timing, risk, contract, reason: "Strong setup — re-check at the open." };
    }
    return { verdict: "Wait", bias, timing, risk, contract, reason: "Live triggers resume at market open." };
  }
  if (timing === "Wait for Confirmation") {
    if (score >= 70) {
      return { verdict: "Watchlist", bias, timing, risk, contract, reason: "Setup close — waiting on a confirmed trigger." };
    }
    return { verdict: "Wait", bias, timing, risk, contract, reason: "Mixed signals — monitor for a cleaner read." };
  }
  // timing === Ready but score < 75 → still just "Watchlist".
  if (score >= 60) {
    return { verdict: "Watchlist", bias, timing, risk, contract, reason: "Trigger live but score below high-conviction threshold." };
  }
  return { verdict: "Wait", bias, timing, risk, contract, reason: "No edge yet." };
}

// ── Consistency check ───────────────────────────────────────────────────────
/**
 * Returns a list of human-readable contradictions in a row's labels.
 * Empty array == row is internally consistent. Used by tests + dev overlays;
 * the UI also calls this to refuse to render contradictory verdicts.
 */
export function validateRowConsistency(r: VerdictResult): string[] {
  const issues: string[] = [];
  if (r.verdict === "Buy Now" && r.timing !== "Ready") {
    issues.push(`Buy Now requires Timing=Ready (got ${r.timing}).`);
  }
  if (r.verdict === "Buy Now" && !r.contract.affordable) {
    issues.push("Buy Now but contract is not affordable.");
  }
  if (r.verdict === "Buy Now" && !r.contract.liquid) {
    issues.push("Buy Now but contract is not liquid.");
  }
  if (r.timing === "Too Late" && r.verdict === "Buy Now") {
    issues.push("Too Late timing cannot produce Buy Now.");
  }
  // Words that must never collide with risk semantics.
  const RESERVED_WORDS = ["NOW", "WAIT", "AVOID", "READY"];
  if (RESERVED_WORDS.includes(r.risk as unknown as string)) {
    issues.push(`Risk field is using reserved word "${r.risk}".`);
  }
  return issues;
}

// ── Display helpers (Tailwind classes) ──────────────────────────────────────
export function biasClasses(b: Bias): string {
  if (b === "Bullish") return "text-bullish";
  if (b === "Bearish") return "text-bearish";
  return "text-foreground";
}

export function timingClasses(t: Timing): string {
  if (t === "Ready") return "text-bullish";
  if (t === "Wait for Open") return "text-muted-foreground";
  if (t === "Wait for Confirmation") return "text-warning";
  return "text-bearish"; // Too Late
}

export function riskClasses(r: Risk): string {
  if (r === "Conservative") return "text-foreground";
  if (r === "Aggressive") return "text-bearish";
  return "text-foreground"; // Moderate
}

/** Strong, high-contrast badge classes for the Verdict — always the dominant
 *  visual on the row so users read action first. */
export function verdictClasses(v: Verdict): string {
  if (v === "Buy Now")  return "bg-bullish text-bullish-foreground border-bullish/70";
  if (v === "Watchlist") return "bg-primary/15 text-primary border-primary/50";
  if (v === "Wait")     return "bg-warning/15 text-warning border-warning/50";
  return "bg-bearish/15 text-bearish border-bearish/50"; // Avoid
}
