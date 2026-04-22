// ─── QUOTE PROVIDER ABSTRACTION ──────────────────────────────────────────────
// Plug in any provider. The rest of the app never calls Massive / Polygon /
// BS-lite directly — it talks to fetchBestUnderlyingQuote / fetchBestOptionQuote.
//
// Implementation note: rather than introducing brand-new edge function URLs
// (per the user's "use existing edge functions" choice), the providers below
// route through the project's existing supabase functions:
//   MASSIVE  → quotes-fetch       (underlying)  + options-fetch       (options)
//   POLYGON  → public-quotes-fetch (underlying) + public-options-fetch (options)
//   BSLITE   → no real endpoint; returns null. Kept in the registry so the
//              priority chain compiles. Real BS-lite estimates are produced
//              by setupScore.ts upstream and never re-enter this layer.

import { supabase } from "@/integrations/supabase/client";
import type {
  NormalizedUnderlyingQuote,
  NormalizedOptionQuote,
  QuoteSource,
  QuoteStatus,
  QuoteConfidenceLabel,
} from "./quoteTypes";

// ── THRESHOLDS (edit here to tune behavior) ──────────────────────────────────
export const QUOTE_THRESHOLDS = {
  // Quote age (seconds)
  REAL_TIME_MAX_SEC:    5,
  FRESH_MAX_SEC:        15,
  DELAYED_MAX_SEC:      60,
  // > 60s → STALE

  // Spread quality
  SPREAD_NARROW_PCT:    0.08,
  SPREAD_OK_PCT:        0.12,
  SPREAD_SOFT_FAIL_PCT: 0.18,

  // Liquidity floors
  MIN_VOLUME_FLOOR: 50,
  MIN_OI_FLOOR:     100,

  // Provider conflict
  CONFLICT_WARN_PCT: 0.01,    // 1.0%
  CONFLICT_HARD_PCT: 0.025,   // 2.5%

  // Underlying move triggering recalc
  UNDERLYING_MOVE_RECALC_PCT: 0.005, // 0.5%
} as const;

// ── PROVIDER INTERFACE ───────────────────────────────────────────────────────

export interface IQuoteProvider {
  name: QuoteSource;
  priority: number; // lower = higher priority
  fetchUnderlying(symbol: string): Promise<NormalizedUnderlyingQuote | null>;
  fetchOptionQuote(contractSymbol: string): Promise<NormalizedOptionQuote | null>;
}

// Helpers shared by all providers ─────────────────────────────────────────────

function classifyAge(ageSeconds: number): QuoteStatus {
  if (ageSeconds <= QUOTE_THRESHOLDS.REAL_TIME_MAX_SEC) return "REAL_TIME";
  if (ageSeconds <= QUOTE_THRESHOLDS.FRESH_MAX_SEC)     return "FRESH";
  if (ageSeconds <= QUOTE_THRESHOLDS.DELAYED_MAX_SEC)   return "DELAYED";
  return "STALE";
}

function classifyConfidence(score: number): QuoteConfidenceLabel {
  if (score >= 85) return "VERIFIED";
  if (score >= 65) return "ACCEPTABLE";
  if (score >= 40) return "CAUTION";
  if (score >= 20) return "UNRELIABLE";
  return "BLOCKED";
}

function computeLiquidityScore(volume: number, oi: number, spreadPct: number): number {
  let score = 50;

  if (volume >= 500)      score += 25;
  else if (volume >= 200) score += 18;
  else if (volume >= 50)  score += 10;
  else if (volume >= 10)  score += 3;
  else                    score -= 15;

  if (oi >= 1000)     score += 25;
  else if (oi >= 500) score += 18;
  else if (oi >= 100) score += 10;
  else if (oi >= 50)  score += 3;
  else                score -= 15;

  if (spreadPct > QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT)      score -= 15;
  else if (spreadPct > QUOTE_THRESHOLDS.SPREAD_OK_PCT)        score -= 8;

  return Math.max(0, Math.min(100, score));
}

