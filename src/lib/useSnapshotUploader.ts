// Hook used by Scanner / Dashboard to push today's ranked picks to the
// performance snapshot table. Throttles to once per hour per session so we
// don't spam the edge function on every component re-mount.
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SetupRow } from "@/lib/setupScore";
import type { RankResult } from "@/lib/finalRank";

const STORAGE_KEY = "nova_perf_snapshot_lastrun";
const THROTTLE_MS = 60 * 60_000; // 1h

export interface RankedPickInput {
  setup: SetupRow;
  rank: RankResult;
}

export function useSnapshotUploader(picks: RankedPickInput[] | undefined, enabled = true) {
  useEffect(() => {
    if (!enabled || !picks || picks.length === 0) return;

    // Throttle: only fire once per hour per browser to avoid hammering.
    const lastRun = Number(localStorage.getItem(STORAGE_KEY) ?? "0");
    if (Date.now() - lastRun < THROTTLE_MS) return;

    const rows = picks
      .filter((p) => p.setup.price > 0)
      .slice(0, 60)
      .map((p) => ({
        symbol: p.setup.symbol,
        label: p.rank.label,
        finalRank: p.rank.finalRank,
        setupScore: p.rank.setupScore,
        readinessScore: p.rank.readinessScore,
        optionsScore: p.rank.optionsScore,
        bias: p.setup.bias,
        entryPrice: p.setup.price,
        ivRank: p.setup.ivRank,
        relVolume: p.setup.relVolume,
        atrPct: p.setup.atrPct,
      }));

    if (rows.length === 0) return;

    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    supabase.functions
      .invoke("perf-snapshot", { body: { rows } })
      .catch((e) => {
        console.warn("[perf-snapshot] failed", e);
        // Roll back the throttle so the next attempt can retry.
        localStorage.removeItem(STORAGE_KEY);
      });
  }, [picks, enabled]);
}
