// Pre-Market Preview Mode — sticky informational banner shown across
// Scanner / Chains while the 10:30 AM ET ORB lock is active. Amber, not
// red — this is a planning state, not an error. Auto-clears at unlock.
import { Eye, Info, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { Hint } from "@/components/Hint";
import { usePreMarketStatus } from "@/lib/preMarketPreview";

export function PreMarketPreviewBanner() {
  const status = usePreMarketStatus();
  const [justUnlocked, setJustUnlocked] = useState(false);
  const wasPre = useRefValue(status.isPreMarket);

  // Show the "Market Open — Trading Unlocked" pulse for ~60s after release.
  useEffect(() => {
    if (wasPre && !status.isPreMarket) {
      setJustUnlocked(true);
      const id = window.setTimeout(() => setJustUnlocked(false), 60_000);
      return () => window.clearTimeout(id);
    }
  }, [wasPre, status.isPreMarket]);

  if (!status.enabled) return null;

  if (status.isPreMarket) {
    return (
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b border-warning/40 bg-warning/10 backdrop-blur supports-[backdrop-filter]:bg-warning/15">
        <div className="flex items-center gap-2 text-[12px] text-warning max-w-[1600px] mx-auto">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Pre-Market Preview Mode</span>
          <span className="text-warning/80 hidden sm:inline">
            · Picks visible but locked until 10:30 AM ET. Use this time to plan.
          </span>
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono font-semibold">{status.countdown} until ORB release</span>
            <Hint label="Opening Range Breakout: the first 60 minutes after the bell are dominated by gap-fills, MOO order flow, and algo stop-hunts. False breakout rates are highest here. Waiting until 10:30 AM ET lets the opening range settle so signals reflect real demand, not overnight noise.">
              <button
                type="button"
                aria-label="Learn why ORB matters"
                className="inline-flex items-center gap-0.5 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] hover:bg-warning/20 transition-colors"
              >
                <Info className="h-3 w-3" /> Why?
              </button>
            </Hint>
          </span>
        </div>
      </div>
    );
  }

  if (justUnlocked) {
    return (
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b border-bullish/40 bg-bullish/10 backdrop-blur">
        <div className="flex items-center gap-2 text-[12px] text-bullish max-w-[1600px] mx-auto">
          <Unlock className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Market Open — Trading Unlocked</span>
        </div>
      </div>
    );
  }

  return null;
}

// Tiny helper to remember the previous render's value (used so we can detect
// the pre→post unlock edge without bringing in a full ref hook file).
function useRefValue<T>(v: T): T {
  const [prev, setPrev] = useState(v);
  useEffect(() => { setPrev(v); }, [v]);
  return prev;
}
