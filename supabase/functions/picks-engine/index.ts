// AI Options Picks engine — scores 38 tickers using existing options-fetch +
// quotes-fetch + fundamentals-fetch and returns the top 10 calls / top 10 puts.
// 6-signal scoring per spec (momentum, analyst upside, consensus, IV sweet
// spot, OI liquidity, 52W position, strike moneyness for calls).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TICKERS = [
  "SPY","QQQ","NVDA","TSLA","AAPL","MSFT","AMZN","META","GOOGL","AMD",
  "PLTR","MSTR","SOFI","BAC","F","INTC","RIVN","NIO","COIN","HOOD",
  "GME","AMC","SMCI","ARM","CRWD","MU","NFLX","UBER","SQ","PYPL",
  "SHOP","MARA","RIOT","SOXL","TQQQ","GS","JPM","CRML",
];

type Analyst = { target: number; consensus: "Strong Buy" | "Hold"; bullPct: number };
const ANALYST: Record<string, Analyst> = {
  AAPL: { target: 330, consensus: "Strong Buy", bullPct: 100 },
  MSFT: { target: 522, consensus: "Strong Buy", bullPct: 100 },
  MSTR: { target: 287, consensus: "Strong Buy", bullPct: 100 },
  AMZN: { target: 298, consensus: "Strong Buy", bullPct: 100 },
  TSLA: { target: 450, consensus: "Strong Buy", bullPct: 75 },
  NVDA: { target: 297, consensus: "Strong Buy", bullPct: 100 },
  PLTR: { target: 199, consensus: "Strong Buy", bullPct: 80 },
  HOOD: { target: 114, consensus: "Strong Buy", bullPct: 80 },
  NFLX: { target: 115, consensus: "Strong Buy", bullPct: 75 },
  AMD:  { target: 246, consensus: "Hold",       bullPct: 0 },
  META: { target: 833, consensus: "Strong Buy", bullPct: 100 },
  GOOGL:{ target: 389, consensus: "Strong Buy", bullPct: 100 },
  INTC: { target: 63,  consensus: "Hold",       bullPct: 20 },
  SOFI: { target: 18,  consensus: "Hold",       bullPct: 0 },
};

interface Pick {
  ticker: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  price: number;
  chg: number;
  expiry: string;
  strike: number;
  last: number;
  bid: number;
  ask: number;
  oi: number;
  iv: number;
  analystTarget: number | null;
  upsideToTarget: number | null;
  reasons: string;
}

async function callFn(name: string, body: unknown): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: SERVICE_ROLE,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    await r.text().catch(() => "");
    return null;
  }
  try { return await r.json(); } catch { return null; }
}

interface SymbolData {
  price: number;
  chg: number;
  high52: number | null;
  low52: number | null;
  contracts: any[];
}

async function loadSymbol(symbol: string): Promise<SymbolData | null> {
  // Quote
  const q = await callFn("quotes-fetch", { symbols: [symbol] });
  const qrow = Array.isArray(q?.quotes) ? q.quotes[0] : Array.isArray(q) ? q[0] : null;
  const price = Number(qrow?.price ?? 0);
  const chg = Number(qrow?.changePct ?? 0);
  if (!price || !Number.isFinite(price)) return null;

  // Fundamentals (best-effort, may be null on rate limit)
  let high52: number | null = null;
  let low52: number | null = null;
  try {
    const f = await callFn("fundamentals-fetch", { symbol });
    high52 = Number.isFinite(f?.week52High) ? Number(f.week52High) : null;
    low52 = Number.isFinite(f?.week52Low) ? Number(f.week52Low) : null;
  } catch { /* ignore */ }

  // Options chain — limit 250 should cover 4 nearest expirations comfortably
  const opt = await callFn("options-fetch", { underlying: symbol, limit: 250 });
  const contracts = Array.isArray(opt?.contracts) ? opt.contracts : [];

  return { price, chg, high52, low52, contracts };
}

