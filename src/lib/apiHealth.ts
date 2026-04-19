// Pings the edge functions to report data-source health on the Settings page.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
// Importing this module installs the one-time invoke instrumentation that
// powers the rolling 60s request counter shown next to each source.
import { getCount60s, subscribe } from "@/lib/requestRate";

export interface SourceHealth {
  name: string;
  description: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  detail: string;
  /** Edge-function names that contribute to this row's request count. */
  functions: string[];
}

/**
 * Live rolling-60s request count across one or more edge functions.
 * Re-renders whenever any tracked invoke fires, plus a 1s safety tick so the
 * number ages out even when the app goes quiet.
 */
export function useRequestRate60s(fns: string[]): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const unsub = subscribe(bump);
    const id = window.setInterval(bump, 1000);
    return () => { unsub(); window.clearInterval(id); };
  }, []);
  return fns.reduce((sum, fn) => sum + getCount60s(fn), 0);
}

async function ping(fn: string, body: Record<string, unknown>): Promise<{ ms: number; ok: boolean; detail: string }> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    const ms = Math.round(performance.now() - t0);
    if (error) return { ms, ok: false, detail: error.message };
    if ((data as { ok?: boolean; degraded?: boolean })?.ok === false) {
      return {
        ms,
        ok: false,
        detail: (data as { error?: string; detail?: string }).detail || (data as { error?: string }).error || "upstream degraded",
      };
    }
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
      // Massive powers both quotes-fetch and options-fetch under the hood.
      // We ping options-fetch as the Massive health proxy (it's the heaviest
      // Massive call) and reuse the quotes-fetch ping for the consensus row.
      const [quotes, options, news] = await Promise.all([
        ping("quotes-fetch", { symbols: ["SPY"] }),
        ping("options-fetch", { underlying: "SPY", limit: 5 }),
        ping("news-fetch",   { category: "general", limit: 3 }),
      ]);
      const toStatus = (r: { ok: boolean; ms: number }) =>
        !r.ok ? "down" : r.ms > 4000 ? "degraded" : "ok";
      return [
        { name: "Quotes (Finnhub + Alpha Vantage + Massive)", description: "Live verified prices — freshest-timestamp wins", status: toStatus(quotes),  latencyMs: quotes.ms,  detail: quotes.detail, functions: ["quotes-fetch"] },
        { name: "Massive (Options + Quotes backbone)",        description: "Throttled to 75 req/s/instance to stay under plan limits", status: toStatus(options), latencyMs: options.ms, detail: options.detail, functions: ["quotes-fetch", "options-fetch"] },
        { name: "Market News (Finnhub)",                      description: "Sentiment + headlines feed",                     status: toStatus(news),    latencyMs: news.ms,    detail: news.detail,    functions: ["news-fetch"] },
        { name: "Lovable AI Gateway",                         description: "Nova explanations",                              status: "ok",              latencyMs: null,       detail: "Routed via gateway — no key needed", functions: ["nova-chat", "ask-nova"] },
      ];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
