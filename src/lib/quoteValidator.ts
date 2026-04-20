// Quote validation layer — used by BOTH the client preview and the
// portfolio-exit-eval edge function. Mirrors the spec from the user's brief.
//
// Purpose: prevent a single bogus print (mark=0.00, stale tick, missing
// bid/ask) from triggering a -100% stop alert on an open position.
//
// Quality rules (ordered, first match wins):
//   1. bid AND ask both null         → MISSING
//   2. updatedAt > 60s old           → STALE
//   3. mark === 0 OR (bid===0 && ask===0) → ANOMALOUS
//   4. mark < 0                      → ANOMALOUS
//   5. underlyingPrice known AND mark > underlyingPrice * 0.7 → ANOMALOUS
//   6. else                          → VALID

export type QuoteQuality = "VALID" | "STALE" | "MISSING" | "ANOMALOUS";

export interface RawQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  updatedAt: Date | string | number | null;
  /** Optional context — enables the "mark > 70% of underlying" sanity check. */
  underlyingPrice?: number | null;
  /** "massive" | "polygon" | "bs-lite" etc. */
  source?: string;
}

export interface OptionQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  updatedAt: Date;
  quality: QuoteQuality;
  reason: string;
  source?: string;
}

const STALE_AFTER_MS = 60_000;

function toDate(x: Date | string | number | null): Date {
  if (x instanceof Date) return x;
  if (x == null) return new Date(0);
  if (typeof x === "number") return new Date(x);
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t) : new Date(0);
}

export function classifyQuote(raw: RawQuote): OptionQuote {
  const updatedAt = toDate(raw.updatedAt);
  const ageMs = Date.now() - updatedAt.getTime();
  const bid = raw.bid;
  const ask = raw.ask;
  const mark = raw.mark;

  // 1) MISSING — both sides absent.
  if ((bid == null || !Number.isFinite(bid)) && (ask == null || !Number.isFinite(ask))) {
    return {
      bid, ask, last: raw.last, mark, updatedAt,
      quality: "MISSING",
      reason: "Bid and ask both unavailable from quote source.",
      source: raw.source,
    };
  }

  // 2) STALE — older than 60s.
  if (Number.isFinite(ageMs) && ageMs > STALE_AFTER_MS) {
    return {
      bid, ask, last: raw.last, mark, updatedAt,
      quality: "STALE",
      reason: `Quote ${Math.round(ageMs / 1000)}s old (>60s threshold).`,
      source: raw.source,
    };
  }

  // 3) ANOMALOUS — mark=0 or both sides zeroed.
  if (mark === 0 || (bid === 0 && ask === 0)) {
    return {
      bid, ask, last: raw.last, mark, updatedAt,
      quality: "ANOMALOUS",
      reason: "Mark is 0.00 — likely closed market or bad print.",
      source: raw.source,
    };
  }

  // 4) ANOMALOUS — negative mark (only happens with bad math).
  if (mark != null && mark < 0) {
    return {
      bid, ask, last: raw.last, mark, updatedAt,
      quality: "ANOMALOUS",
      reason: "Mark is negative — invalid.",
      source: raw.source,
    };
  }

  // 5) ANOMALOUS — option mark wildly above 70% of underlying.
  if (
    raw.underlyingPrice != null && raw.underlyingPrice > 0 &&
    mark != null && mark > raw.underlyingPrice * 0.7
  ) {
    return {
      bid, ask, last: raw.last, mark, updatedAt,
      quality: "ANOMALOUS",
      reason: `Mark $${mark.toFixed(2)} exceeds 70% of underlying $${raw.underlyingPrice.toFixed(2)} — implausible.`,
      source: raw.source,
    };
  }

  return {
    bid, ask, last: raw.last, mark, updatedAt,
    quality: "VALID",
    reason: "Bid/ask within sane bounds, fresh, non-zero.",
    source: raw.source,
  };
}

// ─── Spread / liquidity gates (used by Scanner before ENTRY_CONFIRMED) ────

export interface ContractGate {
  liquidityOk: boolean;
  spreadOk: boolean;
  spreadPct: number | null;
  illiquidReason: string | null;
  spreadReason: string | null;
}

const MIN_OI = 500;
const MIN_VOLUME = 50;
const MAX_SPREAD_PCT = 15;       // > 15% = "Wide Spread — Caution"
const REJECT_SPREAD_PCT = 30;    // > 30% = untradable

export function evaluateContractGate(args: {
  openInterest?: number | null;
  volume?: number | null;
  bid?: number | null;
  ask?: number | null;
  mark?: number | null;
}): ContractGate {
  const oi = Number(args.openInterest ?? 0);
  const vol = Number(args.volume ?? 0);
  const bid = args.bid ?? null;
  const ask = args.ask ?? null;
  const mark = args.mark ?? (bid != null && ask != null ? (bid + ask) / 2 : null);

  const liquidityOk = oi >= MIN_OI && vol >= MIN_VOLUME;
  const illiquidReason = liquidityOk
    ? null
    : `Illiquid — OI ${oi} (need ≥${MIN_OI}), vol ${vol} (need ≥${MIN_VOLUME}).`;

  let spreadPct: number | null = null;
  let spreadOk = true;
  let spreadReason: string | null = null;
  if (mark != null && mark > 0 && bid != null && ask != null && ask > bid) {
    spreadPct = ((ask - bid) / mark) * 100;
    if (spreadPct >= REJECT_SPREAD_PCT) {
      spreadOk = false;
      spreadReason = `Untradable — spread ${spreadPct.toFixed(1)}% (>${REJECT_SPREAD_PCT}%).`;
    } else if (spreadPct > MAX_SPREAD_PCT) {
      spreadOk = false;
      spreadReason = `Wide spread ${spreadPct.toFixed(1)}% (>${MAX_SPREAD_PCT}%) — caution.`;
    }
  }

  return { liquidityOk, spreadOk, spreadPct, illiquidReason, spreadReason };
}

// ─── UI helpers ───────────────────────────────────────────────────────────

export const QUALITY_LABEL: Record<QuoteQuality, string> = {
  VALID: "Live",
  STALE: "Stale",
  MISSING: "Quote Unavailable",
  ANOMALOUS: "Quote Unavailable",
};

export const QUALITY_CLASSES: Record<QuoteQuality, string> = {
  VALID:     "border-bullish/40 bg-bullish/10 text-bullish",
  STALE:     "border-warning/40 bg-warning/10 text-warning",
  MISSING:   "border-warning/40 bg-warning/10 text-warning",
  ANOMALOUS: "border-bearish/40 bg-bearish/10 text-bearish",
};
