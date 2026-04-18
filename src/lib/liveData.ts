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
  // Refresh every 5 seconds for near-real-time updates.
  const defaultMs = 5_000;
  return useQuery({
    queryKey: ["live-quotes", list.join(",")],
    queryFn: () => fetchQuotes(list),
    refetchInterval: opts?.refetchMs ?? defaultMs,
    staleTime: 2_000,
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

/** Plain-English status pill: clear for non-experts. */
export function statusMeta(s: QuoteStatus) {
  switch (s) {
    case "verified": return { label: "✓ Good", cls: "pill-bullish", tip: "Two providers agree within 0.25% — high confidence." };
    case "close":    return { label: "≈ OK",   cls: "pill-neutral", tip: "Two providers within 1% — minor lag possible." };
    case "mismatch": return { label: "⚠ Check", cls: "pill-bearish", tip: "Providers disagree by 1%+. Cross-check before trading." };
    case "stale":    return { label: "1 source", cls: "pill-neutral", tip: "Only one provider responded. May be slightly delayed." };
    case "unavailable": return { label: "No data", cls: "pill-bearish", tip: "No providers returned a quote for this symbol." };
  }
}

// ──────────── News ────────────

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  publishedAt: string;
  related: string;
  category: string;
}

async function fetchNews(params: { symbol?: string | null; category?: string; limit?: number }): Promise<NewsItem[]> {
  const { data, error } = await supabase.functions.invoke("news-fetch", { body: params });
  if (error) throw error;
  return (data?.items ?? []) as NewsItem[];
}

/** General market news (or company news when symbol provided). */
export function useNews(opts?: { symbol?: string | null; category?: string; limit?: number; refetchMs?: number }) {
  const symbol = opts?.symbol ?? null;
  const category = opts?.category ?? "general";
  const limit = opts?.limit ?? 12;
  return useQuery({
    queryKey: ["news", symbol ?? "_general", category, limit],
    queryFn: () => fetchNews({ symbol, category, limit }),
    refetchInterval: opts?.refetchMs ?? 5 * 60_000, // 5 min
    staleTime: 2 * 60_000,
  });
}
