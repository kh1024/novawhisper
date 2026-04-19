// StockData.org quotes proxy with daily budget guard, batching, and KV cache.
// Free tier: 100 req/day. We hard-cap at 95 to leave a 5-call safety margin.
// One call returns up to 100 tickers (`?symbols=A,B,C,...`) → batching is huge.
// 60-sec response cache + market-hours gate keeps usage well under budget.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(100),
  /** Skip the market-hours gate (used by Settings health ping). */
  force: z.boolean().optional(),
});

interface SDQuote {
  ticker?: string;
  price?: number;
  day_change?: number;
  last_trade_time?: string;
  previous_close_price?: number;
}

const DAILY_CAP = 95;
const CACHE_TTL_MS = 60_000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Market-hours gate: 9:30am–8:00pm ET, Mon–Fri (covers regular + after-hours).
function isMarketHours(): boolean {
  const now = new Date();
  // ET = UTC - 5 (standard) or - 4 (DST). Use a wider window to avoid date-math.
  const etHour = (now.getUTCHours() - 4 + 24) % 24; // approximate
  const day = now.getUTCDay(); // 0 Sun, 6 Sat
  if (day === 0 || day === 6) return false;
  return etHour >= 9 && etHour < 20;
}

async function kvGet<T = unknown>(key: string): Promise<{ value: T; expires_at: string | null } | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(key)}&select=value,expires_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: unknown, ttlMs: number | null): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kv_cache?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        key,
        value,
        expires_at: ttlMs == null ? null : new Date(Date.now() + ttlMs).toISOString(),
      }),
    });
  } catch { /* best effort */ }
}

async function getUsage(): Promise<number> {
  const row = await kvGet<{ count: number }>(`stockdata:usage:${todayUtc()}`);
  return row?.value?.count ?? 0;
}

async function bumpUsage(): Promise<number> {
  const day = todayUtc();
  const row = await kvGet<{ count: number }>(`stockdata:usage:${day}`);
  const next = (row?.value?.count ?? 0) + 1;
  // 36h TTL — auto-cleans yesterday's row.
  await kvSet(`stockdata:usage:${day}`, { count: next }, 36 * 60 * 60_000);
  return next;
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
    const symbols = Array.from(new Set(parsed.data.symbols.map((s) => s.toUpperCase()))).sort();
    const force = parsed.data.force === true;

    // Cache check (one shared key per sorted symbol set).
    const cacheKey = `stockdata:quotes:${symbols.join(",")}`;
    const cached = await kvGet<{ quotes: unknown[] }>(cacheKey);
    if (cached?.value?.quotes && cached.expires_at && Date.parse(cached.expires_at) > Date.now()) {
      const usage = await getUsage();
      return new Response(JSON.stringify({ ok: true, quotes: cached.value.quotes, cached: true, usage, dailyCap: DAILY_CAP }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Market-hours gate (skippable for health pings).
    if (!force && !isMarketHours()) {
      return new Response(JSON.stringify({ ok: true, quotes: [], skipped: "off-hours", usage: await getUsage(), dailyCap: DAILY_CAP }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Budget guard.
    const usage = await getUsage();
    if (usage >= DAILY_CAP) {
      return new Response(JSON.stringify({ ok: false, error: "daily_budget_exhausted", usage, dailyCap: DAILY_CAP }), {
        status: 429, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const r = await fetch(`https://api.stockdata.org/v1/data/quote?symbols=${encodeURIComponent(symbols.join(","))}&api_token=${key}`);
    const newUsage = await bumpUsage(); // count even on failure to be safe
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `StockData HTTP ${r.status}`, detail: (await r.text()).slice(0, 400), usage: newUsage, dailyCap: DAILY_CAP }), {
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

    await kvSet(cacheKey, { quotes }, CACHE_TTL_MS);
    return new Response(JSON.stringify({ ok: true, quotes, cached: false, usage: newUsage, dailyCap: DAILY_CAP }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
