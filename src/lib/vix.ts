// VIX feed + 52-week IV Rank from iv_history.
//
// VIX comes from the existing live-quote pipeline using the Yahoo-friendly
// `^VIX` ticker. IV Rank is computed per symbol from `iv_history` rows
// (need ≥ 60 samples to be considered "real"; otherwise we fall back to the
// chain-derived IVP supplied by the caller).
import { useQuery } from "@tanstack/react-query";
import { useLiveQuotes } from "@/lib/liveData";
import { supabase } from "@/integrations/supabase/client";

/** Hook: returns the latest absolute VIX level (defaults to 15 while loading). */
export function useVix(): { vix: number; isLoading: boolean } {
  const { data: quotes = [], isLoading } = useLiveQuotes(["^VIX"], { refetchMs: 60_000 });
  const q = quotes.find((x) => x.symbol.toUpperCase() === "^VIX");
  return {
    vix: q?.price && Number.isFinite(q.price) && q.price > 0 ? q.price : 15,
    isLoading,
  };
}

/**
 * Compute true 52-week IV Rank from iv_history for a single symbol.
 * Returns null when fewer than 60 samples are available (caller falls back).
 */
async function fetchIvRank(symbol: string): Promise<number | null> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("iv_history")
    .select("iv,as_of")
    .eq("symbol", symbol.toUpperCase())
    .gte("as_of", since)
    .order("as_of", { ascending: true });
  if (error || !data || data.length < 60) return null;
  const ivs = data
    .map((r) => Number((r as { iv: number }).iv))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (ivs.length < 60) return null;
  const min = Math.min(...ivs);
  const max = Math.max(...ivs);
  if (max - min < 1e-9) return 50;
  const current = ivs[ivs.length - 1];
  const rank = ((current - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, rank));
}

/** Hook: per-symbol IV Rank map. Symbols with too little history return null. */
export function useIvRank(symbols: string[]): {
  map: Map<string, number | null>;
  isLoading: boolean;
} {
  const symbolKey = symbols.map((s) => s.toUpperCase()).sort().join(",");
  const { data, isLoading } = useQuery({
    queryKey: ["iv-rank", symbolKey],
    queryFn: async () => {
      const out = new Map<string, number | null>();
      await Promise.all(
        symbols.map(async (s) => {
          out.set(s.toUpperCase(), await fetchIvRank(s));
        }),
      );
      return out;
    },
    staleTime: 60 * 60_000,
    enabled: symbols.length > 0,
  });
  return { map: data ?? new Map(), isLoading };
}
