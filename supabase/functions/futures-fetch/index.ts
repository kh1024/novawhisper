// Pre-market index futures (Dow / S&P 500 / Nasdaq) via CNBC's open quote API.
// CNBC continuous-future symbols: @DJ.1 (Dow), @SP.1 (S&P), @ND.1 (Nasdaq).
// No API key required. Cached 30s in-memory per isolate.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FuturesQuote {
  symbol: string;        // friendly: "ES=F"
  cnbcSymbol: string;    // upstream: "@SP.1"
  label: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  lastTime: string | null;
  updatedAt: string;
}

const SYMBOLS: { symbol: string; cnbc: string; label: string }[] = [
  { symbol: "YM=F", cnbc: "@DJ.1", label: "Dow Futures" },
  { symbol: "ES=F", cnbc: "@SP.1", label: "S&P 500 Futures" },
  { symbol: "NQ=F", cnbc: "@ND.1", label: "Nasdaq Futures" },
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

async function fetchAll(): Promise<FuturesQuote[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.quotes;
  const symbolsParam = SYMBOLS.map((s) => s.cnbc).join("|");
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbolsParam)}&requestMethod=quick&output=json`;
  let rows: any[] = [];
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NovaWhisper/1.0)", Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`CNBC HTTP ${r.status}`);
    const j = await r.json();
    rows = j?.FormattedQuoteResult?.FormattedQuote ?? [];
  } catch (_) {
    rows = [];
  }
  const byCnbc = new Map(rows.map((r: any) => [String(r.symbol), r]));
  const quotes: FuturesQuote[] = SYMBOLS.map(({ symbol, cnbc, label }) => {
    const row = byCnbc.get(cnbc);
    return {
      symbol,
      cnbcSymbol: cnbc,
      label,
      price: num(row?.last),
      prevClose: num(row?.previous_day_closing),
      change: num(row?.change),
      changePct: pctNum(row?.change_pct),
      marketState: row?.curmktstatus ?? null,
      lastTime: row?.last_timedate ?? null,
      updatedAt: new Date().toISOString(),
    };
  });
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
