// Pick Expiration Engine
// ──────────────────────
// Implements the four "Pick Expiration Policy" rules so users never chase a
// stale setup. Pure logic + a thin React hook (`usePickExpiration`) that the
// Scanner and Web Picks panels wrap around their pick lists.
//
// Rules:
//   1. Price drift   — if the live price moved more than 1.5% from the price
//                      observed when the pick was first surfaced, the pick is
//                      STALE → force re-scan (we hide-or-fade in the UI).
//   2. RSI flip      — if RSI > 75 the verdict is downgraded to WAIT
//                      (especially Aggressive picks that were GO/NEUTRAL).
//   3. Time-out      — any pick that hasn't reached GO within 2h is removed
//                      from the dashboard (engine returns timedOut=true).
//   4. Theta audit   — keeps a rolling 3-sample series of |θ|; if monotonically
//                      increasing AND the latest sample is ≥ 25% above the
//                      first, downgrade confidence one tier.

import { useEffect, useMemo, useRef, useState } from "react";

export const PRICE_DRIFT_PCT = 1.5;
export const RSI_FLIP_THRESHOLD = 75;
export const TIMEOUT_MS = 2 * 60 * 60 * 1000;     // 2 hours
export const THETA_HISTORY_LEN = 3;
export const THETA_ACCEL_PCT = 25;                // ≥25% growth in |θ|

export type Confidence = "Low" | "Medium" | "High";
export type Verdict = "GO" | "WAIT" | "NO" | "EXIT" | "NEUTRAL";

export interface PickInputs {
  /** Stable, content-addressable id (symbol+strategy+strike+expiry…). */
  key: string;
  /** Live underlying spot price right now. */
  price: number | null;
  /** Latest RSI(14). Optional. */
  rsi?: number | null;
  /** Current verdict from CRL/NOVA. Optional. */
  verdict?: Verdict | null;
  /** Latest absolute theta sample (per contract per day). Optional. */
  theta?: number | null;
  /** Original confidence the engine should consider downgrading. Optional. */
  confidence?: Confidence | null;
}

export interface PickStatus {
  key: string;
  /** Price observed the first time we saw this pick (ms-stable). */
  firstSeenPrice: number | null;
  firstSeenAt: number;
  /** % drift between firstSeenPrice and the latest price. */
  driftPct: number | null;
  isStale: boolean;
  /** True when the pick hasn't reached GO and 2h has elapsed. */
  isTimedOut: boolean;
  /** RSI rule fired — verdict has been forced to WAIT. */
  rsiFlipped: boolean;
  /** Final verdict after RSI flip (null if no input verdict supplied). */
  effectiveVerdict: Verdict | null;
  /** True if theta is accelerating across the rolling window. */
  thetaAccelerating: boolean;
  /** Possibly downgraded confidence (one tier when theta accelerates). */
  effectiveConfidence: Confidence | null;
  /** Human-readable reasons (chips). */
  reasons: string[];
}

interface MemoEntry {
  firstSeenPrice: number | null;
  firstSeenAt: number;
  thetaHistory: number[];
  /** Time the pick first reached the GO state, if ever. */
  reachedGoAt: number | null;
}

const CONFIDENCE_DOWN: Record<Confidence, Confidence> = {
  High: "Medium",
  Medium: "Low",
  Low: "Low",
};

