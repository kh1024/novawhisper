// SEC EDGAR insider activity (Form 4) — completely free, official, no key.
// Flow:
//   1. ticker → CIK via EDGAR's company_tickers.json (cached 24h)
//   2. CIK → recent submissions (Form 4 = insider transactions)
//   3. Return last N filings with filer + filing URL
//
// SEC requires a descriptive User-Agent on all requests (their fair-use policy).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const UA = "NovaTerminal Research (contact@novawhisper.app)";
const SUBMISSIONS_TTL = 60 * 60_000; // 1h
const TICKERS_TTL = 24 * 60 * 60_000; // 24h

let tickerMap: Record<string, { cik: string; name: string }> | null = null;
let tickerMapAt = 0;
const subsCache = new Map<string, { data: any; at: number }>();

async function loadTickerMap() {
  if (tickerMap && Date.now() - tickerMapAt < TICKERS_TTL) return tickerMap;
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`EDGAR tickers HTTP ${r.status}`);
  const d = await r.json();
  const map: Record<string, { cik: string; name: string }> = {};
  for (const k of Object.keys(d)) {
    const row = d[k];
    if (!row?.ticker) continue;
    map[String(row.ticker).toUpperCase()] = {
      cik: String(row.cik_str).padStart(10, "0"),
      name: String(row.title ?? ""),
    };
  }
  tickerMap = map;
  tickerMapAt = Date.now();
  return map;
}

async function getSubmissions(cik: string) {
  const cached = subsCache.get(cik);
  if (cached && Date.now() - cached.at < SUBMISSIONS_TTL) return cached.data;
  const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`EDGAR submissions HTTP ${r.status}`);
  const d = await r.json();
  subsCache.set(cik, { data: d, at: Date.now() });
  return d;
}

interface InsiderFiling {
  accessionNumber: string;
  form: string;
  filedAt: string;
  reportingDate: string | null;
  primaryDocument: string;
  url: string;
  description: string;
}

async function fetchInsiders(symbol: string, limit = 15) {
  const map = await loadTickerMap();
  const entry = map[symbol];
  if (!entry) {
    return { symbol, cik: null, name: null, count: 0, filings: [] as InsiderFiling[] };
  }
  const subs = await getSubmissions(entry.cik);
  const recent = subs?.filings?.recent;
  if (!recent) return { symbol, cik: entry.cik, name: entry.name, count: 0, filings: [] };

  const forms: string[] = recent.form ?? [];
  const accessions: string[] = recent.accessionNumber ?? [];
  const dates: string[] = recent.filingDate ?? [];
  const reportDates: string[] = recent.reportDate ?? [];
  const primaryDocs: string[] = recent.primaryDocument ?? [];
  const descriptions: string[] = recent.primaryDocDescription ?? [];

  const out: InsiderFiling[] = [];
  const cikNum = entry.cik.replace(/^0+/, "");
  for (let i = 0; i < forms.length && out.length < limit; i++) {
    if (forms[i] !== "4") continue;
    const acc = accessions[i];
    const accNoDashes = acc.replace(/-/g, "");
    out.push({
      accessionNumber: acc,
      form: forms[i],
      filedAt: dates[i] ?? "",
      reportingDate: reportDates[i] || null,
      primaryDocument: primaryDocs[i] ?? "",
      url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${primaryDocs[i] ?? ""}`,
      description: descriptions[i] || "Insider transaction",
    });
  }

  return {
    symbol,
    cik: entry.cik,
    name: entry.name,
    count: out.length,
    filings: out,
    fetchedAt: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let symbol = url.searchParams.get("symbol");
    let limit = Number(url.searchParams.get("limit") ?? "15");
    if (!symbol && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      symbol = body.symbol;
      if (body.limit) limit = Number(body.limit);
    }
    if (!symbol || typeof symbol !== "string") {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!isFinite(limit) || limit < 1 || limit > 50) limit = 15;

    const data = await fetchInsiders(symbol.toUpperCase(), limit);
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
