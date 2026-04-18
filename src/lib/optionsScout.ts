// Hook for the Options Scout edge function — Firecrawl-scraped picks bucketed by risk.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ScoutPick {
  symbol: string;
  strategy: string;
  thesis: string;
  entry: string;
  risk: string;
  source: string;
}

export interface ScoutResult {
  marketRead: string;
  safe: ScoutPick[];
  mild: ScoutPick[];
  aggressive: ScoutPick[];
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
      return data as ScoutResult;
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