function nearestExpirations(contracts: any[], n = 4): string[] {
  const set = new Set<string>();
  for (const c of contracts) if (c.expiration) set.add(String(c.expiration));
  const sorted = [...set].sort();
  return sorted.slice(0, n);
}

interface Scored {
  pick: Pick;
  rawReasons: string[];
}

// Estimate option premium when bid/ask/last are all 0 (off-hours).
// Order of preference: real last → real mid → real (bid+ask)/2 → BS-lite estimate.
function estimatePremium(c: any, spot: number, type: "call" | "put", ivDecimal: number): number {
  const last = Number(c.last ?? 0);
  if (last > 0) return +last.toFixed(2);
  const mid = Number(c.mid ?? 0);
  if (mid > 0) return +mid.toFixed(2);
  const bid = Number(c.bid ?? 0);
  const ask = Number(c.ask ?? 0);
  if (bid > 0 && ask > 0) return +(((bid + ask) / 2)).toFixed(2);

  // Lightweight extrinsic estimate: intrinsic + 0.4 * S * IV * sqrt(T)
  const strike = Number(c.strike ?? 0);
  if (!strike || !spot) return 0;
  const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const dte = Number(c.dte ?? 0);
  const t = Math.max(1, dte) / 365;
  // Some providers return raw % (e.g. 10.8) instead of decimal; normalize.
  const iv = ivDecimal > 5 ? ivDecimal / 100 : ivDecimal;
  const safeIv = Math.max(0.1, Math.min(iv || 0.3, 2));
  const extrinsic = 0.4 * spot * safeIv * Math.sqrt(t);
  return +(intrinsic + extrinsic).toFixed(2);
}

function scoreCall(opts: {
  symbol: string; price: number; chg: number; high52: number | null; low52: number | null;
  c: any;
}): Scored {
  const { symbol, price, chg, high52, low52, c } = opts;
  const a = ANALYST[symbol] ?? null;
  const reasons: string[] = [];
  let score = 0;

  // Momentum
  if (chg >= 10) { score += 3; reasons.push(`🚀 Surging +${chg.toFixed(1)}%`); }
  else if (chg >= 5) { score += 2; reasons.push(`🚀 Surging +${chg.toFixed(1)}%`); }
  else if (chg >= 2) { score += 1; reasons.push(`🚀 +${chg.toFixed(1)}%`); }
  else if (chg <= -5) { score -= 2; }

  // Analyst upside
  let upside: number | null = null;
  if (a) {
    upside = ((a.target - price) / price) * 100;
    if (upside >= 30) { score += 3; reasons.push(`🎯 ${upside.toFixed(0)}% analyst upside`); }
    else if (upside >= 15) { score += 2; reasons.push(`🎯 ${upside.toFixed(0)}% analyst upside`); }
    else if (upside >= 5) { score += 1; reasons.push(`🎯 ${upside.toFixed(0)}% analyst upside`); }
    else if (upside < 0) { score -= 2; }
  }

  // Consensus
  if (a?.consensus === "Strong Buy") { score += 2; reasons.push("✅ Strong Buy consensus"); }
  else if (a?.consensus === "Hold") { score -= 1; }

  // IV sweet spot (iv from chain is decimal e.g. 0.45)
  const ivPct = c.iv != null ? Number(c.iv) * 100 : null;
  if (ivPct != null) {
    if (ivPct >= 20 && ivPct <= 60) { score += 1; reasons.push(`🔥 IV ${ivPct.toFixed(0)}%`); }
    else if (ivPct >= 80 && ivPct <= 100) { score -= 1; }
    else if (ivPct > 100) { score -= 2; }
  }

  // OI liquidity
  const oi = Number(c.openInterest ?? 0);
  if (oi >= 20000) { score += 2; reasons.push(`💧 High OI ${oi.toLocaleString()}`); }
  else if (oi >= 5000) { score += 1; reasons.push(`💧 High OI ${oi.toLocaleString()}`); }

  // 52W position
  if (high52 != null && low52 != null && high52 > low52) {
    const pos = (price - low52) / (high52 - low52);
    if (pos < 0.25 && (a?.bullPct ?? 0) >= 75) { score += 2; reasons.push("📊 Near 52W low"); }
  }

  // Strike moneyness
  const strike = Number(c.strike ?? 0);
  const moneyness = strike > 0 ? ((strike - price) / price) * 100 : 0;
  if (moneyness >= 0 && moneyness <= 10) { score += 1; }
  else if (moneyness > 30) { score -= 1; }

  let grade: Pick["grade"] = "F";
  if (score >= 7) grade = "A";
  else if (score >= 5) grade = "B";
  else if (score >= 3) grade = "C";
  else if (score >= 1) grade = "D";

  const ivDecimal = c.iv != null ? Number(c.iv) : 0;
  return {
    rawReasons: reasons,
    pick: {
      ticker: symbol,
      grade,
      score,
      price: +price.toFixed(2),
      chg: +chg.toFixed(2),
      expiry: String(c.expiration ?? ""),
      strike,
      last: Number(c.last ?? 0) || (Number(c.bid ?? 0) > 0 && Number(c.ask ?? 0) > 0 ? +(((Number(c.bid) + Number(c.ask)) / 2)).toFixed(2) : 0),
      bid: Number(c.bid ?? 0),
      ask: Number(c.ask ?? 0),
      oi,
      iv: +ivDecimal.toFixed(4),
      analystTarget: a?.target ?? null,
      upsideToTarget: upside != null ? +upside.toFixed(1) : null,
      reasons: reasons.join(" | "),
    },
  };
}

