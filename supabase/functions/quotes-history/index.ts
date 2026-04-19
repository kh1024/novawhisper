// Daily price history. Primary: Yahoo Finance v8 chart API (free, no key).
// Fallback: Stooq CSV when Yahoo rate-limits or returns malformed data.
// Returns last N closes per symbol — used by Conflict Resolution Layer to
// compute real RSI(14), 8-EMA, EMA20/50 distances, and winning streaks.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface Bar { date: string; close: number }
interface SymbolHistory { symbol: string; closes: number[]; bars: Bar[]; source: string; error?: string }

// Map lookback days → Yahoo's `range` token. Yahoo only accepts a fixed set.
function yahooRangeFor(lookbackDays: number): string {
  if (lookbackDays <= 30) return "1mo";
  if (lookbackDays <= 90) return "3mo";
  if (lookbackDays <= 180) return "6mo";
  if (lookbackDays <= 365) return "1y";
  return "2y";
}

async function yahooDaily(symbol: string, lookbackDays: number): Promise<SymbolHistory> {
  const range = yahooRangeFor(lookbackDays);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const r = await fetch(url, {
      headers: {
        // Yahoo returns 401/403 to requests without a real-looking UA.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });
    if (!r.ok) return { symbol, closes: [], bars: [], source: "yahoo", error: `HTTP ${r.status}` };
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const closesRaw: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closesRaw) || timestamps.length === 0) {
      return { symbol, closes: [], bars: [], source: "yahoo", error: "empty payload" };
    }
    const bars: Bar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closesRaw[i];
      if (c == null || !Number.isFinite(c) || c <= 0) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      bars.push({ date, close: Number(c) });
    }
    if (bars.length === 0) return { symbol, closes: [], bars: [], source: "yahoo", error: "no valid closes" };
    const recent = bars.slice(-Math.max(lookbackDays, 30));
    return { symbol, closes: recent.map((b) => b.close), bars: recent, source: "yahoo" };
  } catch (e) {
    return { symbol, closes: [], bars: [], source: "yahoo", error: e instanceof Error ? e.message : String(e) };
  }
}

async function stooqDaily(symbol: string, lookbackDays: number): Promise<SymbolHistory> {
  const stooqSym = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NovaBot/1.0)" } });
    if (!r.ok) return { symbol, closes: [], bars: [], source: "stooq", error: `HTTP ${r.status}` };
    const txt = await r.text();
    const lines = txt.trim().split("\n");
    if (lines.length < 2) return { symbol, closes: [], bars: [], source: "stooq", error: "empty" };
    // Header: Date,Open,High,Low,Close,Volume
    const bars: Bar[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 5) continue;
      const close = Number(parts[4]);
      if (!Number.isFinite(close) || close <= 0) continue;
      bars.push({ date: parts[0], close });
    }
    if (bars.length === 0) return { symbol, closes: [], bars: [], source: "stooq", error: "no valid closes" };
    const recent = bars.slice(-Math.max(lookbackDays, 30));
    return { symbol, closes: recent.map((b) => b.close), bars: recent, source: "stooq" };
  } catch (e) {
    return { symbol, closes: [], bars: [], source: "stooq", error: e instanceof Error ? e.message : String(e) };
  }
}

// Try Yahoo first; fall back to Stooq only when Yahoo returns no usable closes.
async function fetchOne(symbol: string, lookbackDays: number): Promise<SymbolHistory> {
  const y = await yahooDaily(symbol, lookbackDays);
  if (y.closes.length >= 15) return y;
  const s = await stooqDaily(symbol, lookbackDays);
  if (s.closes.length >= 15) {
    return { ...s, source: y.error ? `stooq (yahoo: ${y.error})` : "stooq" };
  }
  // Both failed — return the Yahoo result with the more informative error.
  return y.closes.length >= s.closes.length ? y : s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const symbolsIn: unknown = body.symbols;
    const lookbackDays = Math.min(260, Math.max(15, Number(body.lookbackDays ?? 60)));
    if (!Array.isArray(symbolsIn) || symbolsIn.length === 0) {
      return new Response(JSON.stringify({ error: "symbols (array) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const symbols = symbolsIn.map((s) => String(s).toUpperCase()).slice(0, 25);
    const results = await Promise.all(symbols.map((s) => fetchOne(s, lookbackDays)));
    return new Response(
      JSON.stringify({ histories: results, fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
