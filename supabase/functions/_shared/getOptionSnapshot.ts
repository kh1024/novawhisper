// Canonical Massive options snapshot — single source of truth for ALL
// per-contract option data (portfolio NOW price, scanner candidate selection,
// per-contract preview).
//
// Source priority (Options Advanced plan):
//   1. Massive per-contract NBBO snapshot (real-time bid/ask/last + Greeks).
//   2. Massive day.close / day.vwap fallback (off-hours when last_quote is
//      empty but the daily aggregate exists).
//   3. Caller-provided BS-lite estimator — ONLY when Massive returns 5xx /
//      timeout, never for "delayed" or empty quotes.
//
// Quality is one of VALID / STALE / MISSING / ANOMALOUS — same vocabulary as
// the existing quoteValidator on the client side.

import { acquireMassiveToken, releaseMassiveToken } from "./massiveThrottle.ts";

export type SnapshotQuality = "VALID" | "STALE" | "MISSING" | "ANOMALOUS";
export type SnapshotSource =
  | "massive"
  | "massive-day"
  | "yfinance"
  | "model"
  | "none";

export interface OptionSnapshot {
  source: SnapshotSource;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  mid: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  underlyingPrice: number | null;
  updatedAt: string; // ISO
  quality: SnapshotQuality;
  reason: string;
  /** Diagnostics for debug drawer / decision log. */
  diagnostics: {
    httpStatus?: number;
    latencyMs?: number;
    optionSymbol: string;
    underlying: string;
  };
}

const MASSIVE_KEY = Deno.env.get("MASSIVE_API_KEY");

/** Build OSI option symbol: O:SYM YYMMDD C/P STRIKE*1000(8 digits). */
export function buildOsiTicker(
  underlying: string,
  expiry: string, // YYYY-MM-DD
  isCall: boolean,
  strike: number,
): string {
  const [y, m, d] = expiry.split("-");
  const yy = y.slice(2);
  const cp = isCall ? "C" : "P";
  const k = String(Math.round(Number(strike) * 1000)).padStart(8, "0");
  return `O:${underlying}${yy}${m}${d}${cp}${k}`;
}

function classify(
  bid: number | null,
  ask: number | null,
  mark: number | null,
  underlyingPrice: number | null,
  ageSec: number,
): { quality: SnapshotQuality; reason: string } {
  if (bid == null && ask == null && mark == null) {
    return { quality: "MISSING", reason: "No bid, ask, or mark in Massive response." };
  }
  if (mark == null) return { quality: "ANOMALOUS", reason: "Mark missing — invalid quote." };
  if (mark <= 0.01) return { quality: "ANOMALOUS", reason: "Mark ≈ 0.00 — likely bad print." };
  if (bid != null && ask != null && bid > ask) {
    return { quality: "ANOMALOUS", reason: "Bid above ask — crossed market." };
  }
  if (
    underlyingPrice != null &&
    underlyingPrice > 0 &&
    mark > underlyingPrice * 0.7
  ) {
    return { quality: "ANOMALOUS", reason: "Mark > 70% of underlying — implausible." };
  }
  // Real-time plan: anything older than 5 min is stale (off-hours snapshots
  // commonly run a few minutes behind, so we use a generous threshold).
  if (ageSec > 300) return { quality: "STALE", reason: `Quote ${Math.round(ageSec)}s old.` };
  return { quality: "VALID", reason: "Live Massive NBBO." };
}

/** In-memory ring buffer of the last 20 Massive requests (debug drawer). */
interface RequestLogEntry {
  optionSymbol: string;
  underlying: string;
  httpStatus: number | "ERR";
  latencyMs: number;
  source: SnapshotSource;
  quality: SnapshotQuality;
  ts: string;
}
const _requestLog: RequestLogEntry[] = [];
function pushLog(entry: RequestLogEntry) {
  _requestLog.push(entry);
  while (_requestLog.length > 20) _requestLog.shift();
}
export function getRecentRequestLog(): RequestLogEntry[] {
  return [..._requestLog];
}

/**
 * Fetch the live Massive snapshot for one option contract.
 *
 * @param underlying e.g. "XLE"
 * @param optionSymbol OSI ticker e.g. "O:XLE260522P00055000". If omitted,
 *        derive from `params.expiry`/`isCall`/`strike`.
 */