function computeConfidenceScore(params: {
  source: QuoteSource;
  spreadPct: number;
  quoteAgeSeconds: number;
  volume: number;
  oi: number;
  iv: number;
  delta: number;
  dte: number;
}): number {
  const { source, spreadPct, quoteAgeSeconds, volume, oi, iv, delta, dte } = params;
  let score = 100;

  if (source === "BSLITE")        score -= 45;
  else if (source === "POLYGON")  score -= 5;
  // MASSIVE: no penalty
  else if (source === "UNKNOWN")  score -= 20;

  if (quoteAgeSeconds > QUOTE_THRESHOLDS.DELAYED_MAX_SEC)        score -= 40;
  else if (quoteAgeSeconds > QUOTE_THRESHOLDS.FRESH_MAX_SEC)     score -= 15;
  else if (quoteAgeSeconds > QUOTE_THRESHOLDS.REAL_TIME_MAX_SEC) score -= 5;

  if (spreadPct > QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT)         score -= 25;
  else if (spreadPct > QUOTE_THRESHOLDS.SPREAD_OK_PCT)           score -= 12;
  else if (spreadPct > QUOTE_THRESHOLDS.SPREAD_NARROW_PCT)       score -= 5;

  if (volume < QUOTE_THRESHOLDS.MIN_VOLUME_FLOOR) score -= 10;
  if (oi < QUOTE_THRESHOLDS.MIN_OI_FLOOR)         score -= 10;

  if (dte <= 7 && (iv === 0 || delta === 0)) score -= 20;
  else if (iv === 0 || delta === 0)          score -= 10;

  return Math.max(0, Math.min(100, score));
}

function makeMissingUnderlyingQuote(symbol: string): NormalizedUnderlyingQuote {
  return {
    symbol, lastPrice: 0, bid: 0, ask: 0, mid: 0,
    prevClose: 0, changePct: 0, volume: 0,
    quotedAt: Date.now(), quoteAgeSeconds: 9999,
    source: "UNKNOWN", status: "MISSING",
  };
}

function makeMissingOptionQuote(contractSymbol: string): NormalizedOptionQuote {
  return {
    contractSymbol, underlyingSymbol: "", strike: 0,
    expiration: "", callPut: "CALL", dte: 0,
    bid: 0, ask: 0, mid: 0, last: 0,
    spreadDollars: 0, spreadPct: 1,
    intrinsicValue: 0, extrinsicValue: 0,
    iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0,
    volume: 0, openInterest: 0,
    quotedAt: Date.now(), quoteAgeSeconds: 9999,
    source: "UNKNOWN", status: "MISSING",
    liquidityScore: 0, quoteConfidenceScore: 0,
    quoteConfidenceLabel: "BLOCKED", isExecutable: false,
  };
}

/** Parse a contract symbol like "AAPL250117C00190000" → underlying + strike + cp + expiry. */
function parseContractSymbol(contract: string): {
  underlying: string;
  expiration: string;
  callPut: "CALL" | "PUT";
  strike: number;
} | null {
  const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(contract.toUpperCase());
  if (!m) return null;
  const [, underlying, ymd, cp, strikeStr] = m;
  const yyyy = "20" + ymd.slice(0, 2);
  const mm = ymd.slice(2, 4);
  const dd = ymd.slice(4, 6);
  return {
    underlying,
    expiration: `${yyyy}-${mm}-${dd}`,
    callPut: cp === "C" ? "CALL" : "PUT",
    strike: parseInt(strikeStr, 10) / 1000,
  };
}

/**
 * Normalize a free-form provider option payload into NormalizedOptionQuote.
 * Returns null when the quote is invalid (zero/crossed bid-ask).
 */
