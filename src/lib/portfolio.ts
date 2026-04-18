// Local device-scoped portfolio. Owner key is a UUID stored in localStorage —
// no login, but each browser only sees its own positions because no one else
// knows the key. Suitable for personal tracking, not multi-user accounts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const OWNER_KEY_STORAGE = "nova.portfolio.owner";

export function getOwnerKey(): string {
  let k = localStorage.getItem(OWNER_KEY_STORAGE);
  if (!k) {
    k = crypto.randomUUID();
    localStorage.setItem(OWNER_KEY_STORAGE, k);
  }
  return k;
}

export interface PortfolioPosition {
  id: string;
  owner_key: string;
  symbol: string;
  option_type: string;
  direction: string;
  strike: number;
  strike_short: number | null;
  expiry: string;
  contracts: number;
  entry_premium: number | null;
  entry_underlying: number | null;
  entry_at: string;
  thesis: string | null;
  source: string | null;
  status: "open" | "closed" | "expired";
  close_premium: number | null;
  closed_at: string | null;
  notes: string | null;
  is_paper: boolean;
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
}

export function usePortfolio() {
  const owner = getOwnerKey();
  return useQuery({
    queryKey: ["portfolio", owner],
    queryFn: async (): Promise<PortfolioPosition[]> => {
      const { data, error } = await supabase
        .from("portfolio_positions" as never)
        .select("*")
        .eq("owner_key", owner)
        .order("entry_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PortfolioPosition[];
    },
    staleTime: 30_000,
  });
}

export function useAddPosition() {
  const qc = useQueryClient();
  const owner = getOwnerKey();
  return useMutation({
    mutationFn: async (p: NewPosition) => {
      const row = {
        owner_key: owner,
        symbol: p.symbol.toUpperCase(),
        option_type: p.optionType,
        direction: p.direction,
        strike: p.strike,
        strike_short: p.strikeShort ?? null,
        expiry: p.expiry,
        contracts: p.contracts ?? 1,
        entry_premium: p.entryPremium ?? null,
        entry_underlying: p.entryUnderlying ?? null,
        thesis: p.thesis ?? null,
        source: p.source ?? null,
        is_paper: p.isPaper ?? false,
      };
      const { error } = await supabase.from("portfolio_positions" as never).insert(row as never);
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast({ title: p.isPaper ? "Saved as paper trade" : "Saved to portfolio", description: `${p.symbol} $${p.strike} ${p.optionType.toUpperCase()} · ${p.expiry}` });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, closePremium, status }: { id: string; closePremium?: number; status?: "closed" | "expired" }) => {
      const { error } = await supabase.from("portfolio_positions" as never).update({
        status: status ?? "closed",
        close_premium: closePremium ?? null,
        closed_at: new Date().toISOString(),
      } as never).eq("id", id);
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
      const { error } = await supabase.from("portfolio_positions" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}
