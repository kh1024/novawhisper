// Tiny visual chips surfacing Pick-Expiration verdicts (stale / timeout / RSI
// flip / theta downgrade). Used by Scanner and Web Picks so the rules look
// consistent across the app.
import { AlertTriangle, Clock, TrendingDown, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PickStatus } from "@/lib/pickExpiration";

export function PickExpiryChips({ status, compact }: { status: PickStatus | undefined; compact?: boolean }) {
  if (!status) return null;
  const chips: { label: string; cls: string; Icon: typeof Clock; title: string }[] = [];

  if (status.isStale) {
    chips.push({
      label: compact ? "Stale" : `Stale ${status.driftPct! >= 0 ? "+" : ""}${status.driftPct!.toFixed(1)}%`,
      cls: "text-warning border-warning/40 bg-warning/10",
      Icon: AlertTriangle,
      title: `Price drifted ${status.driftPct?.toFixed(2)}% from when this pick was generated — re-scan recommended.`,
    });
  }
  if (status.isTimedOut) {
    chips.push({
      label: "Timed out",
      cls: "text-bearish border-bearish/40 bg-bearish/10",
      Icon: Clock,
      title: "Pick never reached GO within 2 hours — removed from active list to prevent chasing old setups.",
    });
  }
  if (status.rsiFlipped) {
    chips.push({
      label: "RSI flip",
      cls: "text-warning border-warning/40 bg-warning/10",
      Icon: ShieldAlert,
      title: "RSI > 75 — verdict forced to WAIT (overbought).",
    });
  }
  if (status.thetaAccelerating) {
    chips.push({
      label: "θ↑",
      cls: "text-warning border-warning/40 bg-warning/10",
      Icon: TrendingDown,
      title: "Theta is accelerating — confidence downgraded.",
    });
  }

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.title}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
            c.cls,
          )}
        >
          <c.Icon className="h-2.5 w-2.5" />
          {c.label}
        </span>
      ))}
    </div>
  );
}
