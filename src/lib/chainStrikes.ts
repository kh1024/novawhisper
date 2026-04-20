// Snap suggested strike prices to *actually listed* strikes on the option chain.
// Solves bugs like "shows $100 call but no $100 strike exists for that expiry".
//
// Pipeline:
//   1. Fetch the chain via the existing `public-options-fetch` edge function
//      (cached via React Query — keyed by symbol + expiry).
//   2. snapStrike(suggested, listed) → nearest listed strike (within tolerance).
//      Falls back to a CBOE-style grid (~5% tolerance) when chain unavailable.
//   3. usePickStrikeSnap(picks) → Map<pickKey, snappedStrike|null>. A null value
//      means we couldn't verify the strike → caller should hide the pick.
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ChainContract {
  type: "call" | "put";
  strike: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

interface ChainResponse {
  contracts?: ChainContract[];
  ok?: boolean;
  error?: string;
}

async function fetchChain(symbol: string, expiry: string): Promise<ChainContract[]> {
  const { data, error } = await supabase.functions.invoke("public-options-fetch", {
    body: { underlying: symbol, expiry, limit: 300 },
  });
  if (error) throw error;
  const r = data as ChainResponse;
  if (r?.ok === false) throw new Error(r.error ?? "chain fetch failed");
  return r.contracts ?? [];
}

/** Standard CBOE-style strike grid by underlying price — used only as a
 *  *fallback* when the live chain isn't available. Real chains always win. */
function gridStep(price: number): number {
  if (price < 25) return 1;
  if (price < 50) return 2.5;
  if (price < 200) return 5;
  return 10;
}

/** Snap a suggested strike to the nearest value in `listed`. Returns null when
 *  the nearest listed strike is more than `tolPct` away from suggested — a
 *  signal the suggestion is bogus and the pick should be dropped. */
export function snapStrike(
  suggested: number,
  listed: number[],
  tolPct = 5,
): number | null {
  if (!Number.isFinite(suggested) || suggested <= 0) return null;
  if (listed.length === 0) return null;
  let best = listed[0];
  let bestDiff = Math.abs(best - suggested);
  for (const k of listed) {
    const d = Math.abs(k - suggested);
    if (d < bestDiff) { best = k; bestDiff = d; }
  }
  const pct = (bestDiff / suggested) * 100;
  return pct <= tolPct ? best : null;
}

/** Grid fallback when chain unavailable — quantize to the standard grid step. */
export function gridSnap(suggested: number, underlyingPrice: number): number {
  const step = gridStep(underlyingPrice);
  return Math.round(suggested / step) * step;
}

interface PickInput {
  key: string;
  symbol: string;
  expiry: string;
  optionType: "call" | "put";
  strike: number;
  underlyingPrice?: number | null;
}

export interface SnappedStrike {
  /** Real listed strike, or null if we couldn't verify one within tolerance. */
  snapped: number | null;
  /** True when we hit the live chain; false when grid fallback was used. */
  verified: boolean;
}

/** Batch-fetch chains for every (symbol, expiry) pair and return a per-pick
 *  snap result. Pickers should hide picks whose result is `{ snapped: null }`. */
export function usePickStrikeSnap(picks: PickInput[]): Map<string, SnappedStrike> {
  // Dedupe (symbol, expiry) pairs so we only fire one chain fetch per pair.
  const pairs = useMemo(() => {
    const m = new Map<string, { symbol: string; expiry: string }>();
    for (const p of picks) {
      if (!p.symbol || !p.expiry) continue;
      m.set(`${p.symbol}|${p.expiry}`, { symbol: p.symbol, expiry: p.expiry });
    }
    return Array.from(m.values());
  }, [picks]);

  const queries = useQueries({
    queries: pairs.map((pair) => ({
      queryKey: ["chain-strikes", pair.symbol, pair.expiry],
      queryFn: () => fetchChain(pair.symbol, pair.expiry),
      staleTime: 10 * 60_000,
      retry: 1,
    })),
  });

  return useMemo(() => {
    const chainMap = new Map<string, ChainContract[]>();
    pairs.forEach((p, i) => {
      const q = queries[i];
      if (q?.data) chainMap.set(`${p.symbol}|${p.expiry}`, q.data);
    });

    const out = new Map<string, SnappedStrike>();
    for (const p of picks) {
      const chain = chainMap.get(`${p.symbol}|${p.expiry}`);
      if (chain && chain.length > 0) {
        const listed = Array.from(new Set(
          chain.filter((c) => c.type === p.optionType && Number.isFinite(c.strike))
               .map((c) => c.strike as number),
        )).sort((a, b) => a - b);
        out.set(p.key, { snapped: snapStrike(p.strike, listed), verified: true });
      } else {
        // Chain unavailable → grid fallback (best-effort, marked unverified).
        const ref = p.underlyingPrice ?? p.strike;
        out.set(p.key, { snapped: gridSnap(p.strike, ref), verified: false });
      }
    }
    return out;
  }, [picks, pairs, queries]);
}
