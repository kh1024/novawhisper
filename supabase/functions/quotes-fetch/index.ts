// Verified quotes: fetch from Massive (primary) + Alpha Vantage (secondary), cross-check, return verified payload.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");
const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");

interface VerifiedQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  primary: number | null;
  secondary: number | null;
  primarySource: "massive" | null;
  secondarySource: "alpha-vantage" | null;
  status: "verified" | "close" | "mismatch" | "stale" | "unavailable";
  diffPct: number | null;
  updatedAt: string;
  error?: string;
}

async function fetchMassive(symbol: string): Promise<{ price: number; change: number; changePct: number; volume: number } | null> {
  if (!MASSIVE_KEY) return null;
  try {
    // Single Ticker Snapshot — bundles last trade + day aggregates + prev day close.
    const url = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (!r.ok) {
      console.warn(`[massive] ${symbol} HTTP ${r.status}: ${await r.text().catch(() => "")}`);
      return null;
    }
    const d = await r.json();
    const t = d.ticker ?? d.results ?? {};
    const price = Number(t.lastTrade?.p ?? t.day?.c ?? t.min?.c);
    const prev = Number(t.prevDay?.c);
    if (!isFinite(price) || price === 0) return null;
    const change = isFinite(prev) && prev > 0 ? price - prev : Number(t.todaysChange ?? 0);
    const changePct = isFinite(prev) && prev > 0 ? (change / prev) * 100 : Number(t.todaysChangePerc ?? 0);
    return {
      price,
      change: +change.toFixed(4),
      changePct: +changePct.toFixed(4),
      volume: Number(t.day?.v ?? 0),
    };
  } catch (e) {
    console.error(`[massive] ${symbol}`, e);
    return null;
  }
}

async function fetchAlpha(symbol: string): Promise<{ price: number; change: number; changePct: number; volume: number } | null> {
  if (!ALPHA_KEY) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const q = d["Global Quote"] ?? {};
    const price = Number(q["05. price"]);
    if (!isFinite(price) || price === 0) return null;
    const change = Number(q["09. change"] ?? 0);
    const changePctStr = String(q["10. change percent"] ?? "0%").replace("%", "");
    return {
      price,
      change,
      changePct: Number(changePctStr),
      volume: Number(q["06. volume"] ?? 0),
    };
  } catch (e) {
    console.error(`[alpha] ${symbol}`, e);
    return null;
  }
}

function verify(symbol: string, primary: any, secondary: any): VerifiedQuote {
  const now = new Date().toISOString();
  if (!primary && !secondary) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      primary: null, secondary: null, primarySource: null, secondarySource: null,
      status: "unavailable", diffPct: null, updatedAt: now,
      error: "Both providers failed",
    };
  }
  const src = primary ?? secondary;
  let status: VerifiedQuote["status"] = "verified";
  let diff: number | null = null;
  if (primary && secondary) {
    diff = Math.abs((primary.price - secondary.price) / primary.price) * 100;
    if (diff < 0.25) status = "verified";
    else if (diff < 1) status = "close";
    else status = "mismatch";
  } else {
    status = "stale"; // only one source
  }
  return {
    symbol,
    price: src.price,
    change: src.change,
    changePct: src.changePct,
    volume: src.volume,
    primary: primary?.price ?? null,
    secondary: secondary?.price ?? null,
    primarySource: primary ? "massive" : null,
    secondarySource: secondary ? "alpha-vantage" : null,
    status,
    diffPct: diff,
    updatedAt: now,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let symbols: string[] = [];
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      symbols = Array.isArray(body.symbols) ? body.symbols : [];
    } else {
      const u = new URL(req.url);
      const s = u.searchParams.get("symbols");
      symbols = s ? s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
    }
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ error: "symbols required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (symbols.length > 30) symbols = symbols.slice(0, 30);

    const results = await Promise.all(
      symbols.map(async (sym) => {
        const [p, s] = await Promise.all([fetchMassive(sym), fetchAlpha(sym)]);
        return verify(sym, p, s);
      })
    );

    return new Response(JSON.stringify({ quotes: results, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("quotes-fetch fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
