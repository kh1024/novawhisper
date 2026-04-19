// Hook for the Options Scout edge function — Firecrawl-scraped picks bucketed
// by risk per the BUY-PREMIUM-ONLY institutional spec.
//
// NOVA brain returns 4 buckets:
//   conservative / moderate / aggressive / lottery
// plus regime, time-state, and a final summary block.
//
// Back-compat: this hook also mirrors the new buckets onto the legacy keys
// `safe` / `mild` / `swing` so existing surfaces (Planning.tsx etc.) keep
// working without a sweeping rename.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NovaGrade = "A" | "B" | "C";
export type NovaRegime = "bull" | "bear" | "sideways" | "panic" | "meltup" | "defensive";

export interface ScoutPick {
  symbol: string;
  /** "Long Call" | "Long Put" | "LEAPS Call" | "LEAPS Put" | "Call Debit Spread" | "Put Debit Spread" */
  strategy: string;
  /** Calls or puts only — short premium is forbidden in this app. */
  optionType: "call" | "put";
  /** Always "long" — the buy-premium-only spec means we never short premium. */
  direction: "long";
  strike: number;
  /** Set ONLY for debit spreads (short leg). undefined for naked longs / LEAPS. */
  strikeShort?: number;
  expiry: string;
  playAt: number;
  premiumEstimate?: string;
  bias?: "bullish" | "bearish" | "neutral";
  expectedReturn?: string;
  probability?: string;
  riskLevel?: "low" | "medium" | "high";
  liquidityRating?: number;
  confidenceScore?: number;
  riskScore?: number;
  thesis: string;
  risk: string;
  bestEntry?: string;
  bestExit?: string;
  whyStrike?: string;
  whyExpiration?: string;
  whyNow?: string;
  profitTarget1?: string;
  profitTarget2?: string;
  stopLoss?: string;
  timeExit?: string;
  invalidationLevel?: string;
  betterThanAlternative?: string;
  avoidIf?: string;
  grade?: NovaGrade;
  gradeRationale?: string;
  source: string;
}

export interface ScoutSummary {
  bestOverallTrade: string;
  safestTrade: string;
  highestUpsideTrade: string;
  bestLeapsTrade: string;
  bestLotteryPick: string;
  stayInCash: string;
}

export interface ScoutResult {
  marketRead: string;
  regime: NovaRegime;
  timeState: string;
  bestStrategyNow: string;
  avoidRightNow: string;
  /** New canonical buckets per institutional spec. */
  conservative: ScoutPick[];
  moderate: ScoutPick[];
  aggressive: ScoutPick[];
  lottery: ScoutPick[];
  /** Final summary block. */
  summary?: ScoutSummary;
  // ── Back-compat aliases (mirrored from the new buckets) ──
  /** Alias for conservative. */
  safe?: ScoutPick[];
  /** Alias for moderate. */
  mild?: ScoutPick[];
  /** Alias for lottery (the previous spec called this "swing"). */
  swing?: ScoutPick[];
  sources: { name: string; url: string }[];
  fetchedAt: string;
}

// Whitelist guard — only the 6 allowed buy-premium strategies pass through.
const ALLOWED_STRATEGIES = [
  "long call", "long put", "leaps call", "leaps put",
  "call debit spread", "put debit spread",
];
function isAllowed(p: ScoutPick): boolean {
  if (!p) return false;
  if (p.optionType !== "call" && p.optionType !== "put") return false;
  if (p.direction !== "long") return false;
  const strat = String(p.strategy ?? "").toLowerCase();
  return ALLOWED_STRATEGIES.some((a) => strat.includes(a));
}

export function useOptionsScout(enabled = true) {
  return useQuery({
    queryKey: ["options-scout"],
    enabled,
    queryFn: async (): Promise<ScoutResult> => {
      const { data, error } = await supabase.functions.invoke("options-scout", { body: {} });
      if (error) throw error;
      const r = data as ScoutResult;
      const filt = (arr?: ScoutPick[]) => (arr ?? []).filter(isAllowed);
      // Edge function already mirrors aliases, but recompute defensively in case
      // an older deploy returns only the legacy field names.
      const conservative = filt(r.conservative ?? r.safe);
      const moderate = filt(r.moderate ?? r.mild);
      const aggressive = filt(r.aggressive);
      const lottery = filt(r.lottery ?? r.swing);
      return {
        ...r,
        conservative,
        moderate,
        aggressive,
        lottery,
        // Mirror onto legacy keys so Planning.tsx etc. keep working.
        safe: conservative,
        mild: moderate,
        swing: lottery,
      };
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });
}