function normalizeOptionQuoteRaw(
  raw: Record<string, unknown>,
  contractSymbol: string,
  source: QuoteSource,
): NormalizedOptionQuote | null {
  const num = (k: string, alt?: string): number => {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (alt) {
      const v2 = raw[alt];
      if (typeof v2 === "number" && Number.isFinite(v2)) return v2;
    }
    return 0;
  };

  const bid  = num("bid",  "b");
  const ask  = num("ask",  "a");
  const last = num("last", "l");

  if (bid <= 0 || ask <= 0 || ask < bid) return null;

  const mid = (bid + ask) / 2;
  const spreadDollars = ask - bid;
  const spreadPct = spreadDollars / Math.max(mid, 0.01);

  const parsed = parseContractSymbol(contractSymbol);
  const strike     = num("strike", "strikePrice") || parsed?.strike || 0;
  const expiration = (typeof raw.expiration === "string" ? raw.expiration as string
                    : typeof raw.expiry === "string" ? raw.expiry as string
                    : parsed?.expiration ?? "");
  const callPut: "CALL" | "PUT" =
    (raw.optionType === "call" || raw.type === "call" || raw.callPut === "CALL")
      ? "CALL"
      : (raw.optionType === "put" || raw.type === "put" || raw.callPut === "PUT")
        ? "PUT"
        : (parsed?.callPut ?? "CALL");
  const underlying = (typeof raw.underlying === "string" ? raw.underlying as string
                    : parsed?.underlying ?? contractSymbol.replace(/\d.*/, ""));

  const dte = (() => {
    const direct = num("dte");
    if (direct > 0) return Math.floor(direct);
    if (!expiration) return 0;
    const ms = new Date(expiration + "T16:00:00Z").getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 86_400_000));
  })();

  const iv     = num("impliedVolatility", "iv");
  const delta  = num("delta");
  const gamma  = num("gamma");
  const theta  = num("theta");
  const vega   = num("vega");
  const volume = num("volume", "v");
  const oi     = num("openInterest", "oi");

  // Intrinsic is filled in by the integrity engine once the underlying is known.
  const intrinsic = 0;
  const extrinsic = Math.max(0, mid - intrinsic);

  const now = Date.now();
  const rawTs =
    typeof raw.timestamp === "number" ? raw.timestamp as number :
    typeof raw.t === "number" ? raw.t as number :
    typeof raw.updatedAt === "string" ? new Date(raw.updatedAt as string).getTime() :
    typeof raw.quotedAt === "number" ? raw.quotedAt as number :
    now;
  const quotedAt = rawTs;
  const quoteAgeSeconds = Math.max(0, (now - quotedAt) / 1000);

  const lastTradeAt =
    typeof raw.lastTradeTimestamp === "number" ? raw.lastTradeTimestamp as number :
    undefined;

  const liquidityScore       = computeLiquidityScore(volume, oi, spreadPct);
  const quoteConfidenceScore = computeConfidenceScore({
    source, spreadPct, quoteAgeSeconds, volume, oi, iv, delta, dte,
  });
  const quoteConfidenceLabel = classifyConfidence(quoteConfidenceScore);
  const isExecutable =
    quoteConfidenceScore >= 65 &&
    spreadPct <= QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT &&
    quoteAgeSeconds <= QUOTE_THRESHOLDS.DELAYED_MAX_SEC;

  return {
    contractSymbol,
    underlyingSymbol: underlying,
    strike, expiration, callPut, dte,
    bid, ask, mid, last,
    mark: typeof raw.mark === "number" ? raw.mark as number : undefined,
    spreadDollars, spreadPct,
    intrinsicValue: intrinsic,
    extrinsicValue: extrinsic,
    iv, delta, gamma, theta, vega,
    volume, openInterest: oi,
    quotedAt, lastTradeAt, quoteAgeSeconds,
    source,
    status: classifyAge(quoteAgeSeconds),
    liquidityScore, quoteConfidenceScore, quoteConfidenceLabel,
    isExecutable,
  };
}

// ── MASSIVE PROVIDER (via existing quotes-fetch / options-fetch) ─────────────

export class MassiveProvider implements IQuoteProvider {
  name: QuoteSource = "MASSIVE";
  priority = 1;

  async fetchUnderlying(symbol: string): Promise<NormalizedUnderlyingQuote | null> {
    try {
      const { data, error } = await supabase.functions.invoke("quotes-fetch", {
        body: { symbols: [symbol] },
      });
      if (error || !data) return null;
      const list: unknown =
        Array.isArray((data as { quotes?: unknown }).quotes) ? (data as { quotes: unknown[] }).quotes :
        Array.isArray(data) ? data : null;
      if (!Array.isArray(list)) return null;
      const raw = (list as Array<Record<string, unknown>>).find(
        (q) => typeof q?.symbol === "string" && (q.symbol as string).toUpperCase() === symbol.toUpperCase(),
      );
      if (!raw) return null;

      const last = typeof raw.last === "number" ? raw.last as number
                 : typeof raw.price === "number" ? raw.price as number
                 : typeof raw.close === "number" ? raw.close as number : 0;
      const bid = typeof raw.bid === "number" ? raw.bid as number : 0;
      const ask = typeof raw.ask === "number" ? raw.ask as number : 0;
      const prevClose = typeof raw.prevClose === "number" ? raw.prevClose as number
                      : typeof raw.previousClose === "number" ? raw.previousClose as number : 0;
      const changePct = typeof raw.changePct === "number" ? raw.changePct as number
                      : typeof raw.percentChange === "number" ? raw.percentChange as number
                      : (prevClose > 0 ? (last - prevClose) / prevClose : 0);
      const volume = typeof raw.volume === "number" ? raw.volume as number : 0;
      const tsRaw = raw.timestamp ?? raw.quotedAt ?? raw.t;
      const quotedAt = typeof tsRaw === "string" ? new Date(tsRaw).getTime()
                     : typeof tsRaw === "number" ? tsRaw : Date.now();
      const quoteAgeSeconds = Math.max(0, (Date.now() - quotedAt) / 1000);

      return {
        symbol,
        lastPrice: last,
        bid, ask,
        mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : last,
        prevClose, changePct, volume,
        quotedAt, quoteAgeSeconds,
        source: "MASSIVE",
        status: classifyAge(quoteAgeSeconds),
      };
    } catch {
      return null;
    }
  }

