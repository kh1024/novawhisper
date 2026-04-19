// Personal watchlist — same owner_key pattern as portfolio. Lets the user
// bookmark any pick across the site (Scanner, Dashboard, Market, Strategy,
// Planning, Research drawer) and review it on the Dashboard with a live
// verdict chip (Buy now / Wait / Avoid / Exit).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { getOwnerKey } from "./portfolio";

export interface WatchlistItem {
  id: string;
  owner_key: string;
  symbol: string;
  direction: string;
  option_type: string;
  strike: number | null;
  strike_short: number | null;
  expiry: string | null;
  bias: string | null;
  strategy: string | null;
  tier: string | null;
  risk: string | null;
  probability: string | null;
  entry_price: number | null;
  premium_estimate: string | null;
  thesis: string | null;
  source: string | null;
  meta: Record<string, unknown>;
  last_signal: string | null;
  last_signal_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewWatchlistItem {
  symbol: string;
  direction: string;
  optionType: string;
  strike?: number | null;
  strikeShort?: number | null;
  expiry?: string | null;
  bias?: string | null;
  strategy?: string | null;
  tier?: string | null;
  risk?: string | null;
  probability?: string | null;
  entryPrice?: number | null;
  premiumEstimate?: string | null;
  thesis?: string | null;
  source?: string | null;
  meta?: Record<string, unknown>;
}

export function useWatchlist() {
  const owner = getOwnerKey();
  return useQuery({
    queryKey: ["watchlist", owner],
    queryFn: async (): Promise<WatchlistItem[]> => {
      const { data, error } = await supabase
        .from("watchlist_items" as never)
        .select("*")
        .eq("owner_key", owner)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as WatchlistItem[];
    },
    staleTime: 30_000,
  });
}

/** Identity used to dedupe a pick — same symbol/strike/expiry/type counts as one. */
export function watchlistKeyOf(p: NewWatchlistItem | WatchlistItem): string {
  const sym = "symbol" in p ? p.symbol : "";
  const ot = "option_type" in p ? p.option_type : (p as NewWatchlistItem).optionType;
  const dir = p.direction;
  const strike = "strike" in p ? p.strike : null;
  const expiry = p.expiry ?? "";
  return [sym?.toUpperCase(), ot, dir, strike ?? "", expiry].join("|");
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  const owner = getOwnerKey();
  return useMutation({
    mutationFn: async (p: NewWatchlistItem) => {
      const row = {
        owner_key: owner,
        symbol: p.symbol.toUpperCase(),
        direction: p.direction,
        option_type: p.optionType,
        strike: p.strike ?? null,
        strike_short: p.strikeShort ?? null,
        expiry: p.expiry ?? null,
        bias: p.bias ?? null,
        strategy: p.strategy ?? null,
        tier: p.tier ?? null,
        risk: p.risk ?? null,
        probability: p.probability ?? null,
        entry_price: p.entryPrice ?? null,
        premium_estimate: p.premiumEstimate ?? null,
        thesis: p.thesis ?? null,
        source: p.source ?? null,
        meta: (p.meta ?? {}) as never,
      };
      const { error } = await supabase.from("watchlist_items" as never).insert(row as never);
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      toast({
        title: "Added to watchlist",
        description: `${p.symbol}${p.strike ? ` $${p.strike}` : ""} ${p.optionType.toUpperCase()}${p.expiry ? ` · ${p.expiry}` : ""}`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't add to watchlist", description: e.message, variant: "destructive" }),
  });
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("watchlist_items" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });
}
