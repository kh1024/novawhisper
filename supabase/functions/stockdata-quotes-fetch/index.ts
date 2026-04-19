// StockData.org quotes proxy.
// GET /v1/data/quote?symbols=AAPL,MSFT&api_token=... → { data: [{ ticker, price, last_trade_time, ... }] }
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({ symbols: z.array(z.string().min(1).max(10)).min(1).max(50) });

interface SDQuote {
  ticker?: string;
  price?: number;
  day_change?: number;
  last_trade_time?: string;
  previous_close_price?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("STOCKDATA_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "STOCKDATA_API_KEY is not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body", detail: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const symbols = parsed.data.symbols.map((s) => s.toUpperCase()).join(",");

    const r = await fetch(`https://api.stockdata.org/v1/data/quote?symbols=${encodeURIComponent(symbols)}&api_token=${key}`);
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `StockData HTTP ${r.status}`, detail: (await r.text()).slice(0, 400) }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { data?: SDQuote[] };
    const quotes = (j.data ?? [])
      .filter((q) => q.ticker && q.price != null)
      .map((q) => ({
        symbol: q.ticker!.toUpperCase(),
        price: Number(q.price),
        ts: q.last_trade_time ? new Date(q.last_trade_time).getTime() : Date.now(),
        prevClose: q.previous_close_price ?? null,
        change: q.day_change ?? null,
        source: "stockdata" as const,
      }));
    return new Response(JSON.stringify({ ok: true, quotes }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
