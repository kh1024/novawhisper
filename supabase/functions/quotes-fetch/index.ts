// Verified stock quotes via Finnhub (primary) + Alpha Vantage (verify, throttled).
// Strategy: in-memory cache (2 min TTL) avoids hammering free-tier APIs.
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

// ── In-memory caches (per isolate; resets on cold start) ──
// QUOTE_TTL is the floor: even if clients poll every 5s, upstream APIs only get hit
// when the cache expires. Free-tier Finnhub = 60 calls/min total; with 25 symbols
// a 30s TTL gives ~50 calls/min. Alpha Vantage free = 25 calls/DAY.
const QUOTE_TTL_MS = 30_000;
const FINNHUB_TTL_MS = 30_000;
const ALPHA_TTL_MS = 60 * 60_000; // 1 hour — Alpha free is 25/day
const quoteCache = new Map<string, { quote: VerifiedQuote; at: number }>();
const finnhubCache = new Map<string, { q: SourceQuote | null; at: number }>();
const alphaCache = new Map<string, { q: SourceQuote | null; at: number }>();

// Alpha Vantage requires ≤1 req/sec; serialize with a queue
let alphaChain: Promise<unknown> = Promise.resolve();
function throttleAlpha<T>(fn: () => Promise<T>): Promise<T> {
  const next = alphaChain.then(async () => {
    const out = await fn();
    await new Promise((r) => setTimeout(r, 1100));
    return out;
  });
  alphaChain = next.catch(() => undefined);
  return next as Promise<T>;
}

async function fetchFinnhub(symbol: string): Promise<SourceQuote | null> {
  if (!FINNHUB_KEY) return null;
  const cached = finnhubCache.get(symbol);
  if (cached && Date.now() - cached.at < FINNHUB_TTL_MS) return cached.q;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url);
    if (r.status === 429) {
      // Rate-limited: keep the previous good value if any (don't poison the cache with null),
      // and back off for 60s so we don't keep spamming.
      console.warn(`[finnhub] ${symbol} 429 rate-limit — backing off 60s`);
      const prev = cached?.q ?? null;
      finnhubCache.set(symbol, { q: prev, at: Date.now() - FINNHUB_TTL_MS + 60_000 });
      return prev;
    }
    if (!r.ok) {
      console.warn(`[finnhub] ${symbol} HTTP ${r.status}`);
      finnhubCache.set(symbol, { q: cached?.q ?? null, at: Date.now() - FINNHUB_TTL_MS + 30_000 });
      return cached?.q ?? null;
    }
    const d = await r.json();
    const price = Number(d.c);
    if (!isFinite(price) || price === 0) {
      finnhubCache.set(symbol, { q: cached?.q ?? null, at: Date.now() });
      return cached?.q ?? null;
    }
    const q: SourceQuote = { source: "finnhub", price, change: Number(d.d ?? 0), changePct: Number(d.dp ?? 0), volume: 0 };
    finnhubCache.set(symbol, { q, at: Date.now() });
    return q;
  } catch (e) {
    console.error(`[finnhub] ${symbol}`, e);
    return cached?.q ?? null;
  }
}

async function fetchAlpha(symbol: string): Promise<SourceQuote | null> {
  if (!ALPHA_KEY) return null;
  const cached = alphaCache.get(symbol);
  if (cached && Date.now() - cached.at < ALPHA_TTL_MS) return cached.q;
  return throttleAlpha(async () => {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_KEY}`;
      const r = await fetch(url);
      if (!r.ok) {
        alphaCache.set(symbol, { q: null, at: Date.now() });
        return null;
      }
      const d = await r.json();
      const q = d["Global Quote"] ?? {};
      const price = Number(q["05. price"]);
      if (!isFinite(price) || price === 0) {
        if (d.Note || d.Information) console.warn(`[alpha] ${symbol} ${d.Note ?? d.Information}`);
        // Long cache on quota-exhausted to stop retry loops
        alphaCache.set(symbol, { q: null, at: Date.now() });
        return null;
      }
      const out: SourceQuote = {
        source: "alpha-vantage",
        price,
        change: Number(q["09. change"] ?? 0),
        changePct: Number(String(q["10. change percent"] ?? "0%").replace("%", "")),
        volume: Number(q["06. volume"] ?? 0),
      };
      alphaCache.set(symbol, { q: out, at: Date.now() });
      return out;
    } catch (e) {
      console.error(`[alpha] ${symbol}`, e);
      return null;
    }
  });
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

async function getQuote(sym: string, verifyWithAlpha: boolean): Promise<VerifiedQuote> {
  const cached = quoteCache.get(sym);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;
  const finn = await fetchFinnhub(sym);
  const alpha = verifyWithAlpha ? await fetchAlpha(sym) : (alphaCache.get(sym)?.q ?? null);
  const v = verify(sym, finn, alpha);
  quoteCache.set(sym, { quote: v, at: Date.now() });
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let symbols: string[] = [];
    let verifyAll = false;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      symbols = Array.isArray(body.symbols) ? body.symbols : [];
      verifyAll = body.verify === true;
    } else {
      const u = new URL(req.url);
      const s = u.searchParams.get("symbols");
      symbols = s ? s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
      verifyAll = u.searchParams.get("verify") === "1";
    }
    if (symbols.length === 0) {
      return new Response(JSON.stringify({ error: "symbols required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (symbols.length > 30) symbols = symbols.slice(0, 30);

    // Verify with Alpha only when explicitly requested OR for tiny single-symbol requests (drawer use case).
    const useAlpha = verifyAll || symbols.length === 1;

    const results = await Promise.all(symbols.map((sym) => getQuote(sym, useAlpha)));
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
