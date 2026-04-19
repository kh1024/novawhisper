// Batched next-earnings-date hook. Calls the fundamentals-fetch edge function
// per symbol in parallel (Finnhub-backed, 6h server-side cache) and returns a
// Map<symbol → earningsInDays | null>. 12h client cache because earnings
// schedules barely move intraday.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface EarningsRow {
  symbol: string;
  earningsInDays: number | null;
}

async function fetchOne(symbol: string): Promise<EarningsRow> {
  try {
    const { data, error } = await supabase.functions.invoke("fundamentals-fetch", {
      body: { symbol },
    });
    if (error) throw error;
    const d = (data?.earningsInDays ?? null) as number | null;
    return {
      symbol,
      earningsInDays: typeof d === "number" && Number.isFinite(d) ? d : null,
    };
  } catch {
    return { symbol, earningsInDays: null };
  }
}

async function fetchEarnings(symbols: string[]): Promise<EarningsRow[]> {
  if (symbols.length === 0) return [];
  // Cap concurrency at 8 to avoid hammering Finnhub when the universe is large.
  const out: EarningsRow[] = [];
  const queue = [...symbols];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(8, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const s = queue.shift();
        if (!s) break;
        out.push(await fetchOne(s));
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

/** Returns a Map<symbol → earningsInDays | null>. 12h cache. */
export function useEarnings(symbols: string[]) {
  const list = Array.from(new Set(symbols)).filter(Boolean).sort();
  const enabled = list.length > 0;
  const q = useQuery({
    queryKey: ["earnings", list.join(",")],
    queryFn: () => fetchEarnings(list),
    enabled,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
  const map = new Map<string, number | null>();
  (q.data ?? []).forEach((r) => map.set(r.symbol, r.earningsInDays));
  return { ...q, map };
}
