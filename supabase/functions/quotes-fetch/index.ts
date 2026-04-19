// Verified stock quotes via Finnhub + Alpha Vantage + Massive + Yahoo + Stooq.
// Yahoo & Stooq are free/unmetered and used as ETF-friendly fallbacks so we
// rarely show "No data" even when the keyed providers get rate-limited.
// Status: verified (2+ sources within 0.25%) · close (<1%) · mismatch (≥1%) · stale (only 1 src) · unavailable.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");

const BATCH_CONCURRENCY = 4;

type SourceName = "finnhub" | "alpha-vantage" | "massive" | "yahoo" | "stooq" | "cnbc" | "google";

interface SourceQuote {
  source: SourceName;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  // Extended hours (only Yahoo populates these today)
  preMarketPrice?: number | null;
  preMarketChangePct?: number | null;
  postMarketPrice?: number | null;
  postMarketChangePct?: number | null;
  marketState?: string | null;     // "PRE" | "REGULAR" | "POST" | "CLOSED" | "PREPRE" | "POSTPOST"
}

export type Session = "pre" | "regular" | "post" | "closed";

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
  // Extended hours
  session: Session;
  preMarketPrice: number | null;
  preMarketChangePct: number | null;
  postMarketPrice: number | null;
  postMarketChangePct: number | null;
  /** Most-relevant extended price for the current session (null in regular/closed). */
  extendedPrice: number | null;
  extendedChangePct: number | null;
  error?: string;
}

// ── In-memory caches (per isolate; resets on cold start) ──
const QUOTE_TTL_MS = 30_000;
const FINNHUB_TTL_MS = 30_000;
const MASSIVE_TTL_MS = 30_000;
const ALPHA_TTL_MS = 60 * 60_000; // Alpha free is 25/day
const YAHOO_TTL_MS = 30_000;
const STOOQ_TTL_MS = 60_000;
const CNBC_TTL_MS = 60_000;
const GOOGLE_TTL_MS = 60_000;
const quoteCache = new Map<string, { quote: VerifiedQuote; at: number }>();
const finnhubCache = new Map<string, { q: SourceQuote | null; at: number }>();
const alphaCache = new Map<string, { q: SourceQuote | null; at: number }>();
const massiveCache = new Map<string, { q: SourceQuote | null; at: number }>();
const yahooCache = new Map<string, { q: SourceQuote | null; at: number }>();
const stooqCache = new Map<string, { q: SourceQuote | null; at: number }>();
const cnbcCache = new Map<string, { q: SourceQuote | null; at: number }>();
const googleCache = new Map<string, { q: SourceQuote | null; at: number }>();

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

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return out;
}

