// Verified stock quotes via Finnhub + Alpha Vantage + Massive + Yahoo + Stooq.
// Yahoo & Stooq are free/unmetered and used as ETF-friendly fallbacks so we
// rarely show "No data" even when the keyed providers get rate-limited.
// Status: verified (2+ sources within 0.25%) · close (<1%) · mismatch (≥1%) · stale (only 1 src) · unavailable.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { acquireMassiveToken } from "../_shared/massiveThrottle.ts";
import { isMassiveDown, markMassiveDown, isOutageStatus } from "../_shared/massiveOutage.ts";

const ALPHA_KEY = Deno.env.get("ALPHA_VANTAGE_API_KEY");
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");
const STOCKDATA_KEY = Deno.env.get("STOCKDATA_API_KEY");

const BATCH_CONCURRENCY = 2;

type SourceName = "finnhub" | "alpha-vantage" | "massive" | "yahoo" | "stooq" | "cnbc" | "google" | "stockdata";

interface SourceQuote {
  source: SourceName;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  /** Epoch ms of the *quote*, not the fetch. Falls back to fetch time when
   *  the upstream provider doesn't expose a timestamp. Used by `verify()` to
   *  enforce the "freshest timestamp wins" rule. */
  ts: number;
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
const STOCKDATA_TTL_MS = 60_000;
const quoteCache = new Map<string, { quote: VerifiedQuote; at: number }>();
const finnhubCache = new Map<string, { q: SourceQuote | null; at: number }>();
const alphaCache = new Map<string, { q: SourceQuote | null; at: number }>();
const massiveCache = new Map<string, { q: SourceQuote | null; at: number }>();
const yahooCache = new Map<string, { q: SourceQuote | null; at: number }>();
const stooqCache = new Map<string, { q: SourceQuote | null; at: number }>();
const cnbcCache = new Map<string, { q: SourceQuote | null; at: number }>();
const googleCache = new Map<string, { q: SourceQuote | null; at: number }>();
const stockdataCache = new Map<string, { q: SourceQuote | null; at: number }>();

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

// Global cooldowns — when a provider 429s, skip ALL further calls to it
// for the cooldown window so we stop wasting budget and let the free
// sources (Yahoo/Stooq/CNBC/Google) carry the load.
let finnhubCooldownUntil = 0;
let massiveCooldownUntil = 0;
const PROVIDER_COOLDOWN_MS = 90_000;

async function fetchFinnhub(symbol: string): Promise<SourceQuote | null> {
  if (!FINNHUB_KEY) return null;
  if (Date.now() < finnhubCooldownUntil) return finnhubCache.get(symbol)?.q ?? null;
  const cached = finnhubCache.get(symbol);
  if (cached && Date.now() - cached.at < FINNHUB_TTL_MS) return cached.q;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const r = await fetch(url);
    if (r.status === 429) {
      finnhubCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      console.warn(`[finnhub] ${symbol} 429 — global cooldown ${PROVIDER_COOLDOWN_MS}ms`);
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
    // Finnhub `t` is epoch *seconds* of the last trade.
    const ts = Number(d.t) > 0 ? Number(d.t) * 1000 : Date.now();
    const q: SourceQuote = { source: "finnhub", price, change: Number(d.d ?? 0), changePct: Number(d.dp ?? 0), volume: 0, ts };
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
        // Alpha returns only the trading-day date; treat as end-of-day.
        ts: Date.parse(String(q["07. latest trading day"] ?? "")) || Date.now(),
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
  if (Date.now() < massiveCooldownUntil) return massiveCache.get(symbol)?.q ?? null;
  // Kill-switch — skip Massive entirely while flagged offline. Hourly
  // massive-ping clears the flag when API recovers.
  if (await isMassiveDown()) return null;
  const cached = massiveCache.get(symbol);
  if (cached && Date.now() - cached.at < MASSIVE_TTL_MS) return cached.q;
  try {
    const url = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true`;
    await acquireMassiveToken(); // throttle to 75 req/s/instance
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    if (r.status === 429) {
      massiveCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      console.warn(`[massive] ${symbol} 429 — global cooldown ${PROVIDER_COOLDOWN_MS}ms`);
      keepPreviousOnBackoff(massiveCache, symbol, cached, MASSIVE_TTL_MS, 60_000);
      return cached?.q ?? null;
    }
    if (!r.ok) {
      console.warn(`[massive] ${symbol} HTTP ${r.status}`);
      if (isOutageStatus(r.status)) {
        await markMassiveDown(`HTTP ${r.status}`);
      }
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
    // Massive `/prev` returns yesterday's bar; `t` is epoch ms when present.
    const ts = Number(row?.t) > 0 ? Number(row.t) : Date.now();
    const q: SourceQuote = { source: "massive", price: close, change, changePct, volume, ts };
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
      preMarketTime?: number;
      postMarketPrice?: number;
      postMarketChangePercent?: number;
      postMarketTime?: number;
      regularMarketTime?: number;
      marketState?: string;
    }> = d?.quoteResponse?.result ?? [];
    for (const row of rows) {
      const price = Number(row.regularMarketPrice);
      if (!isFinite(price) || price <= 0) continue;
      // Yahoo timestamps are epoch *seconds*; pick the freshest of pre/regular/post.
      const tsCandidates = [row.regularMarketTime, row.preMarketTime, row.postMarketTime]
        .map((t) => (Number(t) > 0 ? Number(t) * 1000 : 0))
        .filter((t) => t > 0);
      const ts = tsCandidates.length ? Math.max(...tsCandidates) : Date.now();
      out.set(row.symbol.toUpperCase(), {
        source: "yahoo",
        price,
        change: Number(row.regularMarketChange ?? 0),
        changePct: Number(row.regularMarketChangePercent ?? 0),
        volume: Number(row.regularMarketVolume ?? 0),
        ts,
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

// ── StockData.org (paid, 100/day free tier) ──
// One batched HTTP call returns up to 100 tickers. Daily budget enforced
// via kv_cache counter (`stockdata:usage:YYYY-MM-DD`). Hard cap = 95 to
// leave a 5-call safety margin for Settings health pings & manual checks.
const STOCKDATA_DAILY_CAP = 95;

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

function isMarketHoursET(): boolean {
  const d = new Date();
  const etHour = (d.getUTCHours() - 4 + 24) % 24; // approx ET, generous window
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return etHour >= 9 && etHour < 20;
}

async function fetchStockDataBatch(symbols: string[]): Promise<Map<string, SourceQuote>> {
  const out = new Map<string, SourceQuote>();
  if (!STOCKDATA_KEY || symbols.length === 0) return out;
  if (!isMarketHoursET()) return out;
  const usageKey = `stockdata:usage:${todayUtc()}`;
  const usageRow = await kvGet(usageKey);
  const usage = (usageRow?.value as { count?: number } | null)?.count ?? 0;
  if (usage >= STOCKDATA_DAILY_CAP) {
    console.warn(`[stockdata] daily cap hit (${usage}/${STOCKDATA_DAILY_CAP}) — skipping`);
    return out;
  }
  const sorted = [...symbols].sort();
  const cacheKey = `stockdata:quotes:${sorted.join(",")}`;
  const cached = await kvGet(cacheKey);
  const cachedAt = cached?.expires_at ? Date.parse(cached.expires_at) : 0;
  if (cached?.value && cachedAt > Date.now()) {
    const arr = (cached.value as { quotes?: Array<{ symbol: string; price: number; ts: number; change: number | null }> }).quotes ?? [];
    for (const q of arr) {
      out.set(q.symbol, {
        source: "stockdata", price: q.price, change: q.change ?? 0,
        changePct: 0, volume: 0, ts: q.ts || Date.now(),
      });
    }
    return out;
  }
  try {
    const r = await fetch(`https://api.stockdata.org/v1/data/quote?symbols=${encodeURIComponent(sorted.join(","))}&api_token=${STOCKDATA_KEY}`);
    await kvSet(usageKey, { count: usage + 1 }, 36 * 60 * 60_000);
    if (!r.ok) {
      console.warn(`[stockdata] HTTP ${r.status}`);
      return out;
    }
    const j = await r.json() as { data?: Array<{ ticker?: string; price?: number; day_change?: number; last_trade_time?: string; previous_close_price?: number; volume?: number }> };
    const cacheRows: Array<{ symbol: string; price: number; ts: number; change: number | null }> = [];
    for (const row of j.data ?? []) {
      if (!row.ticker || row.price == null) continue;
      const price = Number(row.price);
      if (!isFinite(price) || price <= 0) continue;
      const sym = row.ticker.toUpperCase();
      const ts = row.last_trade_time ? new Date(row.last_trade_time).getTime() : Date.now();
      const prev = Number(row.previous_close_price);
      const change = Number(row.day_change ?? (isFinite(prev) && prev > 0 ? price - prev : 0));
      const changePct = isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : 0;
      out.set(sym, {
        source: "stockdata", price, change, changePct,
        volume: Number(row.volume ?? 0), ts,
      });
      cacheRows.push({ symbol: sym, price, ts, change });
    }
    await kvSet(cacheKey, { quotes: cacheRows }, STOCKDATA_TTL_MS);
  } catch (e) {
    console.error("[stockdata] batch error", e);
  }
  return out;
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
      // Stooq CSV columns: symbol,date,time,open,high,low,close,volume — combine date+time as ET.
      const dt = Date.parse(`${cols[1]}T${cols[2] || "00:00:00"}-05:00`);
      const ts = isFinite(dt) ? dt : Date.now();
      const q: SourceQuote = { source: "stooq", price: close, change, changePct, volume: isFinite(volume) ? volume : 0, ts };
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

// ── CNBC quote API (free JSON, no key; great ETF coverage) ──
async function fetchCnbc(symbol: string): Promise<SourceQuote | null> {
  const cached = cnbcCache.get(symbol);
  if (cached && Date.now() - cached.at < CNBC_TTL_MS) return cached.q;
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(symbol)}&requestMethod=quick&noform=1&output=json`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 NovaTerminal", Accept: "application/json" } });
    if (!r.ok) {
      cnbcCache.set(symbol, { q: cached?.q ?? null, at: Date.now() });
      return cached?.q ?? null;
    }
    const d = await r.json();
    const row = d?.FormattedQuoteResult?.FormattedQuote?.[0];
    const price = Number(row?.last);
    if (!isFinite(price) || price <= 0) {
      cnbcCache.set(symbol, { q: null, at: Date.now() });
      return null;
    }
    const change = Number(String(row?.change ?? "0").replace(/[+,]/g, ""));
    const changePct = Number(String(row?.change_pct ?? "0").replace(/[+%,]/g, ""));
    const volume = Number(String(row?.volume ?? "0").replace(/,/g, ""));
    // CNBC `last_time` is an epoch-seconds string when present.
    const lt = Number(row?.last_time);
    const ts = isFinite(lt) && lt > 0 ? lt * 1000 : Date.now();
    const q: SourceQuote = { source: "cnbc", price, change: isFinite(change) ? change : 0, changePct: isFinite(changePct) ? changePct : 0, volume: isFinite(volume) ? volume : 0, ts };
    cnbcCache.set(symbol, { q, at: Date.now() });
    return q;
  } catch (e) {
    console.error(`[cnbc] ${symbol}`, e);
    return cached?.q ?? null;
  }
}

// ── Google Finance HTML scrape (free, no key; bulletproof for US ETFs) ──
// Tries NYSEARCA → NASDAQ → NYSE in order. We pull `data-last-price` from the
// rendered DOM, which Google ships in the initial HTML response.
async function fetchGoogle(symbol: string): Promise<SourceQuote | null> {
  const cached = googleCache.get(symbol);
  if (cached && Date.now() - cached.at < GOOGLE_TTL_MS) return cached.q;
  const exchanges = ["NYSEARCA", "NASDAQ", "NYSE"];
  for (const ex of exchanges) {
    try {
      const url = `https://www.google.com/finance/quote/${encodeURIComponent(symbol)}:${ex}`;
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 NovaTerminal", Accept: "text/html" } });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/data-last-price="([0-9.]+)"/);
      const prevMatch = html.match(/data-last-normal-market-timestamp="\d+"\s+data-previous-close-price="([0-9.]+)"/)
        ?? html.match(/data-previous-close-price="([0-9.]+)"/);
      const price = m ? Number(m[1]) : NaN;
      if (!isFinite(price) || price <= 0) continue;
      const prev = prevMatch ? Number(prevMatch[1]) : NaN;
      const change = isFinite(prev) ? price - prev : 0;
      const changePct = isFinite(prev) && prev ? ((price - prev) / prev) * 100 : 0;
      // Google embeds `data-last-normal-market-timestamp="<epoch-seconds>"`.
      const tm = html.match(/data-last-normal-market-timestamp="(\d+)"/);
      const ts = tm ? Number(tm[1]) * 1000 : Date.now();
      const q: SourceQuote = { source: "google", price, change, changePct, volume: 0, ts };
      googleCache.set(symbol, { q, at: Date.now() });
      return q;
    } catch (e) {
      console.error(`[google] ${symbol}@${ex}`, e);
    }
  }
  googleCache.set(symbol, { q: null, at: Date.now() });
  return null;
}


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
  // Pre-market: surface pre-market quote.
  if (session === "pre" && yahoo.preMarketPrice != null) {
    return { price: yahoo.preMarketPrice, pct: yahoo.preMarketChangePct ?? null };
  }
  // Post-market (and right after close while we're still "closed" but post data is fresh):
  // surface the most recent extended-hours price.
  if ((session === "post" || session === "closed") && yahoo.postMarketPrice != null) {
    return { price: yahoo.postMarketPrice, pct: yahoo.postMarketChangePct ?? null };
  }
  // Closed early in the morning before pre opens: prefer pre if it exists.
  if (session === "closed" && yahoo.preMarketPrice != null) {
    return { price: yahoo.preMarketPrice, pct: yahoo.preMarketChangePct ?? null };
  }
  return { price: null, pct: null };
}

