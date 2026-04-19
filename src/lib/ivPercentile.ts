// Real IV Percentile computation for Gate 6 (IVP Guard).
//
// True IVP requires a 252-day history of ATM IV per underlying, which is not
// in our current data pipeline. As a pragmatic proxy we compute IVP from the
// ATM contract's IV against the IV *range observed across the live chain*
// (all expiries / strikes returned by Polygon's options snapshot). That range
// captures the term-structure + skew envelope and is a meaningful "where
// does today's ATM IV sit vs. what the market is pricing right now" measure
// — far better than a PRNG estimate, and it never moves Gate 6 on synthetic
// data. When 52-week IV history becomes available it can be plugged directly
// into `computeIVP` without touching callers.

import type { OptionContract } from "@/lib/liveData";

/**
 * Linear percentile of `currentIV` within a [low, high] band.
 * Returns 0–100, rounded. If the band is degenerate, returns 50 (neutral).
 */
export function computeIVP(currentIV: number, ivLow: number, ivHigh: number): number {
  if (!Number.isFinite(currentIV) || !Number.isFinite(ivLow) || !Number.isFinite(ivHigh)) return 50;
  if (ivHigh <= ivLow) return 50;
  const pct = ((currentIV - ivLow) / (ivHigh - ivLow)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Pick the contract closest to spot for a given option type (call/put). */
export function pickAtmContract(
  contracts: OptionContract[],
  spot: number,
  type: "call" | "put",
): OptionContract | null {
  const sameType = contracts.filter((c) => c.type === type && Number.isFinite(c.iv ?? NaN));
  if (sameType.length === 0) return null;
  let best: OptionContract | null = null;
  let bestDist = Infinity;
  for (const c of sameType) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** Min/max IV across the chain (any contract with a finite iv). */
export function chainIvRange(contracts: OptionContract[]): { low: number; high: number } | null {
  let low = Infinity;
  let high = -Infinity;
  for (const c of contracts) {
    const v = c.iv;
    if (v == null || !Number.isFinite(v) || v <= 0) continue;
    if (v < low) low = v;
    if (v > high) high = v;
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

/**
 * End-to-end: given a live chain + spot + option type, return the real IVP
 * (0–100) plus the inputs used. Returns null when the chain is missing data.
 */
export function ivpFromChain(
  contracts: OptionContract[] | null | undefined,
  spot: number | null | undefined,
  type: "call" | "put",
): { ivp: number; currentIV: number; ivLow: number; ivHigh: number } | null {
  if (!contracts || contracts.length === 0 || !spot || spot <= 0) return null;
  // Prefer 52-week range if the chain ever exposes it; otherwise fall back to
  // the snapshot's IV envelope.
  const withRange = contracts.find(
    (c) => Number.isFinite((c as any).iv52wLow) && Number.isFinite((c as any).iv52wHigh),
  ) as (OptionContract & { iv52wLow?: number; iv52wHigh?: number }) | undefined;

  const range = withRange
    ? { low: Number(withRange.iv52wLow), high: Number(withRange.iv52wHigh) }
    : chainIvRange(contracts);
  if (!range) return null;

  const atm = pickAtmContract(contracts, spot, type);
  const currentIV = atm?.iv ?? null;
  if (currentIV == null) return null;

  return {
    ivp: computeIVP(currentIV, range.low, range.high),
    currentIV,
    ivLow: range.low,
    ivHigh: range.high,
  };
}
