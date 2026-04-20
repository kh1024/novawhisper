// Active risk-bucket UI filter — shared between Scanner and Dashboard.
//
// This is a UI-only filter (pure presentation): it narrows the SAME pick
// pipeline by the row's classified risk badge. It is INTENTIONALLY separate
// from StrategyProfile.riskTolerance (which is the user's persona — drives
// gates, structures, sizing). Two different concepts:
//
//   • StrategyProfile.riskTolerance  → "what trades am I willing to take?"
//   • ActiveBucket                   → "narrow today's surfaced picks to this slice"
//
// localStorage-backed + a tiny pub/sub so flipping the bucket on /dashboard
// instantly re-renders /scanner and vice-versa (spec section 5).
import { useEffect, useState } from "react";

export type ActiveBucket = "All" | "Conservative" | "Moderate" | "Aggressive" | "Lottery";

const KEY = "nova_active_bucket_v1";
const DEFAULT: ActiveBucket = "All";

function readBucket(): ActiveBucket {
  if (typeof window === "undefined") return DEFAULT;
  const raw = window.localStorage.getItem(KEY);
  if (raw === "All" || raw === "Conservative" || raw === "Moderate" || raw === "Aggressive" || raw === "Lottery") {
    return raw;
  }
  return DEFAULT;
}

let state: ActiveBucket = readBucket();
const subs = new Set<(b: ActiveBucket) => void>();

export function getActiveBucket(): ActiveBucket {
  return state;
}

export function setActiveBucket(b: ActiveBucket) {
  state = b;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, b); } catch { /* quota */ }
  }
  subs.forEach((cb) => cb(state));
}

export function useActiveBucket(): [ActiveBucket, (b: ActiveBucket) => void] {
  const [b, setLocal] = useState<ActiveBucket>(state);
  useEffect(() => {
    const cb = (next: ActiveBucket) => setLocal(next);
    subs.add(cb);
    // Cross-tab sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        state = readBucket();
        setLocal(state);
      }
    };
    if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      subs.delete(cb);
      if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [b, setActiveBucket];
}

/**
 * Map a row's classified RiskBadge ("Safe"/"Mild"/"Aggressive") into the
 * UI bucket vocabulary. Lottery is a sub-band of Aggressive surfaced when
 * the row also looks short-dated + high-IV.
 */
export function rowBucket(args: {
  riskBadge: string | null | undefined;
  earningsInDays?: number | null;
  ivRank?: number;
}): ActiveBucket {
  const badge = (args.riskBadge ?? "").toLowerCase();
  const isLottery = (args.ivRank ?? 0) >= 70 && (args.earningsInDays != null && args.earningsInDays <= 7);
  if (isLottery) return "Lottery";
  if (badge.startsWith("safe")) return "Conservative";
  if (badge.startsWith("mild") || badge.startsWith("mod")) return "Moderate";
  if (badge.startsWith("agg")) return "Aggressive";
  return "Moderate"; // default for unclassified rows
}

export function bucketLabel(b: ActiveBucket): string {
  return b;
}

export function bucketEmoji(b: ActiveBucket): string {
  switch (b) {
    case "Conservative": return "🟢";
    case "Moderate":     return "🟡";
    case "Aggressive":   return "🔴";
    case "Lottery":      return "🎲";
    case "All":          return "✦";
  }
}