function scorePut(opts: {
  symbol: string; price: number; chg: number; high52: number | null; low52: number | null;
  c: any;
}): Scored {
  const { symbol, price, chg, high52, low52, c } = opts;
  const a = ANALYST[symbol] ?? null;
  const reasons: string[] = [];
  let score = 0;

  if (chg <= -10) { score += 3; reasons.push(`📉 Dropping ${chg.toFixed(1)}%`); }
  else if (chg <= -5) { score += 2; reasons.push(`📉 Dropping ${chg.toFixed(1)}%`); }
  else if (chg >= 10) { score -= 2; }
  else if (chg >= 5) { score -= 1; }

  let upside: number | null = null;
  if (a) {
    upside = ((a.target - price) / price) * 100;
    if (upside < 0) { score += 2; reasons.push(`🎯 ${upside.toFixed(0)}% analyst downside`); }
    else if (upside > 30) { score -= 2; }
    else if (upside > 10) { score -= 1; }
  }

  if (a?.consensus === "Hold") { score += 1; reasons.push("✅ Hold consensus"); }
  if (a?.bullPct === 0) { score += 1; }
  if (a?.consensus === "Strong Buy") { score -= 2; }

  const ivPct = c.iv != null ? Number(c.iv) * 100 : null;
  if (ivPct != null) {
    if (ivPct >= 40 && ivPct <= 90) { score += 1; reasons.push(`🔥 IV ${ivPct.toFixed(0)}%`); }
    else if (ivPct > 120) { score -= 1; }
  }

  const oi = Number(c.openInterest ?? 0);
  if (oi >= 20000) { score += 2; reasons.push(`💧 High OI ${oi.toLocaleString()}`); }
  else if (oi >= 5000) { score += 1; reasons.push(`💧 High OI ${oi.toLocaleString()}`); }

  if (high52 != null && low52 != null && high52 > low52) {
    const pos = (price - low52) / (high52 - low52);
    if (pos >= 0.8) { score += 2; reasons.push("⚠️ Near 52W high"); }
  }

  let grade: Pick["grade"] = "F";
  if (score >= 6) grade = "A";
  else if (score >= 4) grade = "B";
  else if (score >= 2) grade = "C";
  else if (score >= 0) grade = "D";

  const ivDecimal = c.iv != null ? Number(c.iv) : 0;
  return {
    rawReasons: reasons,
    pick: {
      ticker: symbol,
      grade,
      score,
      price: +price.toFixed(2),
      chg: +chg.toFixed(2),
      expiry: String(c.expiration ?? ""),
      strike: Number(c.strike ?? 0),
      last: Number(c.last ?? 0) || (Number(c.bid ?? 0) > 0 && Number(c.ask ?? 0) > 0 ? +(((Number(c.bid) + Number(c.ask)) / 2)).toFixed(2) : 0),
      bid: Number(c.bid ?? 0),
      ask: Number(c.ask ?? 0),
      oi,
      iv: +ivDecimal.toFixed(4),
      analystTarget: a?.target ?? null,
      upsideToTarget: upside != null ? +upside.toFixed(1) : null,
      reasons: reasons.join(" | "),
    },
  };
}

