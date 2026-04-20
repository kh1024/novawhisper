// Pre-Market Preview Mode helpers — pure time math + a tiny React hook.
// The 10:30 AM ET ORB lock is a real safety constraint (Gate 5), but blocking
// the user from VIEWING the scanner during pre-market wastes valuable
// planning time. These helpers tell the UI layer when to render the amber
// "preview" banners + countdown without ever weakening the gate itself.
import { useEffect, useState } from "react";
import { getActiveStrategyProfile, subscribeToStrategyProfile } from "@/lib/strategyProfile";

/** Returns the current wall-clock in America/New_York as an h:mm:dow tuple. */
function nowEt(): { hour: number; minute: number; dow: number; date: Date } {
  const date = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { hour: date.getHours(), minute: date.getMinutes(), dow: date.getDay(), date };
}

export interface PreMarketStatus {
  /** True on a weekday before 10:30 AM ET. */
  isPreMarket: boolean;
  /** Minutes (rounded up) until 10:30 AM ET unlocks. 0 once unlocked. */
  minutesUntilUnlock: number;
  /** Pretty countdown like "1h 12m" or "8m". */
  countdown: string;
  /** Strategy profile flag — when off, callers should fall back to strict-hide. */
  enabled: boolean;
}

export function computePreMarketStatus(enabled: boolean): PreMarketStatus {
  const { hour, minute, dow } = nowEt();
  const totalMin = hour * 60 + minute;
  const unlockMin = 10 * 60 + 30;
  const isWeekday = dow >= 1 && dow <= 5;
  const before = isWeekday && totalMin < unlockMin;
  const minutesUntilUnlock = before ? Math.max(0, unlockMin - totalMin) : 0;
  const h = Math.floor(minutesUntilUnlock / 60);
  const m = minutesUntilUnlock % 60;
  const countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { isPreMarket: before, minutesUntilUnlock, countdown, enabled };
}

/**
 * React hook — re-evaluates every 60s so the countdown ticks down and the
 * banner auto-clears at exactly 10:30 AM ET.
 */
export function usePreMarketStatus(): PreMarketStatus {
  const [enabled, setEnabled] = useState<boolean>(
    () => getActiveStrategyProfile().gateOverrides.preMarketPreviewEnabled !== false,
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    const unsub = subscribeToStrategyProfile((p) =>
      setEnabled(p.gateOverrides.preMarketPreviewEnabled !== false),
    );
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);

  // tick is referenced so React re-runs computePreMarketStatus each minute.
  void tick;
  return computePreMarketStatus(enabled);
}
