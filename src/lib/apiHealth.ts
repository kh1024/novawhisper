// Pings the edge functions to report data-source health on the Settings page.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SourceHealth {
  name: string;
  description: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail: string;
}

async function ping(fn: string, body: Record<string, unknown>): Promise<{ ms: number; ok: boolean; detail: string }> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    const ms = Math.round(performance.now() - t0);
    if (error) return { ms, ok: false, detail: error.message };
    const count =
      (data as { quotes?: unknown[]; contracts?: unknown[]; items?: unknown[] })?.quotes?.length ??
      (data as { contracts?: unknown[] })?.contracts?.length ??
      (data as { items?: unknown[] })?.items?.length ?? 0;
    return { ms, ok: true, detail: `${count} records` };
  } catch (e) {
    return { ms: Math.round(performance.now() - t0), ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

export function useApiHealth() {
  return useQuery({
    queryKey: ["api-health"],
    queryFn: async (): Promise<SourceHealth[]> => {
      const [quotes, options, news] = await Promise.all([
        ping("quotes-fetch", { symbols: ["SPY"] }),
        ping("options-fetch", { underlying: "SPY", limit: 5 }),
        ping("news-fetch",   { category: "general", limit: 3 }),
      ]);
      const toStatus = (r: { ok: boolean; ms: number }) =>
        !r.ok ? "down" : r.ms > 4000 ? "degraded" : "ok";
      return [
        { name: "Quotes (Finnhub + Alpha Vantage)", description: "Live verified prices",       status: toStatus(quotes),  latencyMs: quotes.ms,  detail: quotes.detail },
        { name: "Options Chain (Polygon)",          description: "Real options + Greeks",      status: toStatus(options), latencyMs: options.ms, detail: options.detail },
        { name: "Market News (Finnhub)",            description: "Sentiment + headlines feed", status: toStatus(news),    latencyMs: news.ms,    detail: news.detail },
        { name: "Lovable AI Gateway",               description: "Nova explanations",          status: "ok",              latencyMs: null,       detail: "Routed via gateway — no key needed" },
      ];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
