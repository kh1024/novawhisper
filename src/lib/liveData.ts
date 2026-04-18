// Live data hooks: typed wrappers around the quotes-fetch + options-fetch edge functions.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TICKER_UNIVERSE } from "./mockData";

export type QuoteStatus = "verified" | "close" | "mismatch" | "stale" | "unavailable";

export interface VerifiedQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  sources: { finnhub: number | null; "alpha-vantage": number | null };
  consensusSource: "finnhub" | "alpha-vantage" | null;
  status: QuoteStatus;
  diffPct: number | null;
  updatedAt: string;
  // enriched client-side
  name?: string;
  sector?: string;
  marketCap?: number;
}

export interface OptionContract {
  ticker: string;
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  underlyingPrice: number | null;
}

const META = new Map(TICKER_UNIVERSE.map((u) => [u.symbol, u]));

async function fetchQuotes(symbols: string[]): Promise<VerifiedQuote[]> {
  const { data, error } = await supabase.functions.invoke("quotes-fetch", {
    body: { symbols },
  });
  if (error) throw error;
  const list: VerifiedQuote[] = data?.quotes ?? [];
  return list.map((q) => {
    const meta = META.get(q.symbol);
    return { ...q, name: meta?.name, sector: meta?.sector, marketCap: meta?.marketCap };
  });
}

/** Live verified quotes for the selected symbols. Defaults to the full universe. */
export function useLiveQuotes(symbols?: string[], opts?: { refetchMs?: number }) {
  const list = symbols && symbols.length ? symbols : TICKER_UNIVERSE.map((u) => u.symbol);
  return useQuery({
    queryKey: ["live-quotes", list.join(",")],
    queryFn: () => fetchQuotes(list),
    refetchInterval: opts?.refetchMs ?? 60_000, // 60s default — respects free-tier limits
    staleTime: 30_000,
  });
}

async function fetchOptionsChain(underlying: string, limit = 150): Promise<{
  underlying: string;
  contracts: OptionContract[];
  fetchedAt: string;
}> {
  const { data, error } = await supabase.functions.invoke("options-fetch", {
    body: { underlying, limit },
  });
  if (error) throw error;
  return {
    underlying,
    contracts: (data?.contracts ?? []) as OptionContract[],
    fetchedAt: data?.fetchedAt ?? new Date().toISOString(),
  };
}

/** Live options chain for one underlying. Hook is disabled when underlying is empty. */
export function useOptionsChain(underlying: string | null, limit = 150) {
  return useQuery({
    queryKey: ["options-chain", underlying, limit],
    queryFn: () => fetchOptionsChain(underlying!, limit),
    enabled: !!underlying,
    refetchInterval: 90_000,
    staleTime: 60_000,
  });
}

/** Status pill color/label helper. */
export function statusMeta(s: QuoteStatus) {
  switch (s) {
    case "verified": return { label: "Verified", cls: "pill-bullish" };
    case "close": return { label: "Close", cls: "pill-neutral" };
    case "mismatch": return { label: "Mismatch", cls: "pill-bearish" };
    case "stale": return { label: "Single-src", cls: "pill-neutral" };
    case "unavailable": return { label: "No data", cls: "pill-bearish" };
  }
}