async function processTicker(symbol: string): Promise<{ calls: Pick[]; puts: Pick[] }> {
  const data = await loadSymbol(symbol);
  if (!data || !data.contracts.length) return { calls: [], puts: [] };

  const expirations = new Set(nearestExpirations(data.contracts, 4));
  const filtered = data.contracts.filter((c) => expirations.has(String(c.expiration)));

  const callsAll = filtered.filter((c) => c.type === "call");
  const putsAll = filtered.filter((c) => c.type === "put");

  const topCalls = [...callsAll].sort((a, b) => Number(b.openInterest ?? 0) - Number(a.openInterest ?? 0)).slice(0, 5);
  const topPuts = [...putsAll].sort((a, b) => Number(b.openInterest ?? 0) - Number(a.openInterest ?? 0)).slice(0, 5);

  const calls = topCalls.map((c) => scoreCall({ symbol, price: data.price, chg: data.chg, high52: data.high52, low52: data.low52, c }).pick);
  const puts = topPuts.map((c) => scorePut({ symbol, price: data.price, chg: data.chg, high52: data.high52, low52: data.low52, c }).pick);
  return { calls, puts };
}

async function runEngine(): Promise<{ calls: Pick[]; puts: Pick[] }> {
  // Process tickers in batches of 4 to avoid hammering upstream functions.
  const allCalls: Pick[] = [];
  const allPuts: Pick[] = [];
  const batchSize = 4;
  for (let i = 0; i < TICKERS.length; i += batchSize) {
    const batch = TICKERS.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((s) => processTicker(s).catch((e) => {
        console.warn(`[picks-engine] ${s} failed`, e);
        return { calls: [], puts: [] };
      })),
    );
    for (const r of results) {
      allCalls.push(...r.calls);
      allPuts.push(...r.puts);
    }
  }
  allCalls.sort((a, b) => b.score - a.score);
  allPuts.sort((a, b) => b.score - a.score);
  return { calls: allCalls.slice(0, 10), puts: allPuts.slice(0, 10) };
}

// Cache the full result for 5 minutes via kv_cache
const CACHE_KEY = "picks_engine_v1";
const CACHE_TTL_MS = 5 * 60_000;

async function kvGet(): Promise<any | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(CACHE_KEY)}&select=value,expires_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) { await r.text().catch(() => ""); return null; }
    const rows = await r.json();
    const row = rows?.[0];
    if (!row) return null;
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;
    return row.value;
  } catch { return null; }
}

async function kvSet(value: unknown): Promise<void> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kv_cache?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        key: CACHE_KEY,
        value,
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      }),
    });
    await r.text().catch(() => "");
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const u = new URL(req.url);
    const force = u.searchParams.get("refresh") === "1";

    if (!force) {
      const cached = await kvGet();
      if (cached) {
        return new Response(JSON.stringify({ ...cached, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { calls, puts } = await runEngine();
    const payload = { calls, puts, generatedAt: new Date().toISOString() };
    await kvSet(payload);
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("picks-engine fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