export async function getOptionSnapshot(args: {
  underlying: string;
  optionSymbol?: string;
  expiry?: string;
  isCall?: boolean;
  strike?: number;
}): Promise<OptionSnapshot> {
  const underlying = args.underlying.toUpperCase();
  const ticker = args.optionSymbol
    ?? (args.expiry != null && args.isCall != null && args.strike != null
      ? buildOsiTicker(underlying, args.expiry, args.isCall, args.strike)
      : "");

  const baseDiag = { optionSymbol: ticker, underlying };

  if (!MASSIVE_KEY) {
    return {
      source: "none",
      bid: null, ask: null, last: null, mark: null, mid: null,
      volume: null, openInterest: null,
      iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
      underlyingPrice: null,
      updatedAt: new Date().toISOString(),
      quality: "MISSING",
      reason: "MASSIVE_API_KEY not configured.",
      diagnostics: baseDiag,
    };
  }
  if (!ticker) {
    return {
      source: "none",
      bid: null, ask: null, last: null, mark: null, mid: null,
      volume: null, openInterest: null,
      iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
      underlyingPrice: null,
      updatedAt: new Date().toISOString(),
      quality: "MISSING",
      reason: "No option symbol provided and not enough info to derive OSI ticker.",
      diagnostics: baseDiag,
    };
  }

  const url = `https://api.massive.com/v3/snapshot/options/${encodeURIComponent(underlying)}/${encodeURIComponent(ticker)}`;
  await acquireMassiveToken();
  const startedAt = Date.now();
  let httpStatus: number | "ERR" = "ERR";
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${MASSIVE_KEY}`, Accept: "application/json" },
    });
    httpStatus = r.status;
    const latencyMs = Date.now() - startedAt;

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[getOptionSnapshot] ${ticker} HTTP ${r.status} body=${txt.slice(0, 160)}`);
      pushLog({ ...baseDiag, httpStatus: r.status, latencyMs, source: "none", quality: "MISSING", ts: new Date().toISOString() });
      return {
        source: "none",
        bid: null, ask: null, last: null, mark: null, mid: null,
        volume: null, openInterest: null,
        iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
        underlyingPrice: null,
        updatedAt: new Date().toISOString(),
        quality: "MISSING",
        reason: `Massive HTTP ${r.status}`,
        diagnostics: { ...baseDiag, httpStatus: r.status, latencyMs },
      };
    }

    const d = await r.json().catch(() => ({}));
    const result = d?.results ?? d?.result ?? null;
    if (!result) {
      pushLog({ ...baseDiag, httpStatus: r.status, latencyMs, source: "none", quality: "MISSING", ts: new Date().toISOString() });
      return {
        source: "none",
        bid: null, ask: null, last: null, mark: null, mid: null,
        volume: null, openInterest: null,
        iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
        underlyingPrice: null,
        updatedAt: new Date().toISOString(),
        quality: "MISSING",
        reason: "Massive returned empty result body.",
        diagnostics: { ...baseDiag, httpStatus: r.status, latencyMs },
      };
    }

    const quote = result.last_quote ?? {};
    const trade = result.last_trade ?? {};
    const day = result.day ?? {};
    const greeks = result.greeks ?? {};

    const bid = Number(quote.bid ?? 0) || null;
    const ask = Number(quote.ask ?? 0) || null;
    let mid = bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
    let last = Number(trade.price ?? 0) || null;
    let source: SnapshotSource = "massive";

    // Day-aggregate fallback when NBBO is empty (off-hours / illiquid).
    if (mid == null && last != null) mid = last;
    if (mid == null) {
      const dayClose = Number(day.close ?? 0) || null;
      const dayVwap = Number(day.vwap ?? 0) || null;
      if (dayClose != null) {
        mid = dayClose;
        if (last == null) last = dayClose;
        source = "massive-day";
      } else if (dayVwap != null) {
        mid = dayVwap;
        if (last == null) last = dayVwap;
        source = "massive-day";
      }
    }

    const underlyingPrice = result.underlying_asset?.price != null
      ? Number(result.underlying_asset.price)
      : null;

    // Quote freshness — Massive timestamps last_quote.last_updated in ns.
    const quoteTsNs = Number(quote.last_updated ?? quote.t ?? 0);
    const tradeTsNs = Number(trade.sip_timestamp ?? trade.t ?? 0);
    const tsMs = quoteTsNs > 0
      ? Math.floor(quoteTsNs / 1_000_000)
      : tradeTsNs > 0
        ? Math.floor(tradeTsNs / 1_000_000)
        : Date.now();
    const ageSec = Math.max(0, (Date.now() - tsMs) / 1000);

    const mark = mid;
    const { quality, reason } = classify(bid, ask, mark, underlyingPrice, ageSec);

    pushLog({ ...baseDiag, httpStatus: r.status, latencyMs, source, quality, ts: new Date().toISOString() });

    return {
      source,
      bid,
      ask,
      last,
      mark,
      mid,
      volume: Number(day.volume ?? 0) || null,
      openInterest: Number(result.open_interest ?? 0) || null,
      iv: result.implied_volatility != null ? +Number(result.implied_volatility).toFixed(4) : null,
      delta: greeks.delta != null ? +Number(greeks.delta).toFixed(4) : null,
      gamma: greeks.gamma != null ? +Number(greeks.gamma).toFixed(4) : null,
      theta: greeks.theta != null ? +Number(greeks.theta).toFixed(4) : null,
      vega: greeks.vega != null ? +Number(greeks.vega).toFixed(4) : null,
      rho: greeks.rho != null ? +Number(greeks.rho).toFixed(4) : null,
      underlyingPrice,
      updatedAt: new Date(tsMs).toISOString(),
      quality,
      reason,
      diagnostics: { ...baseDiag, httpStatus: r.status, latencyMs },
    };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    console.warn(`[getOptionSnapshot] ${ticker} threw`, e);
    pushLog({ ...baseDiag, httpStatus: "ERR", latencyMs, source: "none", quality: "MISSING", ts: new Date().toISOString() });
    return {
      source: "none",
      bid: null, ask: null, last: null, mark: null, mid: null,
      volume: null, openInterest: null,
      iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
      underlyingPrice: null,
      updatedAt: new Date().toISOString(),
      quality: "MISSING",
      reason: `Network error: ${String(e)}`,
      diagnostics: { ...baseDiag, latencyMs },
    };
  } finally {
    releaseMassiveToken();
  }
}

/** Parallel snapshot fetch with a small concurrency window. */
export async function getOptionSnapshots(
  requests: Array<Parameters<typeof getOptionSnapshot>[0]>,
  concurrency = 10,
): Promise<OptionSnapshot[]> {
  const results: OptionSnapshot[] = new Array(requests.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= requests.length) return;
      results[idx] = await getOptionSnapshot(requests[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
  return results;
}
