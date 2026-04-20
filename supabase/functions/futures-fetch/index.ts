// Pre-market index futures (Dow / S&P 500 / Nasdaq) via Yahoo Finance public quote API.
// No key required. Cached 30s in-memory per isolate.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FuturesQuote {
  symbol: string;        // e.g. "ES=F"
  label: string;         // friendly: "S&P 500 Futures"
  price: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  updatedAt: string;
}

const SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "YM=F", label: "Dow Futures" },
  { symbol: "ES=F", label: "S&P 500 Futures" },
  { symbol: "NQ=F", label: "Nasdaq Futures" },
];

const TTL_MS = 30_000;
const cache = new Map<string, { q: FuturesQuote; at: number }>();

async function fetchYahoo(symbol: string, label: string): Promise<FuturesQuote> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.q;

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NovaWhisper/1.0)",
        Accept: "application/json",
      },
    });
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const j = await r.json();
    const row = j?.quoteResponse?.result?.[0];
    if (!row) throw new Error("no row");
    const price = Number(row.regularMarketPrice ?? row.postMarketPrice ?? row.preMarketPrice);
    const prev = Number(row.regularMarketPreviousClose ?? row.previousClose ?? price);
    const change = Number.isFinite(row.regularMarketChange) ? Number(row.regularMarketChange) : price - prev;
    const changePct = Number.isFinite(row.regularMarketChangePercent)
      ? Number(row.regularMarketChangePercent)
      : prev ? ((price - prev) / prev) * 100 : 0;
    const q: FuturesQuote = {
      symbol,
      label,
      price: Number.isFinite(price) ? price : null,
      change: Number.isFinite(change) ? change : null,
      changePct: Number.isFinite(changePct) ? changePct : null,
      marketState: row.marketState ?? null,
      updatedAt: new Date().toISOString(),
    };
    cache.set(symbol, { q, at: Date.now() });
    return q;
  } catch (e) {
    return {
      symbol, label,
      price: null, change: null, changePct: null,
      marketState: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const quotes = await Promise.all(SYMBOLS.map((s) => fetchYahoo(s.symbol, s.label)));
    return new Response(JSON.stringify({ quotes, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
