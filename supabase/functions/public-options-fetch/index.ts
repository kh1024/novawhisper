// Public.com option-chain proxy.
//
// POST /userapigateway/marketdata/{accountId}/option-chain with:
//   { instrument: { symbol, type: "EQUITY" }, expirationDate: "YYYY-MM-DD" }
// → { baseSymbol, calls: [...], puts: [...] }
//
// Normalized output shape mirrors the rest of the app's option records:
//   { contracts: [{ symbol, strike, type: "call"|"put", expiry, bid, ask, last,
//                   delta, iv, openInterest }] }
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import {
  PUBLIC_BASE,
  PUBLIC_CORS,
  PublicRateLimitError,
  getPublicAccountId,
  getPublicToken,
  notePublicRateLimit,
} from "../_shared/publicCom.ts";

const Body = z.object({
  underlying: z.string().min(1).max(10),
  // ISO date (YYYY-MM-DD). When omitted the function only pings to keep the
  // health-check ping cheap — it returns whatever the API gives for "today".
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

interface PublicLeg {
  instrument?: { symbol?: string };
  strikePrice?: string;
  last?: string;
  bid?: string;
  ask?: string;
  openInterest?: number;
  optionDetails?: { greeks?: { delta?: string; impliedVolatility?: string } };
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
    const { underlying, expiry, limit = 100 } = parsed.data;

    const token = await getPublicToken();
    const accountId = await getPublicAccountId(token);

    // Default the health-check ping to the next Friday so the API always has
    // a real chain to return rather than 400-ing on a missing date.
    const exp = expiry ?? nextFriday();

    const r = await fetch(`${PUBLIC_BASE}/userapigateway/marketdata/${accountId}/option-chain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "nova-options",
      },
      body: JSON.stringify({
        instrument: { symbol: underlying.toUpperCase(), type: "EQUITY" },
        expirationDate: exp,
      }),
    });
    if (r.status === 429) {
      const detail = (await r.text()).slice(0, 200);
      const err = notePublicRateLimit(detail);
      return new Response(JSON.stringify({ ok: false, error: err.message, detail, retryAfterMs: err.retryAfterMs, underlying }), {
        status: 429,
        headers: { ...PUBLIC_CORS, "Content-Type": "application/json", "Retry-After": String(Math.ceil(err.retryAfterMs / 1000)) },
      });
    }
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Public.com option-chain ${r.status}`, detail: (await r.text()).slice(0, 400), underlying }), {
        status: 502, headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { baseSymbol?: string; calls?: PublicLeg[]; puts?: PublicLeg[] };

    const map = (leg: PublicLeg, type: "call" | "put") => ({
      symbol: leg.instrument?.symbol ?? "",
      type,
      expiry: exp,
      strike: leg.strikePrice != null ? Number(leg.strikePrice) : null,
      bid: leg.bid != null ? Number(leg.bid) : null,
      ask: leg.ask != null ? Number(leg.ask) : null,
      last: leg.last != null ? Number(leg.last) : null,
      delta: leg.optionDetails?.greeks?.delta != null ? Number(leg.optionDetails.greeks.delta) : null,
      iv: leg.optionDetails?.greeks?.impliedVolatility != null ? Number(leg.optionDetails.greeks.impliedVolatility) : null,
      openInterest: leg.openInterest ?? null,
    });

    const contracts = [
      ...(j.calls ?? []).map((c) => map(c, "call")),
      ...(j.puts ?? []).map((p) => map(p, "put")),
    ].slice(0, limit);

    return new Response(JSON.stringify({ ok: true, underlying: j.baseSymbol ?? underlying, expiry: exp, contracts }), {
      headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof PublicRateLimitError) {
      return new Response(JSON.stringify({ ok: false, error: e.message, retryAfterMs: e.retryAfterMs }), {
        status: 429,
        headers: { ...PUBLIC_CORS, "Content-Type": "application/json", "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) },
      });
    }
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...PUBLIC_CORS, "Content-Type": "application/json" },
    });
  }
});

function nextFriday(): string {
  const d = new Date();
  const dow = d.getUTCDay();
  const add = ((5 - dow + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
