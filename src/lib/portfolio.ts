// Account-scoped portfolio + exit-guidance hooks.
// Owner key is the authenticated user's id; rows are gated by RLS.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { getOwnerKeySync } from "@/lib/ownerKey";
import type { ExitRecommendation } from "@/lib/exitGuidance";

export function getOwnerKey(): string {
  return getOwnerKeySync() ?? "";
}

export interface PortfolioPosition {
  id: string;
  owner_key: string;
  symbol: string;
  option_symbol: string | null;
  option_type: string;       // 'call' | 'put' (legacy lowercase)
  direction: string;         // 'long' | 'short'
  strike: number;
  strike_short: number | null;
  expiry: string;
  contracts: number;
  entry_premium: number | null;
  entry_underlying: number | null;
  entry_at: string;
  entry_cost_total: number | null;
  thesis: string | null;
  entry_thesis: string | null;
  initial_score: number | null;
  initial_gates: Record<string, unknown> | null;
  risk_bucket: string | null;
  source: string | null;
  status: "open" | "closed" | "expired" | "cancelled";
  close_premium: number | null;
  closed_at: string | null;
  notes: string | null;
  is_paper: boolean;
  // Exit guidance
  hard_stop_pct: number;
  target_1_pct: number;
  target_2_pct: number;
  max_hold_days: number | null;
  current_price: number | null;
  current_profit_pct: number | null;
  exit_recommendation: ExitRecommendation;
  exit_reason: string | null;
  exit_price: number | null;
  exit_time: string | null;
  realized_pnl: number | null;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewPosition {
  symbol: string;
  optionType: string;
  direction: string;
  strike: number;
  strikeShort?: number | null;
  expiry: string;
  contracts?: number;
  entryPremium?: number | null;
  entryUnderlying?: number | null;
  thesis?: string | null;
  source?: string | null;
  isPaper?: boolean;
  // Exit guidance overrides
  hardStopPct?: number;
  target1Pct?: number;
  target2Pct?: number;
  maxHoldDays?: number | null;
  riskBucket?: string | null;
  initialScore?: number | null;
  initialGates?: Record<string, unknown> | null;
  optionSymbol?: string | null;
}

export function usePortfolio() {
  const owner = getOwnerKey();
  return useQuery({
    queryKey: ["portfolio", owner],
    queryFn: async (): Promise<PortfolioPosition[]> => {
      const { data, error } = await supabase
        .from("portfolio_positions")
        .select("*")
        .eq("owner_key", owner)
        .order("entry_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PortfolioPosition[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Count of OPEN positions — used by the sidebar badge. */
export function useOpenPortfolioCount(): number {
  const { data } = usePortfolio();
  return (data ?? []).filter((p) => p.status === "open").length;
}

/** "Is this exact contract already open in the user's portfolio?" — used by
 *  AddToPortfolioButton to swap into a "View in Portfolio" link. */
export function useIsHeld(
  symbol: string,
  optionType: string,
  strike: number,
  expiry: string,
): { held: boolean; id: string | null } {
  const { data } = usePortfolio();
  if (!symbol) return { held: false, id: null };
  const sym = symbol.toUpperCase();
  const ot = optionType.toLowerCase();
  const match = (data ?? []).find(
    (p) =>
      p.status === "open" &&
      p.symbol.toUpperCase() === sym &&
      p.option_type.toLowerCase() === ot &&
      Number(p.strike) === Number(strike) &&
      p.expiry === expiry,
  );
  return { held: !!match, id: match?.id ?? null };
}

export function useAddPosition() {
  const qc = useQueryClient();
  const owner = getOwnerKey();
  return useMutation({
    mutationFn: async (p: NewPosition) => {
      const contracts = p.contracts ?? 1;
      const entry_cost_total = p.entryPremium != null
        ? Number(p.entryPremium) * 100 * contracts
        : null;
      const row = {
        owner_key: owner,
        symbol: p.symbol.toUpperCase(),
        option_symbol: p.optionSymbol ?? null,
        option_type: p.optionType,
        direction: p.direction,
        strike: p.strike,
        strike_short: p.strikeShort ?? null,
        expiry: p.expiry,
        contracts,
        entry_premium: p.entryPremium ?? null,
        entry_underlying: p.entryUnderlying ?? null,
        entry_cost_total,
        thesis: p.thesis ?? null,
        entry_thesis: p.thesis ?? null,
        initial_score: p.initialScore ?? null,
        initial_gates: (p.initialGates ?? null) as never,
        risk_bucket: p.riskBucket ?? null,
        source: p.source ?? null,
        is_paper: p.isPaper ?? false,
        hard_stop_pct: p.hardStopPct ?? -30,
        target_1_pct: p.target1Pct ?? 50,
        target_2_pct: p.target2Pct ?? 100,
        max_hold_days: p.maxHoldDays ?? null,
      };
      const { error } = await supabase.from("portfolio_positions").insert(row as never);
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast({
        title: p.isPaper ? "Saved as paper trade" : "Added to Portfolio",
        description: `${p.symbol} $${p.strike} ${p.optionType.toUpperCase()} · ${p.expiry} — exit guidance will track this position.`,
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
}

export interface UpdateTargetsInput {
  id: string;
  hard_stop_pct?: number;
  target_1_pct?: number;
  target_2_pct?: number;
  max_hold_days?: number | null;
  notes?: string | null;
}

export function useUpdatePositionTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: UpdateTargetsInput) => {
      const { id, ...patch } = p;
      const { error } = await supabase
        .from("portfolio_positions")
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, closePremium, status, contracts, entryPremium, direction,
    }: {
      id: string;
      closePremium?: number;
      status?: "closed" | "expired" | "cancelled";
      contracts: number;
      entryPremium: number | null;
      direction: string;
    }) => {
      const realized = (closePremium != null && entryPremium != null)
        ? (direction === "long" ? 1 : -1) * (closePremium - entryPremium) * 100 * contracts
        : null;
      const { error } = await supabase
        .from("portfolio_positions")
        .update({
          status: status ?? "closed",
          close_premium: closePremium ?? null,
          exit_price: closePremium ?? null,
          closed_at: new Date().toISOString(),
          exit_time: new Date().toISOString(),
          realized_pnl: realized,
        } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
    onError: (e: Error) => toast({ title: "Couldn't close position", description: e.message, variant: "destructive" }),
  });
}

export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_positions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}
