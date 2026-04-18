// Verified stock quotes via Finnhub (primary) + Alpha Vantage (verify).
// Status: verified (within 0.25%) · close (<1%) · mismatch (≥1%) · stale (only 1 src) · unavailable.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");

type SourceName = "finnhub" | "alpha-vantage";

interface SourceQuote {
  source: SourceName;
  price: number;
  change: number;
  changePct: number;
  volume: number;
}

interface VerifiedQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  sources: Record<SourceName, number | null>;
  consensusSource: SourceName | null;
  status: "verified" | "close" | "mismatch" | "stale" | "unavailable";
  diffPct: number | null;
  updatedAt: string;
  error?: string;
}

async function fetchFinnhub(symbol: string): Promise<SourceQuote | null> {
  if (!FINNHUB_KEY) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`[finnhub] ${symbol} HTTP ${r.status}`);
      return null;
    }
    const d = await r.json();
    const price = Number(d.c);
    if (!isFinite(price) || price === 0) return null;
    return { source: "finnhub", price, change: Number(d.d ?? 0), changePct: Number(d.dp ?? 0), volume: 0 };
  } catch (e) {
    console.error(`[finnhub] ${symbol}`, e);
    return null;
  }
}

async function fetchAlpha(symbol: string): Promise<SourceQuote | null> {
  if (!ALPHA_KEY) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const q = d["Global Quote"] ?? {};
    const price = Number(q["05. price"]);
    if (!isFinite(price) || price === 0) {
      if (d.Note || d.Information) console.warn(`[alpha] ${symbol} ${d.Note ?? d.Information}`);
      return null;
    }
    return {
      source: "alpha-vantage",
      price,
      change: Number(q["09. change"] ?? 0),
      changePct: Number(String(q["10. change percent"] ?? "0%").replace("%", "")),
      volume: Number(q["06. volume"] ?? 0),
    };
  } catch (e) {
    console.error(`[alpha] ${symbol}`, e);
    return null;
  }
}

function verify(symbol: string, primary: SourceQuote | null, secondary: SourceQuote | null): VerifiedQuote {
  const now = new Date().toISOString();
  const sources: Record<SourceName, number | null> = {
    finnhub: primary?.price ?? null,
    "alpha-vantage": secondary?.price ?? null,
  };
  if (!primary && !secondary) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      sources, consensusSource: null, status: "unavailable",
      diffPct: null, updatedAt: now, error: "Both providers failed",
    };
  }
  const src = primary ?? secondary!;
  let status: VerifiedQuote["status"] = "stale";
  let diff: number | null = null;
  if (primary && secondary) {
    diff = Math.abs((primary.price - secondary.price) / primary.price) * 100;
    status = diff < 0.25 ? "verified" : diff < 1 ? "close" : "mismatch";
  }
  return {
    symbol,
    price: src.price,
    change: src.change,
    changePct: src.changePct,
    volume: Math.max(primary?.volume ?? 0, secondary?.volume ?? 0),
    sources,
    consensusSource: src.source,
    status,
    diffPct: diff !== null ? +diff.toFixed(4) : null,
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
        const [p, s] = await Promise.all([fetchFinnhub(sym), fetchAlpha(sym)]);
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