function keepPreviousOnBackoff(
  cache: Map<string, { q: SourceQuote | null; at: number }>,
  symbol: string,
  cached: { q: SourceQuote | null; at: number } | undefined,
  ttlMs: number,
  backoffMs: number,
) {
  if (cached?.q) {
    cache.set(symbol, { q: cached.q, at: Date.now() - ttlMs + backoffMs });
  }
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
      keepPreviousOnBackoff(finnhubCache, symbol, cached, FINNHUB_TTL_MS, 60_000);
      return cached?.q ?? null;
    }
    if (!r.ok) {
      console.warn(`[finnhub] ${symbol} HTTP ${r.status}`);
      keepPreviousOnBackoff(finnhubCache, symbol, cached, FINNHUB_TTL_MS, 30_000);
      return cached?.q ?? null;
    }
    const d = await r.json();
    const price = Number(d.c);
    if (!isFinite(price) || price === 0) {
      if (cached?.q) finnhubCache.set(symbol, { q: cached.q, at: Date.now() });
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

async function fetchMassive(symbol: string): Promise<SourceQuote | null> {
  if (!MASSIVE_KEY) return null;
  const cached = massiveCache.get(symbol);
  if (cached && Date.now() - cached.at < MASSIVE_TTL_MS) return cached.q;
  try {
    const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (r.status === 429) {
      console.warn(`[massive] ${symbol} 429 rate-limit — backing off 60s`);
      keepPreviousOnBackoff(massiveCache, symbol, cached, MASSIVE_TTL_MS, 60_000);
      return cached?.q ?? null;
    }
    if (!r.ok) {
      console.warn(`[massive] ${symbol} HTTP ${r.status}`);
      keepPreviousOnBackoff(massiveCache, symbol, cached, MASSIVE_TTL_MS, 30_000);
      return cached?.q ?? null;
    }
    const d = await r.json();
    const row = Array.isArray(d?.results) ? d.results[0] : null;
    const close = Number(row?.c);
    const open = Number(row?.o);
    if (!isFinite(close) || close === 0) {
      if (cached?.q) massiveCache.set(symbol, { q: cached.q, at: Date.now() });
      return cached?.q ?? null;
    }
    const change = isFinite(open) ? close - open : 0;
    const changePct = isFinite(open) && open ? ((close - open) / open) * 100 : 0;
    const volume = Number(row?.v ?? 0);
    const q: SourceQuote = { source: "massive", price: close, change, changePct, volume };
    massiveCache.set(symbol, { q, at: Date.now() });
    return q;
  } catch (e) {
    console.error(`[massive] ${symbol}`, e);
    return cached?.q ?? null;
  }
}

// ── Yahoo Finance (free, no key, very reliable for ETFs) ──
// Yahoo started requiring a "crumb + session cookie" handshake in late 2023.
// Without it, /v7/finance/quote returns HTTP 401. We do the handshake once
// per cold start and reuse the cookie/crumb for ~1h.
const YAHOO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let yahooSession: { cookie: string; crumb: string; at: number } | null = null;
const YAHOO_SESSION_TTL_MS = 60 * 60_000; // 1h
const YAHOO_KV_KEY = "yahoo_session_v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function kvGet(key: string): Promise<{ value: any; expires_at: string | null } | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(key)}&select=value,expires_at`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kv_cache?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        key,
        value,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      }),
    });
  } catch { /* best effort */ }
}

async function getYahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (yahooSession && Date.now() - yahooSession.at < YAHOO_SESSION_TTL_MS) {
    return { cookie: yahooSession.cookie, crumb: yahooSession.crumb };
  }
  // Cold-start warm-load from KV (skips the 2-request handshake).
  const cached = await kvGet(YAHOO_KV_KEY);
  if (cached?.value?.cookie && cached?.value?.crumb) {
    const exp = cached.expires_at ? Date.parse(cached.expires_at) : 0;
    if (exp > Date.now()) {
      yahooSession = { cookie: cached.value.cookie, crumb: cached.value.crumb, at: Date.now() };
      return { cookie: yahooSession.cookie, crumb: yahooSession.crumb };
    }
  }
  try {
    // Step 1 — hit fc.yahoo.com to get an A1/A3 cookie.
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": YAHOO_UA, Accept: "*/*" },
      redirect: "manual",
    });
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";
    // Crude split — Deno doesn't expose multi-set-cookie, but the A1 cookie is
    // returned as the first segment in this header.
    const cookie = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
    if (!cookie) {
      console.warn("[yahoo] handshake: no Set-Cookie returned");
      return null;
    }
    // Step 2 — exchange cookie for a crumb.
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": YAHOO_UA, Accept: "*/*", Cookie: cookie },
    });
    if (!crumbRes.ok) {
      console.warn(`[yahoo] handshake: crumb HTTP ${crumbRes.status}`);
      return null;
    }
    const crumb = (await crumbRes.text()).trim();
    if (!crumb) {
      console.warn("[yahoo] handshake: empty crumb");
      return null;
    }
    yahooSession = { cookie, crumb, at: Date.now() };
    // Persist for other cold starts (best-effort, fire-and-forget).
    kvSet(YAHOO_KV_KEY, { cookie, crumb }, YAHOO_SESSION_TTL_MS);
    return { cookie, crumb };
  } catch (e) {
    console.error("[yahoo] handshake error", e);
    return null;
  }
}

