// Hook for past Web Picks runs persisted in the database.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HistoryPick {
  id: string;
  run_id: string;
  tier: "safe" | "mild" | "aggressive";
  symbol: string;
  strategy: string;
  option_type: string;
  direction: string;
  strike: number;
  strike_short: number | null;
  expiry: string;
  play_at: number;
  premium_estimate: string | null;
  thesis: string;
  risk: string;
  source: string;
  entry_price: number | null;
  current_price: number | null;
  pnl_pct: number | null;
  outcome: string | null;
  evaluated_at: string | null;
  created_at: string;
  // New rich-signal columns (added 2026-04). Optional for back-compat with
  // historical rows that pre-date the schema bump.
  bias: "bullish" | "bearish" | "neutral" | null;
  expected_return: string | null;
  probability: string | null;
  risk_level: "low" | "medium" | "high" | null;
  grade: "A" | "B" | "C" | null;
  grade_rationale: string | null;
}

export interface HistoryRun {
  id: string;
  market_read: string | null;
  source_count: number;
  pick_count: number;
  fetched_at: string;
  picks: HistoryPick[];
}

export function useWebPicksHistory(limit = 10) {
  return useQuery({
    queryKey: ["web-picks-history", limit],
    queryFn: async (): Promise<HistoryRun[]> => {
      const { data: runs, error } = await supabase
        .from("web_picks_runs" as never)
        .select("id, market_read, source_count, pick_count, fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const runList = (runs ?? []) as unknown as Omit<HistoryRun, "picks">[];
      if (runList.length === 0) return [];
      const ids = runList.map((r) => r.id);
      const { data: picks, error: pErr } = await supabase
        .from("web_picks" as never)
        .select("*")
        .in("run_id", ids);
      if (pErr) throw pErr;
      const pickList = (picks ?? []) as unknown as HistoryPick[];
      return runList.map((r) => ({ ...r, picks: pickList.filter((p) => p.run_id === r.id) }));
    },
    staleTime: 60_000,
  });
}
