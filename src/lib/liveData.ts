// Live data hooks: typed wrappers around the quotes-fetch + options-fetch edge functions.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TICKER_UNIVERSE } from "./mockData";
import { useSettings } from "./settings";

export type QuoteStatus = "verified" | "close" | "mismatch" | "stale" | "unavailable";

export interface VerifiedQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  sources: { finnhub: number | null; "alpha-vantage": number | null; massive: number | null; yahoo: number | null; stooq: number | null };
  consensusSource: "finnhub" | "alpha-vantage" | "massive" | "yahoo" | "stooq" | null;
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

/** Live verified quotes for the selected symbols. Defaults to the full universe.
 *  Refresh interval is driven by the global Settings store unless overridden. */
export function useLiveQuotes(symbols?: string[], opts?: { refetchMs?: number }) {
  const [settings] = useSettings();
  const list = symbols && symbols.length ? symbols : TICKER_UNIVERSE.map((u) => u.symbol);
  const interval = opts?.refetchMs ?? settings.refreshMs;
  return useQuery({
    queryKey: ["live-quotes", list.join(",")],
    queryFn: () => fetchQuotes(list),
    refetchInterval: interval,
    staleTime: Math.max(1_000, Math.floor(interval / 2)),
    // Never blank out — keep the last good payload visible while refetching or
    // if a provider hiccups, and auto-retry transient failures.
    placeholderData: keepPreviousData,
    retry: 3,
    retryDelay: (i) => Math.min(8_000, 1_000 * 2 ** i),
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
    placeholderData: keepPreviousData,
    retry: 3,
    retryDelay: (i) => Math.min(8_000, 1_000 * 2 ** i),
  });
}

/** Plain-English status pill: clear for non-experts. */
export function statusMeta(s: QuoteStatus) {
  switch (s) {
    case "verified": return { label: "✓ Live", cls: "pill-bullish", tip: "Live price confirmed by one or more providers." };
    case "close":    return { label: "≈ OK",   cls: "pill-neutral", tip: "Two providers within 1% — minor lag possible." };
    case "mismatch": return { label: "⚠ Check", cls: "pill-bearish", tip: "Providers disagree by 1%+. Cross-check before trading." };
    case "stale":    return { label: "↻ Last known", cls: "pill-neutral", tip: "Live providers timed out — showing the most recent price we received." };
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

async function fetchNews(params: { symbol?: string | null; category?: string; limit?: number; sources?: string[] }): Promise<NewsItem[]> {
  const { data, error } = await supabase.functions.invoke("news-fetch", { body: params });
  if (error) throw error;
  return (data?.items ?? []) as NewsItem[];
}

/** General market news (or company news when symbol provided). Optionally filter by source name. */
export function useNews(opts?: { symbol?: string | null; category?: string; limit?: number; refetchMs?: number; sources?: string[] }) {
  const symbol = opts?.symbol ?? null;
  const category = opts?.category ?? "general";
  const limit = opts?.limit ?? 12;
  const sources = opts?.sources;
  return useQuery({
    queryKey: ["news", symbol ?? "_general", category, limit, sources?.join(",") ?? ""],
    queryFn: () => fetchNews({ symbol, category, limit, sources }),
    refetchInterval: opts?.refetchMs ?? 5 * 60_000, // 5 min
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
    retry: 3,
    retryDelay: (i) => Math.min(8_000, 1_000 * 2 ** i),
  });
}
