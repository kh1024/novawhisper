// Public.com market-data proxy.
//
// Auth flow (per https://public.com/api/docs/quickstart):
//   1. PUBLIC_COM_API_KEY (secret) is the long-lived "secret key" the user
//      generated at /settings/v2/api.
//   2. POST it to /userapiauthservice/personal/access-tokens to mint a
//      short-lived bearer accessToken (we ask for 60 min, refresh at 50).
//   3. GET /userapigateway/trading/account → first accountId (cached for the
//      lifetime of the warm instance — accounts don't change).
//   4. POST /userapigateway/marketdata/{accountId}/quotes with the symbols.
//
// Response is normalized to the same { quotes: [{ symbol, price, ts }] }
// shape the rest of the app consumes from quotes-fetch, so it can later be
// folded into the consensus without further changes.
import { corsHeaders } from "@supabase/supabase-js/cors";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const BASE = "https://api.public.com";
const TOKEN_TTL_MIN = 60;
const TOKEN_REFRESH_BEFORE_MS = 10 * 60 * 1000; // refresh 10 min early

const Body = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(50),
});

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedAccountId: string | null = null;

async function mintToken(secret: string): Promise<string> {
  const r = await fetch(`${BASE}/userapiauthservice/personal/access-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "nova-options" },
    body: JSON.stringify({ validityInMinutes: TOKEN_TTL_MIN, secret }),
  });
  if (!r.ok) throw new Error(`Public.com auth ${r.status}: ${await r.text()}`);
  const j = await r.json() as { accessToken?: string };
  if (!j.accessToken) throw new Error("Public.com auth: missing accessToken");
  cachedToken = { value: j.accessToken, expiresAt: Date.now() + TOKEN_TTL_MIN * 60_000 - TOKEN_REFRESH_BEFORE_MS };
  return j.accessToken;
}

async function getToken(): Promise<string> {
  const secret = Deno.env.get("PUBLIC_COM_API_KEY");
  if (!secret) throw new Error("PUBLIC_COM_API_KEY is not configured");
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  return mintToken(secret);
}

async function getAccountId(token: string): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const r = await fetch(`${BASE}/userapigateway/trading/account`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "nova-options" },
  });
  if (!r.ok) throw new Error(`Public.com accounts ${r.status}: ${await r.text()}`);
  const j = await r.json() as { accounts?: { accountId: string }[] };
  const id = j.accounts?.[0]?.accountId;
  if (!id) throw new Error("Public.com accounts: no account found");
  cachedAccountId = id;
  return id;
}

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body", detail: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const symbols = parsed.data.symbols.map((s) => s.toUpperCase());

    const token = await getToken();
    const accountId = await getAccountId(token);

    const r = await fetch(`${BASE}/userapigateway/marketdata/${accountId}/quotes`, {
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
      return new Response(JSON.stringify({ ok: false, error: `Public.com HTTP ${r.status}`, detail: await r.text() }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { quotes?: PublicQuote[] };

    // Normalize to { symbol, price, ts, prevClose, change, changePct, source }
    // matching the consumer shape used elsewhere in the app.
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
