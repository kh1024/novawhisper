// Nightly job. For every snapshot that has crossed the 1d / 5d / 20d window
// boundary and doesn't yet have an outcome row, fetch the close price from
// Stooq and compute realized return + win/loss. Designed to be called by
// pg_cron every evening.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WINDOWS = [1, 5, 20] as const;

interface SnapshotRow {
  id: string;
  snapshot_date: string;
  symbol: string;
  label: string;
  bias: string;
  entry_price: number;
}

interface StooqBar { date: string; close: number }

async function stooqDaily(symbol: string): Promise<StooqBar[]> {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&i=d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NovaBot/1.0)" } });
    if (!r.ok) return [];
    const txt = await r.text();
    const lines = txt.trim().split("\n");
    if (lines.length < 2) return [];
    const bars: StooqBar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 5) continue;
      const close = Number(parts[4]);
      if (!Number.isFinite(close) || close <= 0) continue;
      bars.push({ date: parts[0], close });
    }
    return bars.slice(-60);
  } catch {
    return [];
  }
}

// Trading-day arithmetic (skip weekends; ignores holidays — close enough for outcomes).
function addTradingDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

// For BUY/WATCHLIST bullish picks, win = positive return.
// For bearish picks, win = negative return (a put/short setup pays off when stock drops).
// For DON'T BUY / WAIT, "win" = the engine correctly avoided a loser, so win = return < 0.5%.
function isWin(label: string, bias: string, returnPct: number): boolean {
  const isAvoid = label === "DON'T BUY" || label === "WAIT";
  if (isAvoid) return returnPct < 0.5; // engine said skip — was it right?
  if (bias === "bearish") return returnPct < -0.5;
  return returnPct > 0.5; // bullish or neutral take = needed upside
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    // Pull every snapshot from the last 30 calendar days that could plausibly
    // have a window ready. We over-fetch and filter in JS; this keeps the
    // query simple and well within row limits.
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 32);
    const { data: snapshots, error: snapErr } = await supabase
      .from("pick_snapshots")
      .select("id,snapshot_date,symbol,label,bias,entry_price")
      .gte("snapshot_date", cutoff.toISOString().slice(0, 10))
      .limit(1000);

    if (snapErr) throw snapErr;
    if (!snapshots || snapshots.length === 0) {
      return new Response(JSON.stringify({ evaluated: 0, message: "no snapshots in range" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull all existing outcomes for these snapshots so we don't re-evaluate.
    const ids = (snapshots as SnapshotRow[]).map((s) => s.id);
    const { data: existing } = await supabase
      .from("pick_outcomes")
      .select("snapshot_id,window_days")
      .in("snapshot_id", ids);
    const have = new Set((existing ?? []).map((o: any) => `${o.snapshot_id}:${o.window_days}`));

    // Group work by symbol so we fetch each Stooq history once.
    const bySymbol = new Map<string, SnapshotRow[]>();
    for (const s of snapshots as SnapshotRow[]) {
      if (!bySymbol.has(s.symbol)) bySymbol.set(s.symbol, []);
      bySymbol.get(s.symbol)!.push(s);
    }

    let evaluated = 0;
    const insertRows: any[] = [];

    for (const [symbol, snaps] of bySymbol) {
      const bars = await stooqDaily(symbol);
      if (bars.length === 0) continue;

      for (const snap of snaps) {
        for (const w of WINDOWS) {
          const key = `${snap.id}:${w}`;
          if (have.has(key)) continue;
          const targetDate = addTradingDays(snap.snapshot_date, w);
          if (targetDate > today) continue; // window not yet elapsed

          // Find the bar on or just after the target date.
          const bar = bars.find((b) => b.date >= targetDate);
          if (!bar) continue;

          const returnPct = ((bar.close - snap.entry_price) / snap.entry_price) * 100;
          insertRows.push({
            snapshot_id: snap.id,
            window_days: w,
            exit_price: bar.close,
            return_pct: +returnPct.toFixed(3),
            is_win: isWin(snap.label, snap.bias, returnPct),
          });
          evaluated++;
        }
      }
    }

    if (insertRows.length > 0) {
      // Chunk inserts to stay friendly with payload size.
      const CHUNK = 200;
      for (let i = 0; i < insertRows.length; i += CHUNK) {
        const slice = insertRows.slice(i, i + CHUNK);
        const { error } = await supabase.from("pick_outcomes").insert(slice);
        if (error && !error.message.includes("duplicate")) throw error;
      }
    }

    return new Response(JSON.stringify({ evaluated, totalSnapshots: snapshots.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