  async fetchOptionQuote(contractSymbol: string): Promise<NormalizedOptionQuote | null> {
    try {
      const parsed = parseContractSymbol(contractSymbol);
      if (!parsed) return null;
      const { data, error } = await supabase.functions.invoke("options-fetch", {
        body: { underlying: parsed.underlying, expiry: parsed.expiration, limit: 300 },
      });
      if (error || !data) return null;
      const list: unknown =
        Array.isArray((data as { contracts?: unknown }).contracts) ? (data as { contracts: unknown[] }).contracts :
        Array.isArray((data as { options?: unknown }).options)     ? (data as { options: unknown[] }).options :
        Array.isArray(data) ? data : null;
      if (!Array.isArray(list)) return null;
      const raw = (list as Array<Record<string, unknown>>).find((c) => {
        const sym = typeof c.contractSymbol === "string" ? c.contractSymbol as string
                  : typeof c.symbol === "string" ? c.symbol as string : "";
        return sym.toUpperCase() === contractSymbol.toUpperCase();
      });
      if (!raw) return null;
      return normalizeOptionQuoteRaw(raw, contractSymbol, "MASSIVE");
    } catch {
      return null;
    }
  }
}

// ── POLYGON PROVIDER (via public-quotes-fetch / public-options-fetch) ────────

export class PolygonProvider implements IQuoteProvider {
  name: QuoteSource = "POLYGON";
  priority = 2;

  async fetchUnderlying(symbol: string): Promise<NormalizedUnderlyingQuote | null> {
    try {
      const { data, error } = await supabase.functions.invoke("public-quotes-fetch", {
        body: { symbols: [symbol] },
      });
      if (error || !data) return null;
      const list: unknown =
        Array.isArray((data as { quotes?: unknown }).quotes) ? (data as { quotes: unknown[] }).quotes :
        Array.isArray(data) ? data : null;
      if (!Array.isArray(list)) return null;
      const raw = (list as Array<Record<string, unknown>>).find(
        (q) => typeof q?.symbol === "string" && (q.symbol as string).toUpperCase() === symbol.toUpperCase(),
      );
      if (!raw) return null;

      const last = typeof raw.last === "number" ? raw.last as number
                 : typeof raw.price === "number" ? raw.price as number
                 : typeof raw.close === "number" ? raw.close as number : 0;
      const bid = typeof raw.bid === "number" ? raw.bid as number : 0;
      const ask = typeof raw.ask === "number" ? raw.ask as number : 0;
      const prevClose = typeof raw.prevClose === "number" ? raw.prevClose as number : 0;
      const changePct = typeof raw.changePct === "number" ? raw.changePct as number
                      : (prevClose > 0 ? (last - prevClose) / prevClose : 0);
      const volume = typeof raw.volume === "number" ? raw.volume as number : 0;
      const tsRaw = raw.timestamp ?? raw.t;
      const quotedAt = typeof tsRaw === "string" ? new Date(tsRaw).getTime()
                     : typeof tsRaw === "number" ? tsRaw : Date.now();
      const quoteAgeSeconds = Math.max(0, (Date.now() - quotedAt) / 1000);

      return {
        symbol,
        lastPrice: last, bid, ask,
        mid: (bid > 0 && ask > 0) ? (bid + ask) / 2 : last,
        prevClose, changePct, volume,
        quotedAt, quoteAgeSeconds,
        source: "POLYGON",
        status: classifyAge(quoteAgeSeconds),
      };
    } catch {
      return null;
    }
  }

  async fetchOptionQuote(contractSymbol: string): Promise<NormalizedOptionQuote | null> {
    try {
      const parsed = parseContractSymbol(contractSymbol);
      if (!parsed) return null;
      const { data, error } = await supabase.functions.invoke("public-options-fetch", {
        body: { underlying: parsed.underlying, expiry: parsed.expiration, limit: 300 },
      });
      if (error || !data) return null;
      const list: unknown =
        Array.isArray((data as { contracts?: unknown }).contracts) ? (data as { contracts: unknown[] }).contracts :
        Array.isArray((data as { options?: unknown }).options) ? (data as { options: unknown[] }).options :
        Array.isArray(data) ? data : null;
      if (!Array.isArray(list)) return null;
      const raw = (list as Array<Record<string, unknown>>).find((c) => {
        const sym = typeof c.contractSymbol === "string" ? c.contractSymbol as string
                  : typeof c.symbol === "string" ? c.symbol as string : "";
        return sym.toUpperCase() === contractSymbol.toUpperCase();
      });
      if (!raw) return null;
      return normalizeOptionQuoteRaw(raw, contractSymbol, "POLYGON");
    } catch {
      return null;
    }
  }
}