// Pick consensus from up to 8 sources.
function verify(
  symbol: string,
  finn: SourceQuote | null,
  alpha: SourceQuote | null,
  mass: SourceQuote | null,
  yahoo: SourceQuote | null,
  stooq: SourceQuote | null,
  cnbc: SourceQuote | null,
  google: SourceQuote | null,
  sd: SourceQuote | null,
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
    cnbc: cnbc?.price ?? null,
    google: google?.price ?? null,
    stockdata: sd?.price ?? null,
  };
  const live = [finn, alpha, mass, yahoo, stooq, cnbc, google, sd].filter((x): x is SourceQuote => !!x && x.price > 0);
  if (live.length === 0) {
    return {
      symbol, price: 0, change: 0, changePct: 0, volume: 0,
      sources, consensusSource: null, status: "unavailable",
      diffPct: null, updatedAt: now, ...extendedFields, error: "All providers failed",
    };
  }
  if (live.length === 1) {
    const src = live[0];
    return {
      symbol, price: src.price, change: src.change, changePct: src.changePct, volume: src.volume,
      sources, consensusSource: src.source, status: "verified",
      diffPct: null, updatedAt: new Date(src.ts || Date.now()).toISOString(), ...extendedFields,
    };
  }
  // ── FRESHEST-WINS RULE ────────────────────────────────────────────────
  const freshestTs = Math.max(...live.map((s) => s.ts || 0));
  const windowMs = session === "regular" ? 5 * 60_000 : 30 * 60_000;
  const fresh = live.filter((s) => freshestTs - (s.ts || 0) <= windowMs);
  const eligible = fresh.length > 0 ? fresh : live;

  const prices = live.map((s) => s.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const diff = ((maxP - minP) / minP) * 100;
  // Prefer real-time intraday: Yahoo > StockData > Finnhub > Massive > CNBC > Google > Stooq > Alpha.
  // StockData is paid + reliable → trusted slot just below Yahoo, above Finnhub.
  const order: SourceName[] = ["yahoo", "stockdata", "finnhub", "massive", "cnbc", "google", "stooq", "alpha-vantage"];
  const chosen = order.map((n) => eligible.find((s) => s.source === n)).find(Boolean) ?? eligible[0];
  const status: VerifiedQuote["status"] = diff < 0.25 ? "verified" : diff < 1 ? "close" : "mismatch";
  // ── EXTENDED-HOURS OVERRIDE ───────────────────────────────────────────
  // When the market isn't in regular session, surface the freshest extended
  // price as the primary `price` so EVERY consumer (Market page, Scanner,
  // ticker tape, etc.) shows what's actually trading right now. The regular
  // close stays available via `sources.yahoo`/`sources.cnbc`.
  const useExt = session !== "regular" && ext.price != null && ext.price > 0;
  const primaryPrice = useExt ? ext.price! : chosen.price;
  const primaryPct = useExt ? (ext.pct ?? 0) : chosen.changePct;
  const primaryChange = useExt && chosen.price > 0
    ? +(primaryPrice - chosen.price).toFixed(4)         // ext vs regular close
    : chosen.change;
  return {
    symbol,
    price: primaryPrice,
    change: primaryChange,
    changePct: primaryPct,
    volume: Math.max(...live.map((s) => s.volume ?? 0)),
    sources,
    consensusSource: useExt ? "yahoo" : chosen.source,
    status,
    diffPct: +diff.toFixed(4),
    updatedAt: new Date(chosen.ts || Date.now()).toISOString(),
    ...extendedFields,
  };
}

