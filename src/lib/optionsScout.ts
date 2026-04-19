// Hook for the Options Scout edge function — Firecrawl-scraped picks bucketed by risk.
// NOVA brain returns 4 buckets (safe/moderate/aggressive/swing) plus regime + time-state.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NovaGrade = "A" | "B" | "C";
export type NovaRegime = "bull" | "bear" | "sideways" | "panic" | "meltup";

export interface ScoutPick {
  symbol: string;
  strategy: string;
  optionType: "call" | "put" | "call_spread" | "put_spread" | "straddle" | "strangle" | "iron_condor";
  direction: "long" | "short";
  strike: number;
  strikeShort?: number;
  expiry: string;
  playAt: number;
  premiumEstimate?: string;
  thesis: string;
  risk: string;
  bestEntry?: string;
  bestExit?: string;
  grade?: NovaGrade;
  gradeRationale?: string;
  source: string;
}

export interface ScoutResult {
  marketRead: string;
  regime: NovaRegime;
  timeState: string;
  bestStrategyNow: string;
  avoidRightNow: string;
  safe: ScoutPick[];
  moderate: ScoutPick[];
  aggressive: ScoutPick[];
  swing: ScoutPick[];
  /** Deprecated alias kept for any UI still reading `mild`. */
  mild?: ScoutPick[];
  sources: { name: string; url: string }[];
  fetchedAt: string;
}

export function useOptionsScout(enabled = true) {
  return useQuery({
    queryKey: ["options-scout"],
    enabled,
    queryFn: async (): Promise<ScoutResult> => {
      const { data, error } = await supabase.functions.invoke("options-scout", { body: {} });
      if (error) throw error;
      const r = data as ScoutResult;
      // Back-compat: mirror moderate → mild for any legacy consumer.
      return { ...r, mild: r.moderate ?? [] };
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
