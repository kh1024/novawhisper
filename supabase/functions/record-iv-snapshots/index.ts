// Daily cron: invoke options-fetch for a curated symbol list so iv_history
// fills up reliably regardless of user activity. options-fetch already writes
// one ATM-IV row per (symbol, UTC date) into iv_history (best effort, deduped
// via kv_cache). This function just fans out the calls with light throttling.
//
// Schedule via pg_cron (see SQL run separately). Public endpoint — guarded by
// a CRON_SECRET header so it can also be triggered manually for backfills.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Curated list — large/liquid US tickers + a few high-IV names so the 60-sample
// threshold for ivpPreferred() can be reached within ~3 months of daily runs.
const SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA",
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "NFLX",
  "JPM", "BAC", "XOM", "CVX", "WMT", "COST", "HD", "DIS",
  "COIN", "PLTR", "SMCI", "MARA", "RIOT", "MSTR",
  "GLD", "SLV", "TLT", "USO", "UNG",
];

const CONCURRENCY = 4;
const PER_CALL_DELAY_MS = 250;

async function fetchOne(symbol: string): Promise<{ symbol: string; ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/options-fetch?symbol=${encodeURIComponent(symbol)}`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { symbol, ok: false, error: `${r.status} ${text.slice(0, 200)}` };
    }
    await r.json().catch(() => null);
    return { symbol, ok: true };
  } catch (e) {
    return { symbol, ok: false, error: String((e as Error).message ?? e) };
  }
}

async function runBatch() {
  const results: Array<{ symbol: string; ok: boolean; error?: string }> = [];
  let i = 0;
  async function worker() {
    while (i < SYMBOLS.length) {
      const idx = i++;
      const s = SYMBOLS[idx];
      const res = await fetchOne(s);
      results.push(res);
      await new Promise((r) => setTimeout(r, PER_CALL_DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Optional shared-secret guard. If CRON_SECRET is set, require it; otherwise
  // anyone with the function URL could trigger it (rate-limited by Edge anyway).
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const provided = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
    if (provided !== cronSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const started = Date.now();
  const results = await runBatch();
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return new Response(
    JSON.stringify({
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      total: SYMBOLS.length,
      ok,
      failed: failed.length,
      failures: failed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
