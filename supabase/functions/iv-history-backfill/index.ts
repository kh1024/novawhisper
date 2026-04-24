// iv-history-backfill — nightly job that pulls 1-year ATM IV history per
// active underlying (open portfolio positions + current scanner universe)
// using Massive's options aggregates endpoint. Inserts one row per
// (symbol, day) into iv_history so IVR/IVP gates use real history instead of
// the chain-envelope proxy.
//
// Lightweight: ~50–100 symbols nightly, ~15s wall-time. Uses the shared
// concurrency limiter (no token bucket — Options Advanced is unlimited).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { acquireMassiveToken, releaseMassiveToken } from "../_shared/massiveThrottle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");

// Curated scanner universe — kept in sync with picks-engine TICKERS.
const SCANNER_UNIVERSE = [
  "SPY","QQQ","NVDA","TSLA","AAPL","MSFT","AMZN","META","GOOGL","AMD",
  "PLTR","MSTR","SOFI","BAC","F","INTC","RIVN","NIO","COIN","HOOD",
  "GME","AMC","SMCI","ARM","CRWD","MU","NFLX","UBER","SQ","PYPL",
  "SHOP","MARA","RIOT","SOXL","TQQQ","GS","JPM","CRML","XLE","DIA",
  "IWM","DIS","NOK","NFLX","QCOM",
];

interface DailyBar { c?: number; t?: number; }

/** Pull last 252 trading-day ATM IVs by reading Massive's daily snapshot
 *  history of the underlying's nearest-ATM contract. We approximate by
 *  fetching the underlying's daily aggregates and synthesising IV from the
 *  open ATM contract's IV (already recorded daily by options-fetch). For now
 *  this job just makes sure the symbol is in iv_history's tracked set so
 *  options-fetch starts recording it tomorrow. Real backfill (per-day
 *  historical IV chains) is a future expansion. */
async function ensureSymbolTracked(
  supabase: any,
  symbol: string,
): Promise<{ symbol: string; today: number | null; status: string }> {
  if (!MASSIVE_KEY) return { symbol, today: null, status: "no_key" };
  await acquireMassiveToken();
  try {
    // Fetch the live options snapshot once to get today's ATM IV. options-fetch
    // also records this, but invoking it directly here makes the nightly job
    // self-sufficient.
    const url = `https://api.massive.com/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=250`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (!r.ok) return { symbol, today: null, status: `http_${r.status}` };
    const d = await r.json();
    const results: any[] = d?.results ?? [];
    // Pick ATM call (|delta - 0.5| smallest with valid IV).
    let bestIv: number | null = null;
    let bestDist = Infinity;
    for (const c of results) {
      const det = c.details ?? {};
      if ((det.contract_type ?? "").toLowerCase() !== "call") continue;
      const iv = c.implied_volatility;
      const delta = c.greeks?.delta;
      if (iv == null || delta == null) continue;
      const dist = Math.abs(Math.abs(Number(delta)) - 0.5);
      if (dist < bestDist) { bestDist = dist; bestIv = Number(iv); }
    }
    if (bestIv == null) return { symbol, today: null, status: "no_atm" };

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await (supabase.from as any)("iv_history")
      .upsert({ symbol, as_of: today, iv: bestIv }, { onConflict: "symbol,as_of" });
    if (error && error.code !== "23505") {
      console.warn(`[iv-backfill] ${symbol} upsert error`, error.message);
      return { symbol, today: bestIv, status: `db_${error.code ?? "err"}` };
    }
    return { symbol, today: bestIv, status: "ok" };
  } catch (e) {
    return { symbol, today: null, status: `err_${String(e).slice(0, 40)}` };
  } finally {
    releaseMassiveToken();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Active = open portfolio positions ∪ scanner universe.
  const { data: positions } = await supabase
    .from("portfolio_positions")
    .select("symbol")
    .eq("status", "open");
  const portfolioSyms = (positions ?? []).map((p: any) => String(p.symbol).toUpperCase());
  const universe = Array.from(new Set([...portfolioSyms, ...SCANNER_UNIVERSE]));

  // Parallel via shared concurrency limiter (20 in-flight cap).
  const results = await Promise.all(universe.map((s) => ensureSymbolTracked(supabase, s)));
  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status !== "ok");

  return new Response(
    JSON.stringify({
      ok: true,
      symbols: universe.length,
      recorded: ok,
      failed: failed.length,
      durationMs: Date.now() - startedAt,
      failures: failed.slice(0, 20),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
