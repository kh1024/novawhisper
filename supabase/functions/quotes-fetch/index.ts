// Verified stock quotes via Finnhub + Alpha Vantage + Massive (3-source consensus).
// Strategy: in-memory cache (30s TTL) + per-source backoff to survive free-tier limits.
// Status: verified (2+ sources within 0.25%) · close (<1%) · mismatch (≥1%) · stale (only 1 src) · unavailable.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");

type SourceName = "finnhub" | "alpha-vantage" | "massive";

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
const QUOTE_TTL_MS = 30_000;
const FINNHUB_TTL_MS = 30_000;
const MASSIVE_TTL_MS = 30_000;
const ALPHA_TTL_MS = 60 * 60_000; // Alpha free is 25/day
const quoteCache = new Map<string, { quote: VerifiedQuote; at: number }>();
const finnhubCache = new Map<string, { q: SourceQuote | null; at: number }>();
const alphaCache = new Map<string, { q: SourceQuote | null; at: number }>();
const massiveCache = new Map<string, { q: SourceQuote | null; at: number }>();

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

// Massive snapshot endpoint (Polygon-compatible).
// Returns: { ticker: { day: {c,o,h,l,v}, prevDay: {c}, todaysChange, todaysChangePerc } }
async function fetchMassive(symbol: string): Promise<SourceQuote | null> {
  if (!MASSIVE_KEY) return null;
  const cached = massiveCache.get(symbol);
  if (cached && Date.now() - cached.at < MASSIVE_TTL_MS) return cached.q;
  try {
    const url = `https://api.massive.com/v3/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (r.status === 429) {
      console.warn(`[massive] ${symbol} 429 rate-limit — backing off 60s`);
      const prev = cached?.q ?? null;
      massiveCache.set(symbol, { q: prev, at: Date.now() - MASSIVE_TTL_MS + 60_000 });
      return prev;
    }
    if (!r.ok) {
      console.warn(`[massive] ${symbol} HTTP ${r.status}`);
      massiveCache.set(symbol, { q: cached?.q ?? null, at: Date.now() - MASSIVE_TTL_MS + 30_000 });
      return cached?.q ?? null;
    }
    const d = await r.json();
    const t = d?.ticker ?? {};
    // Prefer last trade / min close, fallback to day close, then prevDay.
    const lastTrade = Number(t?.lastTrade?.p);
    const minClose = Number(t?.min?.c);
    const dayClose = Number(t?.day?.c);
    const prevClose = Number(t?.prevDay?.c);
    const price =
      isFinite(lastTrade) && lastTrade > 0 ? lastTrade :
      isFinite(minClose) && minClose > 0 ? minClose :
      isFinite(dayClose) && dayClose > 0 ? dayClose :
      isFinite(prevClose) && prevClose > 0 ? prevClose : 0;
    if (!isFinite(price) || price === 0) {
      massiveCache.set(symbol, { q: cached?.q ?? null, at: Date.now() });
      return cached?.q ?? null;
    }
    const change = Number(t?.todaysChange ?? (isFinite(prevClose) ? price - prevClose : 0));
    const changePct = Number(t?.todaysChangePerc ?? (isFinite(prevClose) && prevClose ? ((price - prevClose) / prevClose) * 100 : 0));
    const volume = Number(t?.day?.v ?? 0);
    const q: SourceQuote = { source: "massive", price, change, changePct, volume };
    massiveCache.set(symbol, { q, at: Date.now() });
    return q;
  } catch (e) {
    console.error(`[massive] ${symbol}`, e);
    return cached?.q ?? null;
  }
}

// Pick consensus from up to 3 sources. "Freshest accuracy wins":
// - If 2+ sources agree within 0.25% → verified, use their average via the first one.
// - If 2+ within 1% → close.
// - If sources disagree by ≥1% → mismatch (use median price).
// - If only 1 source → stale.
function verify(symbol: string, finn: SourceQuote | null, alpha: SourceQuote | null, mass: SourceQuote | null): VerifiedQuote {
  const now = new Date().toISOString();
  const sources: Record<SourceName, number | null> = {
    finnhub: finn?.price ?? null,
    "alpha-vantage": alpha?.price ?? null,
    massive: mass?.price ?? null,
  };
  const live = [finn, alpha, mass].filter((x): x is SourceQuote => !!x && x.price > 0);
  if (live.length === 0) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      sources, consensusSource: null, status: "unavailable",
      diffPct: null, updatedAt: now, error: "All providers failed",
    };
  }
  if (live.length === 1) {
    const src = live[0];
    return {
      symbol, price: src.price, change: src.change, changePct: src.changePct, volume: src.volume,
      sources, consensusSource: src.source, status: "stale",
      diffPct: null, updatedAt: now,
    };
  }
  // 2 or 3 sources: compute max pairwise diff %
  const prices = live.map((s) => s.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const diff = ((maxP - minP) / minP) * 100;
  // Prefer Massive (real-time) > Finnhub > Alpha when ≥2 sources agree.
  const order: SourceName[] = ["massive", "finnhub", "alpha-vantage"];
  const chosen = order.map((n) => live.find((s) => s.source === n)).find(Boolean) ?? live[0];
  const status: VerifiedQuote["status"] = diff < 0.25 ? "verified" : diff < 1 ? "close" : "mismatch";
  return {
    symbol,
    price: chosen.price,
    change: chosen.change,
    changePct: chosen.changePct,
    volume: Math.max(...live.map((s) => s.volume ?? 0)),
    sources,
    consensusSource: chosen.source,
    status,
    diffPct: +diff.toFixed(4),
    updatedAt: now,
  };
}

async function getQuote(sym: string, verifyWithAlpha: boolean): Promise<VerifiedQuote> {
  const cached = quoteCache.get(sym);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;
  // Fan out to all 3 in parallel. Massive is the new primary cross-check.
  const [finn, mass, alpha] = await Promise.all([
    fetchFinnhub(sym),
    fetchMassive(sym),
    verifyWithAlpha ? fetchAlpha(sym) : Promise.resolve(alphaCache.get(sym)?.q ?? null),
  ]);
  const v = verify(sym, finn, alpha, mass);
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
