// Hook for the Options Scout edge function — Firecrawl-scraped picks bucketed by risk.
// NOVA brain returns 4 buckets (safe/moderate/aggressive/swing) plus regime + time-state.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NovaGrade = "A" | "B" | "C";
export type NovaRegime = "bull" | "bear" | "sideways" | "panic" | "meltup";

export interface ScoutPick {
  symbol: string;
  strategy: string;
  /** Calls or puts only — multi-leg structures were retired across the app. */
  optionType: "call" | "put";
  direction: "long" | "short";
  strike: number;
  /** Kept on the type for back-compat with persisted/legacy rows; always undefined for new picks. */
  strikeShort?: number;
  expiry: string;
  playAt: number;
  premiumEstimate?: string;
  bias?: "bullish" | "bearish" | "neutral";
  expectedReturn?: string;
  probability?: string;
  riskLevel?: "low" | "medium" | "high";
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

// Single-leg only filter — drop any legacy spread/condor/straddle rows that
// might still come back from cached/persisted runs.
function isVanilla(p: ScoutPick): boolean {
  return p.optionType === "call" || p.optionType === "put";
}

export function useOptionsScout(enabled = true) {
  return useQuery({
    queryKey: ["options-scout"],
    enabled,
    queryFn: async (): Promise<ScoutResult> => {
      const { data, error } = await supabase.functions.invoke("options-scout", { body: {} });
      if (error) throw error;
      const r = data as ScoutResult;
      const filt = (arr?: ScoutPick[]) => (arr ?? []).filter(isVanilla);
      const cleaned: ScoutResult = {
        ...r,
        safe: filt(r.safe),
        moderate: filt(r.moderate),
        aggressive: filt(r.aggressive),
        swing: filt(r.swing),
      };
      // Back-compat: mirror moderate → mild for any legacy consumer.
      return { ...cleaned, mild: cleaned.moderate ?? [] };
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
