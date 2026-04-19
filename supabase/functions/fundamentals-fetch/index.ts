// Free fundamentals via Finnhub (we already have FINNHUB_API_KEY).
// Yahoo's quote endpoints now require a crumb cookie from datacenter IPs,
// so we use Finnhub's /stock/profile2 + /stock/metric for stable, keyed access.
// Cached 6h since fundamentals don't change intraday.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
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
  if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not configured");
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const sym = encodeURIComponent(symbol);
  // Earnings calendar: look 120 days forward for the next scheduled report.
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const toDate = new Date(today.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  const [profileRes, metricRes, recRes, earnRes] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`),
    fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`),
    fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${sym}&token=${FINNHUB_KEY}`),
    fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${toDate}&symbol=${sym}&token=${FINNHUB_KEY}`),
  ]);
  if (!profileRes.ok) throw new Error(`Finnhub profile HTTP ${profileRes.status}`);
  if (!metricRes.ok) throw new Error(`Finnhub metric HTTP ${metricRes.status}`);

  const profile = await profileRes.json();
  const metricBody = await metricRes.json();
  const m = metricBody?.metric ?? {};
  const recArr = recRes.ok ? await recRes.json() : [];
  const rec = Array.isArray(recArr) && recArr.length > 0 ? recArr[0] : null;

  // Next earnings date — Finnhub returns { earningsCalendar: [{ date, symbol, ... }] }
  // Pick the soonest future date.
  let nextEarningsDate: string | null = null;
  let earningsInDays: number | null = null;
  if (earnRes.ok) {
    const earnBody = await earnRes.json().catch(() => ({}));
    const arr = Array.isArray(earnBody?.earningsCalendar) ? earnBody.earningsCalendar : [];
    const todayMs = Date.now();
    const future = arr
      .map((e: any) => e?.date as string | undefined)
      .filter((d: any): d is string => typeof d === "string" && d.length >= 10)
      .map((d: string) => ({ d, ms: new Date(d).getTime() }))
      .filter((x) => Number.isFinite(x.ms) && x.ms >= todayMs - 86_400_000)
      .sort((a, b) => a.ms - b.ms);
    if (future.length > 0) {
      nextEarningsDate = future[0].d;
      earningsInDays = Math.max(0, Math.floor((future[0].ms - todayMs) / 86_400_000));
    }
  }

  // Recommendation: derive a key from buy/hold/sell counts
  let recommendationKey: string | null = null;
  let analystCount: number | null = null;
  if (rec) {
    analystCount = (rec.strongBuy ?? 0) + (rec.buy ?? 0) + (rec.hold ?? 0) + (rec.sell ?? 0) + (rec.strongSell ?? 0);
    const buys = (rec.strongBuy ?? 0) + (rec.buy ?? 0);
    const sells = (rec.sell ?? 0) + (rec.strongSell ?? 0);
    const holds = rec.hold ?? 0;
    if (buys > holds && buys > sells) recommendationKey = (rec.strongBuy ?? 0) > (rec.buy ?? 0) ? "strong_buy" : "buy";
    else if (sells > holds && sells > buys) recommendationKey = "sell";
    else if (analystCount > 0) recommendationKey = "hold";
  }

  // Finnhub marketCap is in millions USD; normalize.
  const marketCap = n(profile.marketCapitalization);
  const out = {
    symbol,
    name: s(profile.name),
    exchange: s(profile.exchange),
    sector: s(profile.finnhubIndustry),
    industry: s(profile.finnhubIndustry),
    country: s(profile.country),
    employees: null as number | null,
    website: s(profile.weburl),
    summary: null as string | null,

    marketCap: marketCap != null ? marketCap * 1_000_000 : null,
    sharesOutstanding: n(profile.shareOutstanding) != null ? (n(profile.shareOutstanding) as number) * 1_000_000 : null,
    floatShares: n(m["sharesOutstanding"]) != null ? (n(m["sharesOutstanding"]) as number) * 1_000_000 : null,

    peTrailing: n(m["peTTM"]) ?? n(m["peNormalizedAnnual"]),
    peForward: n(m["peExclExtraTTM"]),
    pegRatio: n(m["pegRatio"]),
    priceToBook: n(m["pbAnnual"]) ?? n(m["pbQuarterly"]),
    priceToSales: n(m["psTTM"]),

    epsTrailing: n(m["epsTTM"]) ?? n(m["epsAnnual"]),
    epsForward: n(m["epsInclExtraItemsAnnual"]),

    // Finnhub returns dividendYield as percent (e.g. 0.45 = 0.45%) — normalize to fraction.
    dividendYield: n(m["currentDividendYieldTTM"]) != null
      ? (n(m["currentDividendYieldTTM"]) as number) / 100
      : null,
    dividendRate: n(m["dividendPerShareTTM"]),
    payoutRatio: n(m["payoutRatioTTM"]) != null
      ? (n(m["payoutRatioTTM"]) as number) / 100
      : null,

    beta: n(m["beta"]),
    week52High: n(m["52WeekHigh"]),
    week52Low: n(m["52WeekLow"]),
    avgVolume: n(m["10DayAverageTradingVolume"]) != null
      ? (n(m["10DayAverageTradingVolume"]) as number) * 1_000_000
      : null,

    profitMargins: n(m["netProfitMarginTTM"]) != null ? (n(m["netProfitMarginTTM"]) as number) / 100 : null,
    operatingMargins: n(m["operatingMarginTTM"]) != null ? (n(m["operatingMarginTTM"]) as number) / 100 : null,
    returnOnEquity: n(m["roeTTM"]) != null ? (n(m["roeTTM"]) as number) / 100 : null,
    revenueGrowth: n(m["revenueGrowthTTMYoy"]) != null ? (n(m["revenueGrowthTTMYoy"]) as number) / 100 : null,
    earningsGrowth: n(m["epsGrowthTTMYoy"]) != null ? (n(m["epsGrowthTTMYoy"]) as number) / 100 : null,
    debtToEquity: n(m["totalDebt/totalEquityAnnual"]) ?? n(m["totalDebt/totalEquityQuarterly"]),
    currentRatio: n(m["currentRatioAnnual"]) ?? n(m["currentRatioQuarterly"]),
    totalCash: n(m["cashPerSharePerShareAnnual"]),
    totalDebt: null as number | null,

    targetMeanPrice: null as number | null,
    targetHighPrice: null as number | null,
    targetLowPrice: null as number | null,
    recommendationKey,
    numberOfAnalystOpinions: analystCount,

    fetchedAt: new Date().toISOString(),
    source: "finnhub",
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