async function getQuote(
  sym: string,
  verifyWithAlpha: boolean,
  yahooMap: Map<string, SourceQuote>,
  sdMap: Map<string, SourceQuote>,
): Promise<VerifiedQuote> {
  const cached = quoteCache.get(sym);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.quote;
  const yahooFromBatch = yahooMap.get(sym) ?? null;
  if (yahooFromBatch) yahooCache.set(sym, { q: yahooFromBatch, at: Date.now() });
  const sd = sdMap.get(sym) ?? stockdataCache.get(sym)?.q ?? null;
  if (sd) stockdataCache.set(sym, { q: sd, at: Date.now() });
  const [finn, mass, alpha, stooq, cnbc, google] = await Promise.all([
    fetchFinnhub(sym),
    fetchMassive(sym),
    verifyWithAlpha ? fetchAlpha(sym) : Promise.resolve(alphaCache.get(sym)?.q ?? null),
    fetchStooq(sym),
    fetchCnbc(sym),
    fetchGoogle(sym),
  ]);
  const yahoo = yahooFromBatch ?? (await fetchYahooSingle(sym));

  const v = verify(sym, finn, alpha, mass, yahoo, stooq, cnbc, google, sd);
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

    // Cap to keep total work under the edge worker CPU budget. Each symbol
    // fans out to 6 provider calls in parallel — 80 × 6 = 480 ops per request
    // was tripping WORKER_RESOURCE_LIMIT. 40 keeps us under budget; the
    // client batches the universe across multiple requests.
    symbols = Array.from(new Set(symbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean))).slice(0, 40);

    const useAlpha = verifyAll || symbols.length === 1;

    // Yahoo (batched 50 at a time) + StockData (one batched call, up to 100
    // tickers) fired in parallel. StockData has a 100/day budget; the batch
    // function self-throttles via kv_cache and is a no-op off-hours.
    const yahooMap = new Map<string, SourceQuote>();
    const yahooP = (async () => {
      for (let i = 0; i < symbols.length; i += 50) {
        const chunk = symbols.slice(i, i + 50);
        const part = await fetchYahooBatch(chunk);
        for (const [k, v] of part) yahooMap.set(k, v);
      }
    })();
    const sdP = fetchStockDataBatch(symbols.slice(0, 100));
    const [, sdMap] = await Promise.all([yahooP, sdP]);

    const results = await mapWithConcurrency(symbols, BATCH_CONCURRENCY, (sym) => getQuote(sym, useAlpha, yahooMap, sdMap));
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
