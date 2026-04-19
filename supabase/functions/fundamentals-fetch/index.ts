// Free fundamentals via Yahoo Finance quoteSummary (no key required).
// Returns: market cap, P/E (trailing/forward), EPS, dividend yield, beta,
// 52w range, sector/industry, target price, recommendation key.
//
// Yahoo's quoteSummary endpoint is unofficial — we set a UA and cache 6h
// since fundamentals don't change intraday.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const TTL_MS = 6 * 60 * 60_000; // 6h
const cache = new Map<string, { data: any; at: number }>();

const MODULES = [
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "price",
].join(",");

function v(x: any): number | null {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object" && "raw" in x) {
    const n = Number(x.raw);
    return isFinite(n) ? n : null;
  }
  const n = Number(x);
  return isFinite(n) ? n : null;
}

function s(x: any): string | null {
  if (x == null) return null;
  if (typeof x === "string") return x || null;
  if (typeof x === "object" && "fmt" in x) return String(x.fmt) || null;
  return String(x) || null;
}

async function fetchFundamentals(symbol: string) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NovaTerminal/1.0)",
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    throw new Error(`Yahoo quoteSummary HTTP ${r.status}`);
  }
  const d = await r.json();
  const result = d?.quoteSummary?.result?.[0];
  if (!result) throw new Error("No fundamentals returned");

  const sd = result.summaryDetail ?? {};
  const ks = result.defaultKeyStatistics ?? {};
  const fd = result.financialData ?? {};
  const ap = result.assetProfile ?? {};
  const pr = result.price ?? {};

  const out = {
    symbol,
    name: s(pr.longName) ?? s(pr.shortName),
    sector: s(ap.sector),
    industry: s(ap.industry),
    country: s(ap.country),
    employees: v(ap.fullTimeEmployees),
    website: s(ap.website),
    summary: s(ap.longBusinessSummary),

    marketCap: v(sd.marketCap) ?? v(pr.marketCap),
    sharesOutstanding: v(ks.sharesOutstanding),
    floatShares: v(ks.floatShares),

    peTrailing: v(sd.trailingPE),
    peForward: v(sd.forwardPE) ?? v(ks.forwardPE),
    pegRatio: v(ks.pegRatio),
    priceToBook: v(ks.priceToBook),
    priceToSales: v(sd.priceToSalesTrailing12Months),

    epsTrailing: v(ks.trailingEps),
    epsForward: v(ks.forwardEps),

    dividendYield: v(sd.dividendYield),
    dividendRate: v(sd.dividendRate),
    payoutRatio: v(sd.payoutRatio),

    beta: v(sd.beta) ?? v(ks.beta),
    week52High: v(sd.fiftyTwoWeekHigh),
    week52Low: v(sd.fiftyTwoWeekLow),
    avgVolume: v(sd.averageVolume),

    profitMargins: v(fd.profitMargins) ?? v(ks.profitMargins),
    operatingMargins: v(fd.operatingMargins),
    returnOnEquity: v(fd.returnOnEquity),
    revenueGrowth: v(fd.revenueGrowth),
    earningsGrowth: v(fd.earningsGrowth),
    debtToEquity: v(fd.debtToEquity),
    currentRatio: v(fd.currentRatio),
    totalCash: v(fd.totalCash),
    totalDebt: v(fd.totalDebt),

    targetMeanPrice: v(fd.targetMeanPrice),
    targetHighPrice: v(fd.targetHighPrice),
    targetLowPrice: v(fd.targetLowPrice),
    recommendationKey: s(fd.recommendationKey),
    numberOfAnalystOpinions: v(fd.numberOfAnalystOpinions),

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
    if (!symbol && (req.method === "POST")) {
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
