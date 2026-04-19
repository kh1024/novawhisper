// Live ticks broadcaster.
// Accepts a small symbol list (≤25), fetches Massive REST quotes once,
// broadcasts each tick over Supabase Realtime channel "live-ticks", returns
// fast. The CLIENT is responsible for scheduling (single shared 3s poll).
// This function does NOT loop or stream — it fires once per invocation so it
// fits comfortably inside the edge-function wall-time budget.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { acquireMassiveToken } from "../_shared/massiveThrottle.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const Body = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(25),
});

interface MassiveQuote {
  results?: { p?: number; t?: number };
}

async function fetchMassiveQuote(symbol: string, key: string): Promise<{ price: number; ts: number } | null> {
  await acquireMassiveToken();
  try {
    const r = await fetch(
      `https://api.massive.com/v2/last/trade/${encodeURIComponent(symbol)}?apiKey=${key}`,
    );
    if (!r.ok) return null;
    const j = await r.json() as MassiveQuote;
    const p = j.results?.p;
    if (p == null) return null;
    const ts = j.results?.t != null ? Math.floor(j.results.t / 1_000_000) : Date.now();
    return { price: p, ts };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("MASSIVE_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "MASSIVE_API_KEY missing" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ ok: false, error: "supabase env missing" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const symbols = Array.from(new Set(parsed.data.symbols.map((s) => s.toUpperCase())));

    // Fetch all quotes in parallel (throttle handles fairness).
    const ticks = (await Promise.all(symbols.map(async (sym) => {
      const q = await fetchMassiveQuote(sym, key);
      return q ? { symbol: sym, price: q.price, ts: q.ts } : null;
    }))).filter((t): t is { symbol: string; price: number; ts: number } => t !== null);

    if (ticks.length === 0) {
      return new Response(JSON.stringify({ ok: true, broadcast: 0, note: "no quotes" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Broadcast as a single event — clients filter by symbol.
    const supabase = createClient(supabaseUrl, serviceKey);
    const channel = supabase.channel("live-ticks");
    // .send() on a service-role client will broadcast even without subscribe.
    await channel.send({
      type: "broadcast",
      event: "ticks",
      payload: { ticks, sentAt: Date.now() },
    });
    // Cleanup so the function exits cleanly.
    await supabase.removeChannel(channel);

    return new Response(JSON.stringify({ ok: true, broadcast: ticks.length }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