// ── BSLITE FALLBACK PROVIDER ─────────────────────────────────────────────────
// No real endpoint; we never re-route BS-lite estimates through this layer.
// Always returns null. Kept in the registry so the priority chain compiles.

export class BsLiteProvider implements IQuoteProvider {
  name: QuoteSource = "BSLITE";
  priority = 99;

  async fetchUnderlying(): Promise<null> { return null; }
  async fetchOptionQuote(): Promise<null> { return null; }
}

// ── PROVIDER REGISTRY ────────────────────────────────────────────────────────

const PROVIDERS: IQuoteProvider[] = [
  new MassiveProvider(),
  new PolygonProvider(),
  new BsLiteProvider(),
].sort((a, b) => a.priority - b.priority);

// ── MULTI-PROVIDER FETCHERS ──────────────────────────────────────────────────

export async function fetchBestUnderlyingQuote(symbol: string): Promise<{
  quote: NormalizedUnderlyingQuote;
  conflict: {
    exists: boolean; disagreementPct: number;
    primarySource: QuoteSource; secondarySource: QuoteSource;
    primaryMid: number; secondaryMid: number;
  };
}> {
  const settled = await Promise.allSettled(
    PROVIDERS.filter((p) => p.priority < 90).map((p) => p.fetchUnderlying(symbol)),
  );
  const results: NormalizedUnderlyingQuote[] = [];
  for (const r of settled) if (r.status === "fulfilled" && r.value) results.push(r.value);

  // Honor the project's "freshest source wins" memory rule:
  // when two providers return data, the newer-timestamped one is primary.
  results.sort((a, b) => a.quoteAgeSeconds - b.quoteAgeSeconds);

  const primary = results[0] ?? null;
  const secondary = results[1] ?? null;

  const conflict = {
    exists: false,
    disagreementPct: 0,
    primarySource: (primary?.source ?? "UNKNOWN") as QuoteSource,
    secondarySource: (secondary?.source ?? "UNKNOWN") as QuoteSource,
    primaryMid: primary?.mid ?? 0,
    secondaryMid: secondary?.mid ?? 0,
  };
  if (primary && secondary && primary.mid > 0 && secondary.mid > 0) {
    conflict.disagreementPct = Math.abs(primary.mid - secondary.mid) / primary.mid;
    conflict.exists = conflict.disagreementPct >= QUOTE_THRESHOLDS.CONFLICT_WARN_PCT;
  }

  return { quote: primary ?? makeMissingUnderlyingQuote(symbol), conflict };
}

export async function fetchBestOptionQuote(contractSymbol: string): Promise<{
  quote: NormalizedOptionQuote;
  conflict: {
    exists: boolean; disagreementPct: number;
    primarySource: QuoteSource; secondarySource: QuoteSource;
    primaryMid: number; secondaryMid: number;
  };
}> {
  const settled = await Promise.allSettled(
    PROVIDERS.map((p) => p.fetchOptionQuote(contractSymbol)),
  );
  const results: NormalizedOptionQuote[] = [];
  for (const r of settled) if (r.status === "fulfilled" && r.value) results.push(r.value);

  results.sort((a, b) => a.quoteAgeSeconds - b.quoteAgeSeconds);

  const primary = results[0] ?? null;
  const secondary = results[1] ?? null;

  const conflict = {
    exists: false,
    disagreementPct: 0,
    primarySource: (primary?.source ?? "UNKNOWN") as QuoteSource,
    secondarySource: (secondary?.source ?? "UNKNOWN") as QuoteSource,
    primaryMid: primary?.mid ?? 0,
    secondaryMid: secondary?.mid ?? 0,
  };
  if (primary && secondary && primary.mid > 0 && secondary.mid > 0) {
    conflict.disagreementPct = Math.abs(primary.mid - secondary.mid) / primary.mid;
    conflict.exists = conflict.disagreementPct >= QUOTE_THRESHOLDS.CONFLICT_WARN_PCT;
  }

  return { quote: primary ?? makeMissingOptionQuote(contractSymbol), conflict };
}
