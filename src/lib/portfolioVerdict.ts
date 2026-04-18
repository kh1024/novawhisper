import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PortfolioPosition } from "./portfolio";
import type { CrlVerdict, RiskBadge } from "./conflictResolution";

export interface VerdictMetrics {
  rsi14: number | null;
  ema8: number | null;
  sma200: number | null;
  winningStreak: number | null;
  delta: number | null;
  theta: number | null;
  iv: number | null;
  ivPercentile: number | null;
  dte: number | null;
  currentMid: number | null;
}

export interface VerdictCrl {
  verdict: CrlVerdict;
  reason: string;
  riskBadge: RiskBadge | null;
  stopLossTriggered: boolean;
  highMomentum: boolean;
  emaDistancePct: number | null;
  flags: string[];
  valuationAlert?: {
    triggered: boolean;
    intrinsicValue: number | null;
    premiumPct: number | null;
    message: string | null;
  };
  // Strategic Validation Layer
  trendGateBroken?: boolean;
  highPremium?: boolean;
  openingRange?: boolean;
  premiumStopTriggered?: boolean;
}

export interface Verdict {
  id: string;
  status: "winning" | "bleeding" | "in trouble" | "expiring worthless" | "running fine" | "neutral";
  verdict: string;
  action: "hold" | "take_profit" | "cut" | "roll" | "let_expire";
  crl?: VerdictCrl;
  metrics?: VerdictMetrics;
}

export interface VerdictResult {
  verdicts: Verdict[];
  quotes: { symbol: string; price: number; changePct: number; status: string }[];
  fetchedAt: string;
}

export function useVerdicts(positions: PortfolioPosition[]) {
  const open = positions.filter((p) => p.status === "open");
  return useQuery({
    queryKey: ["portfolio-verdict", open.map((p) => p.id).join(",")],
    enabled: open.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VerdictResult> => {
      const payload = {
        positions: open.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          optionType: p.option_type,
          direction: p.direction,
          strike: Number(p.strike),
          strikeShort: p.strike_short != null ? Number(p.strike_short) : null,
          expiry: p.expiry,
          contracts: p.contracts,
          entryPremium: p.entry_premium != null ? Number(p.entry_premium) : null,
          entryUnderlying: p.entry_underlying != null ? Number(p.entry_underlying) : null,
          thesis: p.thesis,
        })),
      };
      const { data, error } = await supabase.functions.invoke("portfolio-verdict", { body: payload });
      if (error) throw error;
      return data as VerdictResult;
    },
  });
}