// One batched call returns up to ~50 symbols at once.
async function fetchYahooBatch(symbols: string[]): Promise<Map<string, SourceQuote>> {
  const out = new Map<string, SourceQuote>();
  if (symbols.length === 0) return out;
  const session = await getYahooSession();
  if (!session) return out;
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}&crumb=${encodeURIComponent(session.crumb)}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_UA,
        Accept: "application/json",
        Cookie: session.cookie,
      },
    });
    if (!r.ok) {
      console.warn(`[yahoo] batch HTTP ${r.status}`);
      // Invalidate session — next call will re-handshake.
      if (r.status === 401 || r.status === 403) yahooSession = null;
      return out;
    }
    const d = await r.json();
    const rows: Array<{
      symbol: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketVolume?: number;
      preMarketPrice?: number;
      preMarketChangePercent?: number;
      postMarketPrice?: number;
      postMarketChangePercent?: number;
      marketState?: string;
    }> = d?.quoteResponse?.result ?? [];
    for (const row of rows) {
      const price = Number(row.regularMarketPrice);
      if (!isFinite(price) || price <= 0) continue;
      out.set(row.symbol.toUpperCase(), {
        source: "yahoo",
        price,
        change: Number(row.regularMarketChange ?? 0),
        changePct: Number(row.regularMarketChangePercent ?? 0),
        volume: Number(row.regularMarketVolume ?? 0),
        preMarketPrice: isFinite(Number(row.preMarketPrice)) ? Number(row.preMarketPrice) : null,
        preMarketChangePct: isFinite(Number(row.preMarketChangePercent)) ? Number(row.preMarketChangePercent) : null,
        postMarketPrice: isFinite(Number(row.postMarketPrice)) ? Number(row.postMarketPrice) : null,
        postMarketChangePct: isFinite(Number(row.postMarketChangePercent)) ? Number(row.postMarketChangePercent) : null,
        marketState: row.marketState ?? null,
      });
    }
  } catch (e) {
    console.error("[yahoo] batch error", e);
  }
  return out;
}

async function fetchYahooSingle(symbol: string): Promise<SourceQuote | null> {
  const cached = yahooCache.get(symbol);
  if (cached && Date.now() - cached.at < YAHOO_TTL_MS) return cached.q;
  const map = await fetchYahooBatch([symbol]);
  const q = map.get(symbol) ?? null;
  yahooCache.set(symbol, { q, at: Date.now() });
  return q;
}

// ── Stooq (free CSV, no key; reliable for ETFs/index ETFs) ──
async function fetchStooq(symbol: string): Promise<SourceQuote | null> {
  const cached = stooqCache.get(symbol);
  if (cached && Date.now() - cached.at < STOOQ_TTL_MS) return cached.q;
  try {
    const variants = [`${symbol.toLowerCase()}.us`, symbol.toLowerCase()];
    for (const sym of variants) {
      const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 NovaTerminal" } });
      if (!r.ok) continue;
      const text = (await r.text()).trim();
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) continue;
      const cols = lines[1].split(",");
      const open = Number(cols[3]);
      const close = Number(cols[6]);
      const volume = Number(cols[7]);
      if (!isFinite(close) || close <= 0) continue;
      const change = isFinite(open) ? close - open : 0;
      const changePct = isFinite(open) && open ? ((close - open) / open) * 100 : 0;
      const q: SourceQuote = { source: "stooq", price: close, change, changePct, volume: isFinite(volume) ? volume : 0 };
      stooqCache.set(symbol, { q, at: Date.now() });
      return q;
    }
    stooqCache.set(symbol, { q: null, at: Date.now() });
    return null;
  } catch (e) {
    console.error(`[stooq] ${symbol}`, e);
    return cached?.q ?? null;
  }
}

// ── Session detection ─────────────────────────────────────────────────
// US equities: pre 04:00–09:30 ET, regular 09:30–16:00 ET, post 16:00–20:00 ET.
// We compute the current minute in America/New_York from the UTC clock.
function detectSession(yahooState?: string | null): Session {
  // Yahoo's marketState is the source of truth when present.
  if (yahooState) {
    const s = yahooState.toUpperCase();
    if (s.startsWith("PRE")) return "pre";
    if (s === "REGULAR") return "regular";
    if (s.startsWith("POST")) return "post";
    if (s === "CLOSED") return "closed";
  }
  // Fallback: derive from wall clock. Roughly handle DST by using the
  // Intl API to get the ET hour:minute.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (wd === "Sat" || wd === "Sun") return "closed";
  const minutes = hh * 60 + mm;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "post";
  return "closed";
}

function pickExtended(session: Session, yahoo: SourceQuote | null): { price: number | null; pct: number | null } {
  if (!yahoo) return { price: null, pct: null };
  if (session === "pre" && yahoo.preMarketPrice != null) {
    return { price: yahoo.preMarketPrice, pct: yahoo.preMarketChangePct ?? null };
  }
  if (session === "post" && yahoo.postMarketPrice != null) {
    return { price: yahoo.postMarketPrice, pct: yahoo.postMarketChangePct ?? null };
  }
  return { price: null, pct: null };
}

