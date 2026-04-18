// Live options chain from Massive: GET /v3/snapshot/options/{underlyingAsset}
// Returns normalized option contracts with Greeks, IV, OI, volume, bid/ask.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");

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

    return new Response(
      JSON.stringify({
        underlying,
        count: contracts.length,
        contracts,
        fetchedAt: new Date().toISOString(),
        source: "massive",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("options-fetch fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
