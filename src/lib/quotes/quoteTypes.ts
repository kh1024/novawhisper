// ─── QUOTE TYPES ─────────────────────────────────────────────────────────────
// All option and underlying quote data normalized from any provider.
// Never pass raw provider payloads outside this layer.
//
// Single shared contract used by:
//   - quoteProvider.ts          (Massive / Polygon / BS-lite)
//   - quoteIntegrityEngine.ts   (validation + scoring)
//   - useScannerPicks.ts        (penalty + tier gating)
//   - NovaVerdictCard.tsx       (UI badges, Live Price Check panel)
//   - QuoteDebugPanel.tsx       (dev drawer)

export type QuoteSource = "MASSIVE" | "POLYGON" | "BSLITE" | "UNKNOWN";

export type QuoteStatus =
  | "REAL_TIME"
  | "FRESH"
  | "DELAYED"
  | "STALE"
  | "MISSING"
  | "INVALID";

export type QuoteConfidenceLabel =
  | "VERIFIED"     // 85-100
  | "ACCEPTABLE"   // 65-84
  | "CAUTION"      // 40-64
  | "UNRELIABLE"   // 20-39
  | "BLOCKED";     // 0-19

export interface NormalizedUnderlyingQuote {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  mid: number;
  prevClose: number;
  changePct: number;
  volume: number;
  quotedAt: number;           // unix ms
  quoteAgeSeconds: number;
  source: QuoteSource;
  status: QuoteStatus;
}

export interface NormalizedOptionQuote {
  contractSymbol: string;
  underlyingSymbol: string;
  strike: number;
  expiration: string;         // YYYY-MM-DD
  callPut: "CALL" | "PUT";
  dte: number;

  // Pricing
  bid: number;
  ask: number;
  mid: number;                // (bid + ask) / 2 — primary execution estimate
  last: number;               // last trade — secondary reference only
  mark?: number;              // broker/provider mark when available

  // Spread quality
  spreadDollars: number;
  spreadPct: number;

  // Intrinsic / extrinsic
  intrinsicValue: number;
  extrinsicValue: number;

  // Greeks
  iv: number;                 // implied volatility (decimal)
  delta: number;
  gamma: number;
  theta: number;
  vega: number;

  // Liquidity
  volume: number;
  openInterest: number;

  // Quote meta
  quotedAt: number;           // unix ms
  lastTradeAt?: number;       // unix ms
  quoteAgeSeconds: number;
  source: QuoteSource;
  status: QuoteStatus;

  // Computed
  liquidityScore: number;            // 0-100
  quoteConfidenceScore: number;      // 0-100
  quoteConfidenceLabel: QuoteConfidenceLabel;
  isExecutable: boolean;             // safe to show as BUY NOW candidate
}

export interface ProviderConflict {
  exists: boolean;
  disagreementPct: number;
  primarySource: QuoteSource;
  secondarySource: QuoteSource;
  primaryMid: number;
  secondaryMid: number;
}

export interface QuoteIntegrityReport {
  underlyingQuote: NormalizedUnderlyingQuote;
  optionQuote: NormalizedOptionQuote;
  providerConflict: ProviderConflict;
  underlyingMovedSinceSnapshot: boolean;
  underlyingMovePct: number;
  requiresRecalc: boolean;
  blockReasons: string[];
  warnReasons: string[];
  humanSummary: string;       // plain English for the UI
}
