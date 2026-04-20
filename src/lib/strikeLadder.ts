// Strike Ladder — generate CANDIDATE strikes across the delta curve for a
// single underlying, estimate premium for each, and pick the highest-quality
// rung that fits the user's per-trade cap.
//
// This solves the "F $13C costs $1,280, every pick blocked" bug: the scanner
// previously emitted exactly ONE synthetic ATM strike per ticker, then
// mis-priced it by treating spot as premium. Now we ladder through Deep ITM /
// ITM / ATM / OTM and pick whichever rung the budget actually fits.

import { estimatePremium, ivRankToIv, isPremiumSuspect, type EstimatedQuote } from "./premiumEstimator";

export type Rung = "DeepITM" | "ITM" | "ATM" | "OTM";

export interface LadderCandidate {
  rung: Rung;
  strike: number;
  optionType: "call" | "put";
  expiry: string;
  /** Per-share premium estimate (mid). */
  premium: number;
  /** Per-contract cost in dollars (premium × 100). Excludes fees. */
  contractCost: number;
  /** Approximate delta from the BS estimator. */
  delta: number;
  /** True when the estimator returned suspect-looking data. */
  suspect: boolean;
}

export interface BuildLadderInput {
  spot: number;
  ivRank: number;       // 0–100
  optionType: "call" | "put";
  expiry: string;       // YYYY-MM-DD
  dte: number;          // days to expiry
  /** When provided, "OTM" rung is included (lottery bucket). */
  includeOTM?: boolean;
}

/**
 * Snap a strike to a sensible grid that real chains list:
 *   • spot < $25  → $1 strikes
 *   • spot < $50  → $2.5 strikes
 *   • spot < $200 → $5 strikes
 *   • spot ≥ $200 → $10 strikes
 */
function snapToGrid(strike: number, spot: number): number {
  let step: number;
  if (spot < 25) step = 1;
  else if (spot < 50) step = 2.5;
  else if (spot < 200) step = 5;
  else step = 10;
  return Math.max(step, Math.round(strike / step) * step);
}

/** Build the strike ladder for one (symbol, expiry, optionType). */
export function buildStrikeLadder(input: BuildLadderInput): LadderCandidate[] {
  const { spot, ivRank, optionType, expiry, dte, includeOTM } = input;
  const iv = ivRankToIv(ivRank);

  // Multipliers tuned so the resulting strike sits in the right delta band.
  // For PUTS we mirror across spot (Deep ITM put = strike well above spot).
  const isCall = optionType === "call";
  const rungs: Array<{ rung: Rung; mult: number }> = [
    { rung: "DeepITM", mult: isCall ? 0.85 : 1.18 },
    { rung: "ITM",     mult: isCall ? 0.92 : 1.09 },
    { rung: "ATM",     mult: 1.00 },
  ];
  if (includeOTM) {
    rungs.push({ rung: "OTM", mult: isCall ? 1.05 : 0.95 });
  }

  const out: LadderCandidate[] = [];
  for (const r of rungs) {
    const rawStrike = spot * r.mult;
    const strike = snapToGrid(rawStrike, spot);
    const est: EstimatedQuote = estimatePremium({ spot, strike, iv, dte, optionType });
    if (est.degenerate) continue;
    out.push({
      rung: r.rung,
      strike,
      optionType,
      expiry,
      premium: est.perShare,
      contractCost: Math.round(est.perShare * 100),
      delta: est.delta,
      suspect: isPremiumSuspect(est.perShare, spot),
    });
  }
  // Cheapest first — picker walks down quality, takes cheapest that fits cap.
  return out.sort((a, b) => a.contractCost - b.contractCost);
}

/**
 * Ranking preference: among rungs that fit the cap, prefer the QUALITY order
 *   ITM > DeepITM > ATM > OTM
 * because ITM gives the best directional leverage per dollar for a buy-only
 * book without the gamma decay risk of pure ATM/OTM. DeepITM is safer but
 * has lower % return; ATM/OTM only when nothing else fits.
 */
const QUALITY_RANK: Record<Rung, number> = {
  ITM: 4, DeepITM: 3, ATM: 2, OTM: 1,
};

export interface LadderPick {
  candidate: LadderCandidate;
  fitsCap: boolean;
  /** All ladder candidates (cheapest first) for transparency / "see alternatives". */
  ladder: LadderCandidate[];
  /** The cheapest candidate, regardless of cap. Useful for the diagnostic line. */
  cheapest: LadderCandidate;
}

/**
 * Pick the best rung that fits `capDollars`. If nothing fits, return the
 * cheapest candidate so the caller can still display it as budget-blocked
 * with a real premium (not a fake spot-as-premium number).
 */
export function pickBestRung(ladder: LadderCandidate[], capDollars: number): LadderPick | null {
  if (ladder.length === 0) return null;
  const cheapest = ladder[0];
  const fitting = ladder.filter((c) => c.contractCost <= capDollars && !c.suspect);
  if (fitting.length === 0) {
    return { candidate: cheapest, fitsCap: false, ladder, cheapest };
  }
  // Prefer highest quality rung; tiebreak by cheapest.
  fitting.sort((a, b) => {
    const qa = QUALITY_RANK[a.rung];
    const qb = QUALITY_RANK[b.rung];
    if (qa !== qb) return qb - qa;
    return a.contractCost - b.contractCost;
  });
  return { candidate: fitting[0], fitsCap: true, ladder, cheapest };
}
