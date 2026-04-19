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

// ─────────────────────────────────────────────────────────────────────────
// True 52-week IVP path — reads accumulated daily ATM-IV from `iv_history`.
// Activates automatically once enough samples (≥60 days) have accumulated.
// Until then callers should fall back to `ivpFromChain`.
// ─────────────────────────────────────────────────────────────────────────

const HISTORY_MIN_SAMPLES = 60;
const HISTORY_LOOKBACK_DAYS = 252; // ~52 trading weeks
// In-memory memo so we don't refetch the same series repeatedly within a session.
const _historyCache = new Map<string, { at: number; values: number[] }>();
const HISTORY_TTL_MS = 15 * 60_000;

/**
 * Fetch up to 252 most recent ATM-IV samples for `symbol` from iv_history.
 * Returns `null` when the table is unavailable, or the symbol has no rows.
 * Memoized for 15 minutes per symbol.
 */
export async function fetchIvHistory(symbol: string): Promise<number[] | null> {
  const key = symbol.toUpperCase();
  const cached = _historyCache.get(key);
  if (cached && Date.now() - cached.at < HISTORY_TTL_MS) return cached.values;
  try {
    // Lazy import to keep this module tree-shakeable for tests that don't touch Supabase.
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await (supabase.from as any)("iv_history")
      .select("iv,as_of")
      .eq("symbol", key)
      .order("as_of", { ascending: false })
      .limit(HISTORY_LOOKBACK_DAYS);
    if (error || !data || data.length === 0) return null;
    const values = (data as { iv: number }[])
      .map((r) => Number(r.iv))
      .filter((v) => Number.isFinite(v) && v > 0);
    _historyCache.set(key, { at: Date.now(), values });
    return values;
  } catch {
    return null;
  }
}

/**
 * Compute IVP from a 252-day history series: % of historical samples that are
 * strictly below `currentIV`. Returns null when not enough samples exist.
 */
export function ivpFromHistory(currentIV: number, history: number[] | null | undefined): number | null {
  if (!history || history.length < HISTORY_MIN_SAMPLES) return null;
  if (!Number.isFinite(currentIV)) return null;
  const below = history.reduce((n, v) => (v < currentIV ? n + 1 : n), 0);
  return Math.round((below / history.length) * 100);
}

/**
 * Preferred end-to-end IVP: try true 52-week history first, fall back to the
 * chain-envelope proxy. Async because history requires a Supabase round-trip.
 */
export async function ivpPreferred(
  symbol: string,
  contracts: OptionContract[] | null | undefined,
  spot: number | null | undefined,
  type: "call" | "put",
): Promise<{ ivp: number; currentIV: number; ivLow: number; ivHigh: number; source: "history" | "chain" } | null> {
  const chainResult = ivpFromChain(contracts, spot, type);
  if (!chainResult) return null;
  const history = await fetchIvHistory(symbol);
  const histIvp = ivpFromHistory(chainResult.currentIV, history);
  if (histIvp != null && history) {
    const lo = Math.min(...history);
    const hi = Math.max(...history);
    return {
      ivp: histIvp,
      currentIV: chainResult.currentIV,
      ivLow: lo,
      ivHigh: hi,
      source: "history",
    };
  }
  return { ...chainResult, source: "chain" };
}
