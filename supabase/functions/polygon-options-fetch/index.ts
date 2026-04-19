// Polygon.io options-chain snapshot proxy.
// GET /v3/snapshot/options/{underlying}?expiration_date=YYYY-MM-DD&limit=...
// Returns: { results: [{ details:{contract_type,strike_price,expiration_date,ticker},
//   day:{...}, last_quote:{bid,ask}, greeks:{delta,...}, implied_volatility,
//   open_interest }] }
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({
  underlying: z.string().min(1).max(10),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().positive().max(250).optional(),
});

interface Snap {
  details?: { contract_type?: "call" | "put"; strike_price?: number; expiration_date?: string; ticker?: string };
  day?: { close?: number };
  last_quote?: { bid?: number; ask?: number };
  greeks?: { delta?: number };
  implied_volatility?: number;
  open_interest?: number;
}

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
    const { underlying, expiry, limit = 100 } = parsed.data;

    const params = new URLSearchParams({ apiKey: key, limit: String(limit) });
    if (expiry) params.set("expiration_date", expiry);
    const r = await fetch(`https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(underlying.toUpperCase())}?${params}`);
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Polygon HTTP ${r.status}`, detail: (await r.text()).slice(0, 400) }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { results?: Snap[] };
    const contracts = (j.results ?? []).map((s) => ({
      symbol: s.details?.ticker ?? "",
      type: s.details?.contract_type ?? null,
      strike: s.details?.strike_price ?? null,
      expiry: s.details?.expiration_date ?? expiry ?? null,
      bid: s.last_quote?.bid ?? null,
      ask: s.last_quote?.ask ?? null,
      last: s.day?.close ?? null,
      delta: s.greeks?.delta ?? null,
      iv: s.implied_volatility ?? null,
      openInterest: s.open_interest ?? null,
    }));
    return new Response(JSON.stringify({ ok: true, underlying, contracts }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
