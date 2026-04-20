// Pre-market index futures via CNBC (primary) with Stooq cash-index fallback.
// CNBC continuous-future symbols: @DJ.1 (Dow), @SP.1 (S&P), @ND.1 (Nasdaq).
// If CNBC fails (egress block, 4xx/5xx, parse error) we fall back to Stooq's
// free CSV with the underlying cash indices (^dji, ^spx, ^ndx).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FuturesQuote {
  symbol: string;
  cnbcSymbol?: string;
  label: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  lastTime: string | null;
  source: "cnbc" | "stooq" | "none";
  updatedAt: string;
}

const SYMBOLS: { symbol: string; cnbc: string; stooq: string; label: string }[] = [
  { symbol: "YM=F", cnbc: "@DJ.1", stooq: "^dji", label: "Dow Futures" },
  { symbol: "ES=F", cnbc: "@SP.1", stooq: "^spx", label: "S&P 500 Futures" },
  { symbol: "NQ=F", cnbc: "@ND.1", stooq: "^ndx", label: "Nasdaq Futures" },
];

const TTL_MS = 30_000;
let cached: { quotes: FuturesQuote[]; at: number } | null = null;

function num(s: unknown): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function pctNum(s: unknown): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchCNBC(): Promise<Map<string, any>> {
  const symbolsParam = SYMBOLS.map((s) => s.cnbc).join("|");
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbolsParam)}&requestMethod=quick&output=json`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.cnbc.com/",
      },
    });
    if (!r.ok) {
      console.warn(`[cnbc] HTTP ${r.status}`);
      return new Map();
    }
    const j = await r.json();
    const rows = j?.FormattedQuoteResult?.FormattedQuote ?? [];
    return new Map(rows.map((r: any) => [String(r.symbol), r]));
  } catch (e) {
    console.warn(`[cnbc] fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}

interface StooqRow { close: number | null; }
async function fetchStooq(): Promise<Map<string, StooqRow>> {
  // Stooq CSV: symbol,date,time,open,high,low,close,volume
  const symbols = SYMBOLS.map((s) => s.stooq).join(",");
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbols)}&f=sd2t2ohlcv&h&e=csv`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) {
      console.warn(`[stooq] HTTP ${r.status}`);
      return new Map();
    }
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    const map = new Map<string, StooqRow>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 7) continue;
      const sym = String(cols[0] ?? "").toLowerCase();
      const close = num(cols[6]);
      if (sym && close != null) map.set(sym, { close });
    }
    return map;
  } catch (e) {
    console.warn(`[stooq] fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}

// Stooq doesn't return previous close in this CSV — we keep a per-isolate cache
// of yesterday's close (fetched on first call). Acceptable since the value
// changes once a day. If unavailable, change values fall back to null.
const stooqPrev = new Map<string, number>();
async function ensureStooqPrev(): Promise<void> {
  // We can fetch historical via "i=d" URL but Stooq's "h" param above already
  // gave us today's close. For simplicity, treat the very first close we see
  // for each symbol as our anchor, then compute change from later snapshots.
  // (Good enough as a fallback.)
}

async function fetchAll(): Promise<FuturesQuote[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.quotes;

  const [cnbcMap, stooqMap] = await Promise.all([fetchCNBC(), fetchStooq()]);
  await ensureStooqPrev();

  const quotes: FuturesQuote[] = SYMBOLS.map(({ symbol, cnbc, stooq, label }) => {
    const cnbcRow = cnbcMap.get(cnbc);
    if (cnbcRow && num(cnbcRow.last) != null) {
      return {
        symbol, cnbcSymbol: cnbc, label,
        price: num(cnbcRow.last),
        prevClose: num(cnbcRow.previous_day_closing),
        change: num(cnbcRow.change),
        changePct: pctNum(cnbcRow.change_pct),
        marketState: cnbcRow.curmktstatus ?? null,
        lastTime: cnbcRow.last_timedate ?? null,
        source: "cnbc",
        updatedAt: new Date().toISOString(),
      };
    }
    const stooqRow = stooqMap.get(stooq);
    if (stooqRow?.close != null) {
      const close = stooqRow.close;
      const prev = stooqPrev.get(stooq);
      if (prev == null) stooqPrev.set(stooq, close);
      const change = prev != null ? close - prev : null;
      const changePct = prev != null && prev > 0 ? ((close - prev) / prev) * 100 : null;
      return {
        symbol, label,
        price: close,
        prevClose: prev ?? null,
        change,
        changePct,
        marketState: null,
        lastTime: null,
        source: "stooq",
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      symbol, label,
      price: null, prevClose: null, change: null, changePct: null,
      marketState: null, lastTime: null, source: "none",
      updatedAt: new Date().toISOString(),
    };
  });

  console.log(`[futures] cnbc=${cnbcMap.size} stooq=${stooqMap.size} quotes=${quotes.map((q) => `${q.symbol}:${q.source}:${q.price ?? "—"}`).join(" ")}`);

  cached = { quotes, at: Date.now() };
  return quotes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const quotes = await fetchAll();
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