// Pick consensus from up to 5 sources.
function verify(
  symbol: string,
  finn: SourceQuote | null,
  alpha: SourceQuote | null,
  mass: SourceQuote | null,
  yahoo: SourceQuote | null,
  stooq: SourceQuote | null,
): VerifiedQuote {
  const now = new Date().toISOString();
  const session = detectSession(yahoo?.marketState);
  const ext = pickExtended(session, yahoo);
  const extendedFields = {
    session,
    preMarketPrice: yahoo?.preMarketPrice ?? null,
    preMarketChangePct: yahoo?.preMarketChangePct ?? null,
    postMarketPrice: yahoo?.postMarketPrice ?? null,
    postMarketChangePct: yahoo?.postMarketChangePct ?? null,
    extendedPrice: ext.price,
    extendedChangePct: ext.pct,
  };
  const sources: Record<SourceName, number | null> = {
    finnhub: finn?.price ?? null,
    "alpha-vantage": alpha?.price ?? null,
    massive: mass?.price ?? null,
    yahoo: yahoo?.price ?? null,
    stooq: stooq?.price ?? null,
  };
  const live = [finn, alpha, mass, yahoo, stooq].filter((x): x is SourceQuote => !!x && x.price > 0);
  if (live.length === 0) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      sources, consensusSource: null, status: "unavailable",
      diffPct: null, updatedAt: now, ...extendedFields, error: "All providers failed",
    };
  }
  if (live.length === 1) {
    const src = live[0];
    // ONE good source is still good data — don't punish ETFs / off-hours quotes.
    return {
      symbol, price: src.price, change: src.change, changePct: src.changePct, volume: src.volume,
      sources, consensusSource: src.source, status: "verified",
      diffPct: null, updatedAt: now, ...extendedFields,
    };
  }
  const prices = live.map((s) => s.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const diff = ((maxP - minP) / minP) * 100;
  // Prefer real-time intraday: Yahoo > Finnhub > Massive > Stooq > Alpha.
  const order: SourceName[] = ["yahoo", "finnhub", "massive", "stooq", "alpha-vantage"];
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
    ...extendedFields,
  };
}

async function getQuote(
  sym: string,
  verifyWithAlpha: boolean,
  yahooMap: Map<string, SourceQuote>,
): Promise<VerifiedQuote> {
  const cached = quoteCache.get(sym);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;
  const yahooFromBatch = yahooMap.get(sym) ?? null;
  if (yahooFromBatch) yahooCache.set(sym, { q: yahooFromBatch, at: Date.now() });
  const [finn, mass, alpha, stooq] = await Promise.all([
    fetchFinnhub(sym),
    fetchMassive(sym),
    verifyWithAlpha ? fetchAlpha(sym) : Promise.resolve(alphaCache.get(sym)?.q ?? null),
    fetchStooq(sym),
  ]);
  const yahoo = yahooFromBatch ?? (await fetchYahooSingle(sym));
  const v = verify(sym, finn, alpha, mass, yahoo, stooq);
  // If every provider failed this round but we have a previous good price, keep
  // serving it (marked stale) instead of returning "unavailable" / no data.
  if (v.status === "unavailable" && cached?.quote && cached.quote.price > 0) {
    const stale: VerifiedQuote = {
      ...cached.quote,
      status: "stale",
      updatedAt: cached.quote.updatedAt,
      error: "Live providers timed out — showing last known price.",
    };
    return stale;
  }
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

    symbols = Array.from(new Set(symbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean))).slice(0, 30);

    const useAlpha = verifyAll || symbols.length === 1;

    // One Yahoo batch call covers all symbols at once — much faster than per-symbol.
    const yahooMap = await fetchYahooBatch(symbols);

    // Bulk requests were fanning out too many provider calls in parallel and
    // hitting 429s, which surfaced as "No data" in the UI. Keep a small,
    // stable concurrency here so ETF/watchlist screens stay populated.
    const results = await mapWithConcurrency(symbols, BATCH_CONCURRENCY, (sym) => getQuote(sym, useAlpha, yahooMap));
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
