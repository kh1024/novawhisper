// 200-day SMA hook — fetches ~210 daily closes from the quotes-history edge
// function and caches per-symbol for 24h. Used by the NOVA Guards engine to
// enforce the long-term trend gate on long-call picks.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SymbolSma {
  symbol: string;
  sma200: number | null;
  spot: number | null;          // last close from history (not live)
  belowSma200: boolean | null;
  source: string;
  error?: string;
}

interface HistoryResp {
  histories: { symbol: string; closes: number[]; source: string; error?: string }[];
  fetchedAt: string;
}

function computeSma(closes: number[], period: number): number | null {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

async function fetchSma200(symbols: string[]): Promise<SymbolSma[]> {
  if (symbols.length === 0) return [];
  const { data, error } = await supabase.functions.invoke("quotes-history", {
    body: { symbols, lookbackDays: 210 },
  });
  if (error) throw error;
  const resp = data as HistoryResp;
  return (resp.histories ?? []).map((h) => {
    const sma = computeSma(h.closes, 200);
    const last = h.closes.length > 0 ? h.closes[h.closes.length - 1] : null;
    return {
      symbol: h.symbol,
      sma200: sma,
      spot: last,
      belowSma200: sma != null && last != null ? last < sma : null,
      source: h.source,
      error: h.error,
    };
  });
}

/** Returns a Map<symbol → SymbolSma>. 24h cache — SMA barely moves intraday. */
export function useSma200(symbols: string[]) {
  const list = Array.from(new Set(symbols)).filter(Boolean).sort();
  const enabled = list.length > 0;
  const q = useQuery({
    queryKey: ["sma200", list.join(",")],
    queryFn: () => fetchSma200(list),
    enabled,
    staleTime: 24 * 60 * 60_000,        // 24h — SMA200 changes negligibly intraday
    gcTime: 36 * 60 * 60_000,
    retry: 2,
  });
  const map = new Map<string, SymbolSma>();
  (q.data ?? []).forEach((s) => map.set(s.symbol, s));
  return { ...q, map };
}
