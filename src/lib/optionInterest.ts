// Fetch live open interest for a list of option picks. Groups by underlying so we
// only hit the chain once per ticker, then matches on (type, strike, expiry).
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ScoutPick } from "./optionsScout";

interface ChainContract {
  type: "call" | "put";
  strike: number;
  expiration: string;
  openInterest: number;
  volume: number;
}
interface ChainResp { contracts: ChainContract[] }

async function fetchChain(underlying: string): Promise<ChainContract[]> {
  const { data, error } = await supabase.functions.invoke("options-fetch", {
    body: { underlying, limit: 250 },
  });
  if (error) throw error;
  return ((data as ChainResp)?.contracts ?? []).map((c) => ({
    type: c.type, strike: c.strike, expiration: c.expiration,
    openInterest: c.openInterest ?? 0, volume: c.volume ?? 0,
  }));
}

export interface PickInterest { oi: number; volume: number }

/**
 * Returns a Map keyed by `${symbol}|${type}|${strike}|${expiry}` → { oi, volume }.
 * Picks with spread legs use the long strike for matching.
 */
export function useOptionInterest(picks: ScoutPick[]): Map<string, PickInterest> {
  const symbols = Array.from(new Set(picks.map((p) => p.symbol)));
  const queries = useQueries({
    queries: symbols.map((sym) => ({
      queryKey: ["chain-oi", sym],
      queryFn: () => fetchChain(sym),
      staleTime: 10 * 60_000,
      refetchInterval: 15 * 60_000,
      retry: 1,
    })),
  });
  const map = new Map<string, PickInterest>();
  symbols.forEach((sym, i) => {
    const chain = queries[i].data;
    if (!chain) return;
    const symPicks = picks.filter((p) => p.symbol === sym);
    for (const p of symPicks) {
      const wantType: "call" | "put" =
        p.optionType === "put" || p.optionType === "put_spread" ? "put" : "call";
      // Find closest strike + matching expiry
      const sameExp = chain.filter((c) => c.type === wantType && c.expiration === p.expiry);
      const pool = sameExp.length ? sameExp : chain.filter((c) => c.type === wantType);
      if (!pool.length) continue;
      const best = pool.reduce((a, b) =>
        Math.abs(a.strike - p.strike) < Math.abs(b.strike - p.strike) ? a : b
      );
      map.set(`${p.symbol}|${wantType}|${p.strike}|${p.expiry}`, {
        oi: best.openInterest, volume: best.volume,
      });
    }
  });
  return map;
}

export function pickInterestKey(p: ScoutPick): string {
  const t = p.optionType === "put" || p.optionType === "put_spread" ? "put" : "call";
  return `${p.symbol}|${t}|${p.strike}|${p.expiry}`;
}

export function fmtOI(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
