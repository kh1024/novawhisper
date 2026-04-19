// Persists today's Scanner snapshot. Idempotent via UNIQUE(snapshot_date, symbol).
// Called from the frontend whenever the Scanner / Dashboard loads with fresh
// rank data, so snapshots accumulate naturally without a separate cron job
// needing to re-run the full ranker server-side.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SnapshotRow {
  symbol: string;
  label: string;
  finalRank: number;
  setupScore: number;
  readinessScore: number;
  optionsScore: number;
  bias: string;
  entryPrice: number;
  ivRank?: number;
  relVolume?: number;
  atrPct?: number;
}

// Accept both new spec labels and legacy ones (older clients still in the wild).
const VALID_LABELS = new Set(["BUY NOW", "WATCHLIST", "WAIT", "AVOID", "EXIT", "BUY", "DON'T BUY"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const rowsIn = body.rows;
    if (!Array.isArray(rowsIn) || rowsIn.length === 0) {
      return new Response(JSON.stringify({ error: "rows (array) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const cleaned = (rowsIn as SnapshotRow[])
      .filter((r) =>
        r &&
        typeof r.symbol === "string" &&
        VALID_LABELS.has(r.label) &&
        Number.isFinite(r.finalRank) &&
        Number.isFinite(r.entryPrice) && r.entryPrice > 0
      )
      .slice(0, 200)
      .map((r) => ({
        snapshot_date: today,
        symbol: r.symbol.toUpperCase(),
        label: r.label,
        final_rank: Math.round(r.finalRank),
        setup_score: Math.round(r.setupScore ?? 0),
        readiness_score: Math.round(r.readinessScore ?? 0),
        options_score: Math.round(r.optionsScore ?? 0),
        bias: String(r.bias ?? "neutral"),
        entry_price: r.entryPrice,
        iv_rank: r.ivRank ?? null,
        rel_volume: r.relVolume ?? null,
        atr_pct: r.atrPct ?? null,
      }));

    if (cleaned.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, skipped: rowsIn.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error } = await supabase
      .from("pick_snapshots")
      .upsert(cleaned, { onConflict: "snapshot_date,symbol", ignoreDuplicates: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ inserted: cleaned.length, date: today }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
