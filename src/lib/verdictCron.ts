// Server-side verdict cron — config + log via Supabase tables.
// The cron edge function runs every 5 min during market hours and reads from
// verdict_cron_config to decide who to monitor.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerKey } from "./portfolio";

export interface VerdictCronConfig {
  enabled: boolean;
  webhookUrl: string;
  alertOnWait: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

const EMPTY: VerdictCronConfig = {
  enabled: false,
  webhookUrl: "",
  alertOnWait: false,
  lastRunAt: null,
  lastRunStatus: null,
};

export function useVerdictCronConfig() {
  const ownerKey = getOwnerKey();
  return useQuery({
    queryKey: ["verdict-cron-config", ownerKey],
    queryFn: async (): Promise<VerdictCronConfig> => {
      const { data, error } = await supabase
        .from("verdict_cron_config")
        .select("enabled, webhook_url, alert_on_wait, last_run_at, last_run_status")
        .eq("owner_key", ownerKey)
        .maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY;
      return {
        enabled: !!data.enabled,
        webhookUrl: data.webhook_url ?? "",
        alertOnWait: !!data.alert_on_wait,
        lastRunAt: data.last_run_at,
        lastRunStatus: data.last_run_status,
      };
    },
  });
}

export function useSaveVerdictCronConfig() {
  const ownerKey = getOwnerKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<VerdictCronConfig, "enabled" | "webhookUrl" | "alertOnWait">>) => {
      const row = {
        owner_key: ownerKey,
        enabled: patch.enabled ?? false,
        webhook_url: patch.webhookUrl ?? null,
        alert_on_wait: patch.alertOnWait ?? false,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("verdict_cron_config")
        .upsert(row, { onConflict: "owner_key" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["verdict-cron-config", ownerKey] }),
  });
}

export interface VerdictCronLogEntry {
  id: string;
  symbol: string;
  fromSignal: string;
  toSignal: string;
  ok: boolean;
  error: string | null;
  source: string;
  createdAt: string;
}

export function useVerdictCronLog(limit = 30) {
  const ownerKey = getOwnerKey();
  return useQuery({
    queryKey: ["verdict-cron-log", ownerKey, limit],
    queryFn: async (): Promise<VerdictCronLogEntry[]> => {
      const { data, error } = await supabase
        .from("verdict_alert_log")
        .select("id, symbol, from_signal, to_signal, ok, error, source, created_at")
        .eq("owner_key", ownerKey)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        symbol: r.symbol,
        fromSignal: r.from_signal,
        toSignal: r.to_signal,
        ok: r.ok,
        error: r.error,
        source: r.source,
        createdAt: r.created_at,
      }));
    },
    refetchInterval: 60_000,
  });
}

export async function clearVerdictCronLog(): Promise<void> {
  const ownerKey = getOwnerKey();
  await supabase.from("verdict_alert_log").delete().eq("owner_key", ownerKey);
}

/** Manually invoke the cron once — useful for "Run now" button. */
export async function runVerdictCronNow(): Promise<{ ok: boolean; summary?: unknown; error?: string }> {
  const { data, error } = await supabase.functions.invoke("verdict-cron", { body: {} });
  if (error) return { ok: false, error: error.message };
  return { ok: true, summary: data };
}
