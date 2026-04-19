// Reads the last 90 days of outcomes, computes per-label hit rate + avg
// return, and writes a small multiplier (clamped to 0.85–1.15) into
// learning_weights. The ranker reads this and gently nudges its labels so
// the AI improves itself based on real-world results.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LABELS = ["BUY", "WATCHLIST", "WAIT", "DON'T BUY"] as const;
const PRIMARY_WINDOW = 5; // 5d return is our headline signal

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);

    const { data: snapshots, error: snapErr } = await supabase
      .from("pick_snapshots")
      .select("id,label")
      .gte("snapshot_date", cutoff.toISOString().slice(0, 10))
      .limit(5000);
    if (snapErr) throw snapErr;
    if (!snapshots || snapshots.length === 0) {
      return new Response(JSON.stringify({ message: "no snapshots yet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = snapshots.map((s: any) => s.id);
    const labelById = new Map(snapshots.map((s: any) => [s.id, s.label as string]));

    const { data: outcomes, error: outErr } = await supabase
      .from("pick_outcomes")
      .select("snapshot_id,window_days,return_pct,is_win")
      .in("snapshot_id", ids)
      .eq("window_days", PRIMARY_WINDOW)
      .limit(5000);
    if (outErr) throw outErr;

    type Bucket = { wins: number; total: number; sumReturn: number };
    const buckets: Record<string, Bucket> = {};
    for (const lbl of LABELS) buckets[lbl] = { wins: 0, total: 0, sumReturn: 0 };

    for (const o of (outcomes ?? []) as any[]) {
      const label = labelById.get(o.snapshot_id);
      if (!label || !buckets[label]) continue;
      buckets[label].total++;
      if (o.is_win) buckets[label].wins++;
      buckets[label].sumReturn += Number(o.return_pct ?? 0);
    }

    // Multiplier policy:
    //   • Need ≥ 10 outcomes per label before adjusting (otherwise stay at 1.0).
    //   • Hit rate above 60% → boost (up to +15%). Below 40% → dampen (down to -15%).
    //   • Tied to PRIMARY_WINDOW so it tracks the core trade horizon.
    const MIN_SAMPLE = 10;
    const updates = [] as any[];
    for (const lbl of LABELS) {
      const b = buckets[lbl];
      if (b.total < MIN_SAMPLE) {
        updates.push({
          label: lbl, multiplier: 1.0,
          sample_size: b.total,
          hit_rate: b.total > 0 ? +(b.wins / b.total).toFixed(3) : null,
          avg_return: b.total > 0 ? +(b.sumReturn / b.total).toFixed(3) : null,
          rationale: `Holding at 1.00 — only ${b.total} evaluated picks (need ≥ ${MIN_SAMPLE}).`,
        });
        continue;
      }
      const hit = b.wins / b.total;
      const avg = b.sumReturn / b.total;

      // Map [0.40, 0.60] → [-0.15, +0.15] linearly.
      const raw = (hit - 0.5) * 1.5; // hit=0.6 → 0.15, hit=0.4 → -0.15
      const mult = +clamp(1 + raw, 0.85, 1.15).toFixed(3);

      const direction = mult > 1.01 ? "boosted" : mult < 0.99 ? "dampened" : "held";
      updates.push({
        label: lbl, multiplier: mult,
        sample_size: b.total,
        hit_rate: +hit.toFixed(3),
        avg_return: +avg.toFixed(3),
        rationale: `${direction} — ${b.total} picks, ${(hit * 100).toFixed(0)}% hit rate, ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}% avg ${PRIMARY_WINDOW}d return.`,
      });
    }

    // Upsert by label.
    for (const u of updates) {
      const { error } = await supabase
        .from("learning_weights")
        .upsert({ ...u, updated_at: new Date().toISOString() }, { onConflict: "label" });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ updated: updates.length, weights: updates }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
