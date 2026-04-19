// Public.com quotes proxy. Auth/account caching lives in _shared/publicCom.ts.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { PUBLIC_BASE, PUBLIC_CORS, getPublicAccountId, getPublicToken } from "../_shared/publicCom.ts";

const Body = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(50),
});

interface PublicQuote {
  instrument: { symbol: string; type: string };
  outcome: string;
  last?: string;
  lastTimestamp?: string;
  bid?: string;
  ask?: string;
  previousClose?: string;
  oneDayChange?: { change?: string; percentChange?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: PUBLIC_CORS });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body", detail: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
      });
    }
    const symbols = parsed.data.symbols.map((s) => s.toUpperCase());

    const token = await getPublicToken();
    const accountId = await getPublicAccountId(token);

    const r = await fetch(`${PUBLIC_BASE}/userapigateway/marketdata/${accountId}/quotes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "nova-options",
      },
      body: JSON.stringify({
        instruments: symbols.map((symbol) => ({ symbol, type: "EQUITY" })),
      }),
    });
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Public.com HTTP ${r.status}`, detail: (await r.text()).slice(0, 400) }), {
        status: 502, headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { quotes?: PublicQuote[] };

    const quotes = (j.quotes ?? [])
      .filter((q) => q.outcome === "SUCCESS" && q.last != null)
      .map((q) => ({
        symbol: q.instrument.symbol.toUpperCase(),
        price: Number(q.last),
        ts: q.lastTimestamp ? new Date(q.lastTimestamp).getTime() : Date.now(),
        prevClose: q.previousClose != null ? Number(q.previousClose) : null,
        change: q.oneDayChange?.change != null ? Number(q.oneDayChange.change) : null,
        changePct: q.oneDayChange?.percentChange != null ? Number(q.oneDayChange.percentChange) : null,
        source: "public.com" as const,
      }));

    return new Response(JSON.stringify({ ok: true, quotes }), {
      headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
    });
  }
});
