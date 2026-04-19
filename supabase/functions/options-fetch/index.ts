// Live options chain from Massive: GET /v3/snapshot/options/{underlyingAsset}
// Returns normalized option contracts with Greeks, IV, OI, volume, bid/ask.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CACHE_TTL_MS = 60_000; // 60s memoization for options snapshots

async function kvGet(key: string): Promise<{ value: any; expires_at: string | null } | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(key)}&select=value,expires_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) { await r.text().catch(() => ""); return null; }
    const rows = await r.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_cache?on_conflict=key`, {
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
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      }),
    });
    await r.text().catch(() => "");
  } catch { /* best effort */ }
}

// ── ATM IV history recording ──────────────────────────────────────────
// One snapshot per (symbol, UTC date). Skipped (no-op) if iv_history table
// hasn't been created yet — this keeps the function safe to deploy ahead of
// the migration. Uses the kv_cache as a same-day dedupe to avoid redundant
// PostgREST round-trips for repeated chain fetches on the same symbol.
async function recordAtmIv(symbol: string, atmIv: number | null): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  if (atmIv == null || !Number.isFinite(atmIv) || atmIv <= 0) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const dedupeKey = `iv_history_written:${symbol}:${today}`;
  const seen = await kvGet(dedupeKey);
  if (seen?.value) {
    const exp = seen.expires_at ? Date.parse(seen.expires_at) : 0;
    if (exp > Date.now()) return;
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/iv_history?on_conflict=symbol,as_of`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ symbol, as_of: today, iv: atmIv }),
    });
    if (r.ok || r.status === 409) {
      // Mark as recorded for ~26h so we only attempt once per UTC day per symbol.
      kvSet(dedupeKey, { ok: true }, 26 * 60 * 60_000);
    } else {
      // 404 = table not created yet (pre-migration). Don't spam logs.
      if (r.status !== 404) {
        const t = await r.text().catch(() => "");
        console.warn(`[iv_history] ${symbol} write HTTP ${r.status}: ${t.slice(0, 200)}`);
      }
    }
  } catch (e) {
    console.warn(`[iv_history] ${symbol} write error`, e);
  }
}

interface OptionContract {
  ticker: string;             // e.g. "O:AAPL250117C00200000"
  underlying: string;
  type: "call" | "put";
  strike: number;
  expiration: string;         // YYYY-MM-DD
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  last: number;
  volume: number;
  openInterest: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  underlyingPrice: number | null;
}

function dteFromIso(iso: string): number {
  const exp = new Date(iso + "T16:00:00-05:00").getTime();
  return Math.max(0, Math.round((exp - Date.now()) / 86400000));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!MASSIVE_KEY) {
      return new Response(JSON.stringify({ error: "MASSIVE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const u = new URL(req.url);
    let underlying = "";
    let limit = 100;
    let expirationGte: string | undefined;
    let expirationLte: string | undefined;

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      underlying = String(body.underlying ?? "").toUpperCase();
      limit = Math.min(250, Number(body.limit ?? 100));
      expirationGte = body.expirationGte;
      expirationLte = body.expirationLte;
    } else {
      underlying = (u.searchParams.get("underlying") ?? "").toUpperCase();
      limit = Math.min(250, Number(u.searchParams.get("limit") ?? "100"));
      expirationGte = u.searchParams.get("expirationGte") ?? undefined;
      expirationLte = u.searchParams.get("expirationLte") ?? undefined;
    }
    if (!underlying) {
      return new Response(JSON.stringify({ error: "underlying required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Cache lookup (60s memoization) ───────────────────────────────────
    const cacheKey = `options_chain_v1:${underlying}:${limit}:${expirationGte ?? ""}:${expirationLte ?? ""}`;
    const cached = await kvGet(cacheKey);
    if (cached?.value) {
      const exp = cached.expires_at ? Date.parse(cached.expires_at) : 0;
      if (exp > Date.now()) {
        return new Response(
          JSON.stringify({ ...cached.value, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const params = new URLSearchParams({ limit: String(limit) });
    if (expirationGte) params.set("expiration_date.gte", expirationGte);
    if (expirationLte) params.set("expiration_date.lte", expirationLte);
    const url = `https://api.massive.com/v3/snapshot/options/${encodeURIComponent(underlying)}?${params}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.warn(`[massive options] ${underlying} HTTP ${r.status}: ${text}`);
      return new Response(
        JSON.stringify({ error: `Massive HTTP ${r.status}`, detail: text, underlying }),
        { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const d = await r.json();
    const results: any[] = d.results ?? [];

    const contracts: OptionContract[] = results.map((c) => {
      const det = c.details ?? {};
      const greeks = c.greeks ?? {};
      const quote = c.last_quote ?? {};
      const trade = c.last_trade ?? {};
      const bid = Number(quote.bid ?? 0);
      const ask = Number(quote.ask ?? 0);
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(trade.price ?? 0);
      const spreadPct = mid > 0 && ask > bid ? ((ask - bid) / mid) * 100 : 0;
      const exp = String(det.expiration_date ?? "");
      return {
        ticker: String(det.ticker ?? c.ticker ?? ""),
        underlying,
        type: (det.contract_type ?? "call").toLowerCase() === "put" ? "put" : "call",
        strike: Number(det.strike_price ?? 0),
        expiration: exp,
        dte: exp ? dteFromIso(exp) : 0,
        bid, ask,
        mid: +mid.toFixed(4),
        spreadPct: +spreadPct.toFixed(2),
        last: Number(trade.price ?? 0),
        volume: Number(c.day?.volume ?? 0),
        openInterest: Number(c.open_interest ?? 0),
        iv: c.implied_volatility != null ? +Number(c.implied_volatility).toFixed(4) : null,
        delta: greeks.delta != null ? +Number(greeks.delta).toFixed(4) : null,
        gamma: greeks.gamma != null ? +Number(greeks.gamma).toFixed(4) : null,
        theta: greeks.theta != null ? +Number(greeks.theta).toFixed(4) : null,
        vega: greeks.vega != null ? +Number(greeks.vega).toFixed(4) : null,
        underlyingPrice: c.underlying_asset?.price != null ? Number(c.underlying_asset.price) : null,
      };
    });

    const payload = {
      underlying,
      count: contracts.length,
      contracts,
      fetchedAt: new Date().toISOString(),
      source: "massive",
    };
    // Best-effort write-through to KV so subsequent loads (within 60s) skip Polygon.
    kvSet(cacheKey, payload, CACHE_TTL_MS);
    return new Response(
      JSON.stringify(payload),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("options-fetch fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
