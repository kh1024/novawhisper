// Live data hooks: typed wrappers around the quotes-fetch + options-fetch edge functions.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TICKER_UNIVERSE, getMockQuotes } from "./mockData";
import { useSettings } from "./settings";

export type QuoteStatus = "verified" | "close" | "mismatch" | "stale" | "unavailable";
export type Session = "pre" | "regular" | "post" | "closed";

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
  // Extended hours
  session?: Session;
  preMarketPrice?: number | null;
  preMarketChangePct?: number | null;
  postMarketPrice?: number | null;
  postMarketChangePct?: number | null;
  /** Pre/post price for the *current* extended session (null in regular/closed). */
  extendedPrice?: number | null;
  extendedChangePct?: number | null;
  // enriched client-side
  name?: string;
  sector?: string;
  marketCap?: number;
}

/**
 * Returns the current US-equity session in the user's clock. Used to choose
 * the right refresh cadence and badge label without waiting for the server.
 */
export function currentSessionET(): Session {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (wd === "Sat" || wd === "Sun") return "closed";
  const minutes = hh * 60 + mm;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "post";
  return "closed";
}

export function sessionLabel(s: Session | undefined): { short: string; long: string } | null {
  if (s === "pre") return { short: "PRE", long: "Pre-market" };
  if (s === "post") return { short: "AH", long: "After hours" };
  return null;
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
  /** Optional 52-week IV range — populated when the upstream provider exposes it. */
  iv52wLow?: number | null;
  iv52wHigh?: number | null;
}

const META = new Map(TICKER_UNIVERSE.map((u) => [u.symbol, u]));
const MOCK = new Map(getMockQuotes().map((q) => [q.symbol, q]));

function withMeta(q: VerifiedQuote): VerifiedQuote {
  const meta = META.get(q.symbol);
  return { ...q, name: meta?.name, sector: meta?.sector, marketCap: meta?.marketCap };
}

// IMPORTANT: do **not** fall back to MOCK prices here. Mock seeds are
// hardcoded snapshots (e.g. GLD $242.60) that quickly drift out of date —
// rendering them with a "Last known" badge made it look like real live data.
// When live providers fail, surface "No data" so the UI shows an honest empty
// state instead of a misleading stale price. React-query already preserves the
// previous good payload via `keepPreviousData` for transient hiccups.
function fallbackQuote(symbol: string, base?: Partial<VerifiedQuote>): VerifiedQuote {
  return withMeta({
    symbol,
    price: 0,
    change: 0,
    changePct: 0,
    volume: 0,
    sources: base?.sources ?? { finnhub: null, "alpha-vantage": null, massive: null, yahoo: null, stooq: null },
    consensusSource: base?.consensusSource ?? null,
    status: "unavailable",
    diffPct: base?.diffPct ?? null,
    updatedAt: base?.updatedAt ?? new Date().toISOString(),
  });
}

async function fetchQuotes(symbols: string[]): Promise<VerifiedQuote[]> {
  const { data, error } = await supabase.functions.invoke("quotes-fetch", {
    body: { symbols },
  });
  if (error) {
    return symbols.map((symbol) => fallbackQuote(symbol));
  }

  const list: VerifiedQuote[] = data?.quotes ?? [];
  const bySymbol = new Map(list.map((q) => [q.symbol, q]));

  return symbols.map((symbol) => {
    const live = bySymbol.get(symbol);
    if (!live || live.status === "unavailable" || !Number.isFinite(live.price) || live.price <= 0) {
      return fallbackQuote(symbol, live);
    }
    return withMeta(live);
  });
}

/** Live verified quotes for the selected symbols. Defaults to the full universe.
 *  Refresh interval is driven by the global Settings store unless overridden.
 *  During pre-market / after-hours we throttle to 2 minutes since liquidity is
 *  thinner and prices move less — saves API budget without missing real moves. */
export function useLiveQuotes(symbols?: string[], opts?: { refetchMs?: number }) {
  const [settings] = useSettings();
  const universe = useMemo(
    () => Array.from(new Set([...TICKER_UNIVERSE.map((u) => u.symbol), ...(settings.customTickers ?? [])])),
    [settings.customTickers],
  );
  const list = symbols && symbols.length ? symbols : universe;
  const session = currentSessionET();
  const baseInterval = opts?.refetchMs ?? settings.refreshMs;
  const interval = (session === "pre" || session === "post")
    ? Math.max(baseInterval, 120_000)   // 2-min floor in extended hours
    : baseInterval;
  return useQuery({
    queryKey: ["live-quotes", list.join(","), session],
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
