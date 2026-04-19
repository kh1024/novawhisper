// Hooks for the new free data sources: Yahoo fundamentals + SEC EDGAR insiders.
// Both edge functions are public (no auth) and cache server-side, so React Query
// is just a thin client cache.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Fundamentals {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  employees: number | null;
  website: string | null;
  summary: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  floatShares: number | null;
  peTrailing: number | null;
  peForward: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  dividendYield: number | null;
  dividendRate: number | null;
  payoutRatio: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVolume: number | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  recommendationKey: string | null;
  numberOfAnalystOpinions: number | null;
  fetchedAt: string;
  source: string;
}

export function useFundamentals(symbol: string | null) {
  return useQuery({
    queryKey: ["fundamentals", symbol],
    enabled: !!symbol,
    staleTime: 60 * 60_000, // 1h client cache
    gcTime: 6 * 60 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Fundamentals> => {
      const { data, error } = await supabase.functions.invoke("fundamentals-fetch", {
        body: { symbol },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as Fundamentals;
    },
  });
}

export interface InsiderFiling {
  accessionNumber: string;
  form: string;
  filedAt: string;
  reportingDate: string | null;
  primaryDocument: string;
  url: string;
  description: string;
}

export interface InsiderResponse {
  symbol: string;
  cik: string | null;
  name: string | null;
  count: number;
  filings: InsiderFiling[];
  fetchedAt?: string;
}

export function useInsiderFilings(symbol: string | null, limit = 10) {
  return useQuery({
    queryKey: ["insiders", symbol, limit],
    enabled: !!symbol,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async (): Promise<InsiderResponse> => {
      const { data, error } = await supabase.functions.invoke("edgar-insiders", {
        body: { symbol, limit },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as InsiderResponse;
    },
  });
}

// ── formatters ───────────────────────────────────────────────────────────
export function fmtBig(n: number | null): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

export function fmtPct(n: number | null, alreadyPct = false): string {
  if (n == null || !isFinite(n)) return "—";
  const pct = alreadyPct ? n : n * 100;
  return `${pct.toFixed(2)}%`;
}

export function fmtNum(n: number | null, digits = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(digits);
}
