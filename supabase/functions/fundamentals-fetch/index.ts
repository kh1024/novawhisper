// Free fundamentals via Yahoo's v7/quote endpoint (no crumb required, no key).
// quoteSummary v10 now returns 401 without a session cookie/crumb, but the
// /v7/finance/quote endpoint exposes most of the same fields and is reliable
// from server contexts. Cached 6h since fundamentals don't change intraday.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const TTL_MS = 6 * 60 * 60_000;
const cache = new Map<string, { data: any; at: number }>();

function n(x: any): number | null {
  if (x == null || x === "") return null;
  const v = Number(x);
  return isFinite(v) ? v : null;
}
function s(x: any): string | null {
  if (x == null) return null;
  const v = String(x).trim();
  return v || null;
}

async function fetchFundamentals(symbol: string) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  // v7/quote returns ~80 fields per symbol — covers everything we need
  // except long business summary (which we leave out — link to website instead).
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=symbol,longName,shortName,fullExchangeName,marketCap,sharesOutstanding,floatShares,trailingPE,forwardPE,priceToBook,priceToSalesTrailing12Months,epsTrailingTwelveMonths,epsForward,bookValue,dividendYield,trailingAnnualDividendYield,dividendRate,trailingAnnualDividendRate,payoutRatio,beta,fiftyTwoWeekHigh,fiftyTwoWeekLow,averageDailyVolume3Month,averageDailyVolume10Day,fiftyDayAverage,twoHundredDayAverage,profitMargins,returnOnEquity,revenueGrowth,earningsGrowth,debtToEquity,quickRatio,currentRatio,totalCash,totalDebt,targetMeanPrice,targetHighPrice,targetLowPrice,recommendationKey,recommendationMean,numberOfAnalystOpinions`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NovaTerminal/1.0)",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!r.ok) throw new Error(`Yahoo v7/quote HTTP ${r.status}`);
  const d = await r.json();
  const row = d?.quoteResponse?.result?.[0];
  if (!row) throw new Error("No fundamentals returned");

  const out = {
    symbol,
    name: s(row.longName) ?? s(row.shortName),
    exchange: s(row.fullExchangeName),
    sector: null as string | null,    // not in v7/quote — exposed via separate scraper if needed
    industry: null as string | null,
    country: null as string | null,
    employees: null as number | null,
    website: null as string | null,
    summary: null as string | null,

    marketCap: n(row.marketCap),
    sharesOutstanding: n(row.sharesOutstanding),
    floatShares: n(row.floatShares),

    peTrailing: n(row.trailingPE),
    peForward: n(row.forwardPE),
    pegRatio: null,
    priceToBook: n(row.priceToBook),
    priceToSales: n(row.priceToSalesTrailing12Months),

    epsTrailing: n(row.epsTrailingTwelveMonths),
    epsForward: n(row.epsForward),

    // Yahoo v7 returns dividendYield as a percent (e.g. 0.45 = 0.45%, NOT 45%).
    // Normalize to a fraction so client formatter (which multiplies × 100) works.
    dividendYield: n(row.dividendYield) != null ? (n(row.dividendYield) as number) / 100 : null,
    dividendRate: n(row.dividendRate) ?? n(row.trailingAnnualDividendRate),
    payoutRatio: n(row.payoutRatio),

    beta: n(row.beta),
    week52High: n(row.fiftyTwoWeekHigh),
    week52Low: n(row.fiftyTwoWeekLow),
    avgVolume: n(row.averageDailyVolume3Month) ?? n(row.averageDailyVolume10Day),

    profitMargins: n(row.profitMargins),
    operatingMargins: null,
    returnOnEquity: n(row.returnOnEquity),
    revenueGrowth: n(row.revenueGrowth),
    earningsGrowth: n(row.earningsGrowth),
    debtToEquity: n(row.debtToEquity),
    currentRatio: n(row.currentRatio),
    totalCash: n(row.totalCash),
    totalDebt: n(row.totalDebt),

    targetMeanPrice: n(row.targetMeanPrice),
    targetHighPrice: n(row.targetHighPrice),
    targetLowPrice: n(row.targetLowPrice),
    recommendationKey: s(row.recommendationKey),
    numberOfAnalystOpinions: n(row.numberOfAnalystOpinions),

    fetchedAt: new Date().toISOString(),
    source: "yahoo-finance",
  };

  cache.set(symbol, { data: out, at: Date.now() });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let symbol = url.searchParams.get("symbol");
    if (!symbol && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      symbol = body.symbol;
    }
    if (!symbol || typeof symbol !== "string") {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await fetchFundamentals(symbol.toUpperCase());
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
