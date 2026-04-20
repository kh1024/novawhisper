// portfolio-exit-eval — runs every 5 minutes during market hours. For every
// OPEN position, fetches the latest underlying quote + estimates the option
// mid, then writes back current_price, current_profit_pct, exit_recommendation,
// and exit_reason via the exit-guidance engine.
//
// Hybrid pricing strategy (per spec):
//   • DTE ≤ 7  → fetch real chain via public-options-fetch
//   • DTE > 7  → BS-lite estimator from spot + ivRank=50 fallback
//
// Idempotent — safe to call manually with { ownerKey?: string } to limit scope.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PositionRow {
  id: string;
  owner_key: string;
  symbol: string;
  option_type: string;
  direction: string;
  strike: number;
  expiry: string;
  contracts: number;
  entry_premium: number | null;
  hard_stop_pct: number;
  target_1_pct: number;
  target_2_pct: number;
  max_hold_days: number | null;
}

// ─── Black-Scholes-lite (mirror of src/lib/premiumEstimator.ts) ─────────────
const R = 0.04;
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
function bsPrice(spot: number, strike: number, iv: number, dte: number, isCall: boolean): number {
  const T = Math.max(1, dte) / 365;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (R + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const intrinsic = Math.max(0, isCall ? spot - strike : strike - spot);
  const price = isCall
    ? spot * normCdf(d1) - strike * Math.exp(-R * T) * normCdf(d2)
    : strike * Math.exp(-R * T) * (1 - normCdf(d2)) - spot * (1 - normCdf(d1));
  return Math.max(intrinsic + 0.01, price);
}

// ─── Exit engine (mirror of src/lib/exitGuidance.ts) ────────────────────────
type Rec = "HOLD" | "TRIM_PARTIAL" | "TAKE_PROFIT" | "SELL_AT_LOSS" | "TIME_EXIT" | "NO_SIGNAL";

function decide(p: PositionRow, optionMid: number, dte: number): { recommendation: Rec; reason: string; profitPct: number } {
  if (p.entry_premium == null || p.entry_premium <= 0) {
    return { recommendation: "NO_SIGNAL", reason: "Entry price unknown.", profitPct: 0 };
  }
  const profitPct = ((optionMid - Number(p.entry_premium)) / Number(p.entry_premium)) * 100;
  if (profitPct <= Number(p.hard_stop_pct)) {
    return { recommendation: "SELL_AT_LOSS", reason: `Premium down ${profitPct.toFixed(1)}% vs entry; below ${p.hard_stop_pct}% hard stop. Cut loss and preserve capital.`, profitPct };
  }
  if (profitPct >= Number(p.target_2_pct)) {
    return { recommendation: "TAKE_PROFIT", reason: `Premium up ${profitPct.toFixed(1)}%, above target_2 (${p.target_2_pct}%). Lock in full profits.`, profitPct };
  }
  if (profitPct >= Number(p.target_1_pct)) {
    return { recommendation: "TRIM_PARTIAL", reason: `Premium up ${profitPct.toFixed(1)}%, above target_1 (${p.target_1_pct}%). Take partial profits, move stop to breakeven.`, profitPct };
  }
  if (p.max_hold_days != null && dte <= 1) {
    return { recommendation: "TIME_EXIT", reason: "Option is near expiration with limited time value left. Flatten risk before last-day decay.", profitPct };
  }
  return { recommendation: "HOLD", reason: "Position within risk parameters; trend and volume not broken. Hold and re-evaluate intraday.", profitPct };
}

function dteFromExpiry(expiry: string): number {
  const t = new Date(expiry + "T16:00:00Z").getTime();
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}

function isMarketHoursET(): boolean {
  // Convert "now" into ET wall-clock minutes.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (wd === "Sat" || wd === "Sun") return false;
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: { ownerKey?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* GET / no body */ }

  const force = body.force === true;
  if (!force && !isMarketHoursET()) {
    return new Response(JSON.stringify({ ok: true, skipped: "outside_market_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let q = supabase
    .from("portfolio_positions")
    .select("id, owner_key, symbol, option_type, direction, strike, expiry, contracts, entry_premium, hard_stop_pct, target_1_pct, target_2_pct, max_hold_days")
    .eq("status", "open");
  if (body.ownerKey) q = q.eq("owner_key", body.ownerKey);

  const { data: positions, error: selErr } = await q;
  if (selErr) {
    return new Response(JSON.stringify({ ok: false, error: selErr.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }

  const rows = (positions ?? []) as PositionRow[];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, evaluated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch quotes in one batch via the existing quotes-fetch function.
  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
  const quoteMap = new Map<string, number>();
  try {
    const { data: qd } = await supabase.functions.invoke("quotes-fetch", {
      body: { symbols },
    });
    const quotes = (qd?.quotes ?? []) as Array<{ symbol: string; price: number }>;
    for (const q of quotes) if (Number.isFinite(q.price)) quoteMap.set(q.symbol, Number(q.price));
  } catch (e) {
    console.warn("quotes-fetch failed", e);
  }

  // For short-DTE positions, attempt to fetch real chain mids via public-options-fetch.
  const shortDteSymbols = Array.from(new Set(rows.filter((r) => dteFromExpiry(r.expiry) <= 7).map((r) => r.symbol)));
  const realMids = new Map<string, number>(); // key: SYMBOL|TYPE|STRIKE|EXPIRY
  for (const sym of shortDteSymbols) {
    try {
      const { data } = await supabase.functions.invoke("public-options-fetch", { body: { symbol: sym } });
      const contracts = (data?.contracts ?? []) as Array<{
        symbol: string; type: string; strike: number; expiry: string; mid?: number; ask?: number; bid?: number;
      }>;
      for (const c of contracts) {
        const mid = c.mid ?? ((c.bid != null && c.ask != null) ? (Number(c.bid) + Number(c.ask)) / 2 : null);
        if (mid == null) continue;
        const key = `${sym}|${(c.type ?? "").toLowerCase()}|${Number(c.strike)}|${c.expiry}`;
        realMids.set(key, Number(mid));
      }
    } catch (e) {
      console.warn(`public-options-fetch failed for ${sym}`, e);
    }
  }

  let evaluated = 0;
  let stops = 0;
  let profits = 0;
  for (const p of rows) {
    const spot = quoteMap.get(p.symbol);
    if (spot == null) continue;
    const isCall = p.option_type.toLowerCase().includes("call");
    const dte = dteFromExpiry(p.expiry);

    let mid: number | null = null;
    if (dte <= 7) {
      const key = `${p.symbol}|${isCall ? "call" : "put"}|${Number(p.strike)}|${p.expiry}`;
      mid = realMids.get(key) ?? null;
    }
    if (mid == null) {
      // Fallback to BS-lite (iv=0.55 ≈ ivRank 50).
      mid = bsPrice(spot, Number(p.strike), 0.55, dte, isCall);
    }

    const dec = decide(p, mid, dte);
    if (dec.recommendation === "SELL_AT_LOSS" || dec.recommendation === "TIME_EXIT") stops++;
    if (dec.recommendation === "TAKE_PROFIT" || dec.recommendation === "TRIM_PARTIAL") profits++;

    await supabase
      .from("portfolio_positions")
      .update({
        current_price: +mid.toFixed(2),
        current_profit_pct: +dec.profitPct.toFixed(2),
        exit_recommendation: dec.recommendation,
        exit_reason: dec.reason,
        last_evaluated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    evaluated++;
  }

  return new Response(JSON.stringify({ ok: true, evaluated, stops, profits }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
