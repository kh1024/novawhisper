// React hook that resolves the best-available IVP for Gate 6.
// Tries true 52-week history (iv_history table, ≥60 samples) first; returns
// `null` when history isn't trustworthy yet so the gate adapter can fall back
// to the chain-envelope proxy. Memoized per (symbol, atm-IV signature).
import { useEffect, useState } from "react";
import type { OptionContract } from "@/lib/liveData";
import { ivpPreferred } from "@/lib/ivPercentile";

export interface ResolvedIvp {
  ivp: number;
  source: "history" | "chain";
}

export function useResolvedIvp(
  symbol: string | null | undefined,
  chain: OptionContract[] | null | undefined,
  spot: number | null | undefined,
  type: "call" | "put",
): ResolvedIvp | null {
  const [result, setResult] = useState<ResolvedIvp | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!symbol || !chain || chain.length === 0 || !spot || spot <= 0) {
      setResult(null);
      return;
    }
    ivpPreferred(symbol, chain, spot, type)
      .then((r) => {
        if (cancelled) return;
        // Only surface to Gate 6 when source === "history". When the source is
        // the chain envelope, return null and let the adapter compute its own
        // chain IVP — keeps a single source of truth for that path.
        if (r && r.source === "history") {
          setResult({ ivp: r.ivp, source: "history" });
        } else {
          setResult(null);
        }
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
    // Re-resolve when the underlying or spot changes. Chain identity churns
    // every refresh; we depend on length as a cheap proxy for "has data".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, spot, type, chain?.length]);

  return result;
}
