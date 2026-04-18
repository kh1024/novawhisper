// Verified quotes via 3 sources: Massive (primary), Alpha Vantage, Finnhub.
// Consensus: 3 agree → verified · 2 of 3 agree → close · all disagree → mismatch · only 1 returned → stale · none → unavailable.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");
const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");

type SourceName = "massive" | "alpha-vantage" | "finnhub";

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
  agreeCount: number;
  status: "verified" | "close" | "mismatch" | "stale" | "unavailable";
  maxDiffPct: number | null;
  updatedAt: string;
  error?: string;
}

async function fetchMassive(symbol: string): Promise<SourceQuote | null> {
  if (!MASSIVE_KEY) return null;
  try {
    const url = `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" } });
    if (!r.ok) {
      console.warn(`[massive] ${symbol} HTTP ${r.status}`);
      return null;
    }
    const d = await r.json();
    const t = d.ticker ?? d.results ?? {};
    const price = Number(t.lastTrade?.p ?? t.day?.c ?? t.min?.c);
    const prev = Number(t.prevDay?.c);
    if (!isFinite(price) || price === 0) return null;
    const change = isFinite(prev) && prev > 0 ? price - prev : Number(t.todaysChange ?? 0);
    const changePct = isFinite(prev) && prev > 0 ? (change / prev) * 100 : Number(t.todaysChangePerc ?? 0);
    return { source: "massive", price, change: +change.toFixed(4), changePct: +changePct.toFixed(4), volume: Number(t.day?.v ?? 0) };
  } catch (e) {
    console.error(`[massive] ${symbol}`, e);
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
    const change = Number(q["09. change"] ?? 0);
    const changePct = Number(String(q["10. change percent"] ?? "0%").replace("%", ""));
    return { source: "alpha-vantage", price, change, changePct, volume: Number(q["06. volume"] ?? 0) };
  } catch (e) {
    console.error(`[alpha] ${symbol}`, e);
    return null;
  }
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
    // Finnhub: c=current, d=change, dp=change %, pc=prev close, t=ts
    const price = Number(d.c);
    if (!isFinite(price) || price === 0) return null;
    return {
      source: "finnhub",
      price,
      change: Number(d.d ?? 0),
      changePct: Number(d.dp ?? 0),
      volume: 0, // Finnhub /quote does not include volume; left at 0.
    };
  } catch (e) {
    console.error(`[finnhub] ${symbol}`, e);
    return null;
  }
}

function verify(symbol: string, quotes: (SourceQuote | null)[]): VerifiedQuote {
  const now = new Date().toISOString();
  const valid = quotes.filter((q): q is SourceQuote => q !== null);
  const sources: Record<SourceName, number | null> = {
    massive: null, "alpha-vantage": null, finnhub: null,
  };
  for (const q of valid) sources[q.source] = q.price;

  if (valid.length === 0) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      sources, consensusSource: null, agreeCount: 0,
      status: "unavailable", maxDiffPct: null, updatedAt: now,
      error: "All providers failed",
    };
  }

  // Compute pairwise max diff
  let maxDiff = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const d = Math.abs((valid[i].price - valid[j].price) / valid[i].price) * 100;
      if (d > maxDiff) maxDiff = d;
    }
  }

  // Count agreement (within 0.5%) per source vs the others
  const TOL = 0.5; // %
  const agreement = valid.map((q) =>
    valid.filter((other) => other !== q && Math.abs((q.price - other.price) / q.price) * 100 < TOL).length + 1
  );
  const bestIdx = agreement.indexOf(Math.max(...agreement));
  const best = valid[bestIdx];
  const agreeCount = agreement[bestIdx];

  let status: VerifiedQuote["status"];
  if (valid.length === 1) status = "stale";
  else if (agreeCount >= 3) status = "verified";
  else if (agreeCount === 2) status = "close";
  else status = "mismatch";

  // Prefer Massive when tied (it's the primary)
  const massiveQ = valid.find((q) => q.source === "massive");
  const consensus = (massiveQ && Math.abs((massiveQ.price - best.price) / best.price) * 100 < TOL) ? massiveQ : best;

  return {
    symbol,
    price: consensus.price,
    change: consensus.change,
    changePct: consensus.changePct,
    volume: Math.max(...valid.map((q) => q.volume)),
    sources,
    consensusSource: consensus.source,
    agreeCount,
    status,
    maxDiffPct: +maxDiff.toFixed(4),
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
        const [m, a, f] = await Promise.all([fetchMassive(sym), fetchAlpha(sym), fetchFinnhub(sym)]);
        return verify(sym, [m, a, f]);
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
