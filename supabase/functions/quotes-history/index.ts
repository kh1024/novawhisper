// Daily price history from Stooq (free, no key, US tickers via .us suffix).
// Returns last N closes per symbol — used by Conflict Resolution Layer to
// compute real RSI(14), 8-EMA, and winning streak.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface Bar { date: string; close: number }
interface SymbolHistory { symbol: string; closes: number[]; bars: Bar[]; source: string; error?: string }

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
    const recent = bars.slice(-Math.max(lookbackDays, 30));
    return { symbol, closes: recent.map((b) => b.close), bars: recent, source: "stooq" };
  } catch (e) {
    return { symbol, closes: [], bars: [], source: "stooq", error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const symbolsIn: unknown = body.symbols;
    const lookbackDays = Math.min(120, Math.max(15, Number(body.lookbackDays ?? 60)));
    if (!Array.isArray(symbolsIn) || symbolsIn.length === 0) {
      return new Response(JSON.stringify({ error: "symbols (array) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const symbols = symbolsIn.map((s) => String(s).toUpperCase()).slice(0, 25);
    const results = await Promise.all(symbols.map((s) => stooqDaily(s, lookbackDays)));
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