/** Pure, side-effect-free reducer. Useful for tests + the React hook. */
export function evaluatePick(input: PickInputs, memo: MemoEntry, now: number): PickStatus {
  const reasons: string[] = [];

  // 1. Price drift
  let driftPct: number | null = null;
  let isStale = false;
  if (memo.firstSeenPrice != null && memo.firstSeenPrice > 0 && input.price != null) {
    driftPct = ((input.price - memo.firstSeenPrice) / memo.firstSeenPrice) * 100;
    if (Math.abs(driftPct) > PRICE_DRIFT_PCT) {
      isStale = true;
      reasons.push(`Stale · price drifted ${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(2)}%`);
    }
  }

  // 2. RSI flip → WAIT
  let effectiveVerdict: Verdict | null = input.verdict ?? null;
  let rsiFlipped = false;
  if (
    input.rsi != null &&
    input.rsi > RSI_FLIP_THRESHOLD &&
    (effectiveVerdict === "GO" || effectiveVerdict === "NEUTRAL")
  ) {
    rsiFlipped = true;
    effectiveVerdict = "WAIT";
    reasons.push(`RSI ${input.rsi.toFixed(0)} > ${RSI_FLIP_THRESHOLD} — flipped to WAIT`);
  }

  // 3. Time-out (only when we never reached GO)
  const elapsed = now - memo.firstSeenAt;
  const isTimedOut = memo.reachedGoAt == null && elapsed > TIMEOUT_MS;
  if (isTimedOut) {
    reasons.push(`Timed out · ${(elapsed / 60_000).toFixed(0)}m without GO`);
  }

  // 4. Theta acceleration → confidence downgrade
  let thetaAccelerating = false;
  let effectiveConfidence: Confidence | null = input.confidence ?? null;
  if (memo.thetaHistory.length >= THETA_HISTORY_LEN) {
    const h = memo.thetaHistory;
    let monotonic = true;
    for (let i = 1; i < h.length; i++) if (h[i] <= h[i - 1]) { monotonic = false; break; }
    const growth = h[0] > 0 ? ((h[h.length - 1] - h[0]) / h[0]) * 100 : 0;
    if (monotonic && growth >= THETA_ACCEL_PCT) {
      thetaAccelerating = true;
      if (effectiveConfidence) effectiveConfidence = CONFIDENCE_DOWN[effectiveConfidence];
      reasons.push(`Theta accelerating +${growth.toFixed(0)}% — confidence downgraded`);
    }
  }

  return {
    key: input.key,
    firstSeenPrice: memo.firstSeenPrice,
    firstSeenAt: memo.firstSeenAt,
    driftPct,
    isStale,
    isTimedOut,
    rsiFlipped,
    effectiveVerdict,
    thetaAccelerating,
    effectiveConfidence,
    reasons,
  };
}

/**
 * React hook: tracks first-seen price/time and rolling theta per pick across
 * renders. Returns a Map<key, PickStatus> the caller can look up while
 * rendering each row. Re-evaluates on a 30s tick so timeouts trigger even when
 * upstream data doesn't change.
 */
export function usePickExpiration(picks: PickInputs[]): Map<string, PickStatus> {
  const memoRef = useRef<Map<string, MemoEntry>>(new Map());
  const [tick, setTick] = useState(0);

  // Heartbeat so timeouts fire even if `picks` reference doesn't change.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const out = new Map<string, PickStatus>();
    const seenKeys = new Set<string>();

    for (const p of picks) {
      seenKeys.add(p.key);
      let entry = memoRef.current.get(p.key);
      if (!entry) {
        entry = {
          firstSeenPrice: p.price ?? null,
          firstSeenAt: now,
          thetaHistory: [],
          reachedGoAt: null,
        };
        memoRef.current.set(p.key, entry);
      }
      // Track theta samples (most recent at the end).
      if (p.theta != null && Number.isFinite(p.theta)) {
        const abs = Math.abs(p.theta);
        const last = entry.thetaHistory[entry.thetaHistory.length - 1];
        if (last == null || Math.abs(abs - last) > 1e-6) {
          entry.thetaHistory.push(abs);
          if (entry.thetaHistory.length > THETA_HISTORY_LEN) entry.thetaHistory.shift();
        }
      }
      // Mark the moment we first see GO so the 2h timeout no longer applies.
      if (p.verdict === "GO" && entry.reachedGoAt == null) entry.reachedGoAt = now;

      out.set(p.key, evaluatePick(p, entry, now));
    }

    // Garbage-collect picks we no longer see (avoid unbounded growth).
    for (const key of memoRef.current.keys()) {
      if (!seenKeys.has(key)) memoRef.current.delete(key);
    }

    return out;
  }, [picks, tick]);
}
