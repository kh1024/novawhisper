// Polygon.io quotes proxy.
// Endpoint: GET /v2/last/trade/{ticker}?apiKey=... → { results: { p, t, s } }
// Free tier: 5 req/min — caller is responsible for batching/throttling.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({ symbols: z.array(z.string().min(1).max(10)).min(1).max(20) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("POLYGON_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "POLYGON_API_KEY is not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body", detail: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const symbols = parsed.data.symbols.map((s) => s.toUpperCase());

    const results = await Promise.all(symbols.map(async (sym) => {
      const r = await fetch(`https://api.polygon.io/v2/last/trade/${encodeURIComponent(sym)}?apiKey=${key}`);
      if (!r.ok) return { symbol: sym, error: `HTTP ${r.status}` };
      const j = await r.json() as { results?: { p?: number; t?: number; s?: number } };
      const p = j.results?.p;
      if (p == null) return { symbol: sym, error: "no price" };
      return {
        symbol: sym,
        price: p,
        // Polygon timestamps are nanoseconds since epoch.
        ts: j.results?.t != null ? Math.floor(j.results.t / 1_000_000) : Date.now(),
        size: j.results?.s ?? null,
        source: "polygon" as const,
      };
    }));

    const quotes = results.filter((r) => !("error" in r));
    return new Response(JSON.stringify({ ok: true, quotes }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
