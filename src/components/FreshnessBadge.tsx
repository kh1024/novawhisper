// Compact freshness + confidence badge for live quotes.
//
// Renders a tiny pill that surfaces three trust signals at once:
//   • Age of the quote: "12s", "2m", "1h" — relative to NOW
//   • Status tone: realtime (green) / delayed (amber) / stale (red)
//   • Confidence chip when multi-source consensus is strong (>=2 fresh sources
//     within 0.25%) or warns when liquidity looks thin (volume == 0)
//
// Designed to sit beside <TickerPrice /> without crowding the row.
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VerifiedQuote } from "@/lib/liveData";

interface Props {
  quote: Pick<VerifiedQuote, "updatedAt" | "status" | "diffPct" | "sources" | "volume"> | null | undefined;
  className?: string;
  /** Hide the confidence chip — useful on dense rows. */
  compact?: boolean;
}

function ageSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

function formatAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/**
 * Trust tier for a quote — drives the colored age pill.
 *  realtime  : <= 60s, status verified/close
 *  fresh     : <= 5 min
 *  delayed   : <= 30 min OR status === "stale"
 *  stale     : > 30 min OR status === "unavailable"
 */
function trustTier(ageSec: number, status: VerifiedQuote["status"]): "realtime" | "fresh" | "delayed" | "stale" {
  if (status === "unavailable") return "stale";
  if (status === "stale") return "delayed";
  if (ageSec <= 60) return "realtime";
  if (ageSec <= 5 * 60) return "fresh";
  if (ageSec <= 30 * 60) return "delayed";
  return "stale";
}

const TIER_CLS: Record<ReturnType<typeof trustTier>, string> = {
  realtime: "border-bullish/40 bg-bullish/10 text-bullish",
  fresh:    "border-primary/40 bg-primary/10 text-primary",
  delayed:  "border-warning/40 bg-warning/10 text-warning",
  stale:    "border-bearish/40 bg-bearish/10 text-bearish",
};

const TIER_LABEL: Record<ReturnType<typeof trustTier>, string> = {
  realtime: "Real-Time",
  fresh:    "Live",
  delayed:  "Delayed",
  stale:    "Stale",
};

export function FreshnessBadge({ quote, className, compact = false }: Props) {
  // Re-render every 5s so "12s ago" actually counts up live.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  if (!quote) return null;
  const age = ageSeconds(quote.updatedAt);
  if (age == null) return null;

  const tier = trustTier(age, quote.status);
  const liveCount = Object.values(quote.sources ?? {}).filter((v) => v != null && Number(v) > 0).length;
  const highConfidence = liveCount >= 2 && (quote.diffPct ?? 0) < 0.25 && (tier === "realtime" || tier === "fresh");
  const lowLiquidity = (quote.volume ?? 0) === 0 && quote.status !== "unavailable";

  const tip = (
    <div className="space-y-1 text-xs leading-snug">
      <div className="font-semibold">{TIER_LABEL[tier]} feed</div>
      <div className="text-muted-foreground">Last tick: {formatAge(age)} ago</div>
      <div className="text-muted-foreground">Verified by {liveCount} source{liveCount === 1 ? "" : "s"}</div>
      {highConfidence && <div className="text-bullish">✓ High confidence — sources agree.</div>}
      {lowLiquidity && <div className="text-warning">⚠ Low liquidity — volume reading unavailable.</div>}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1", className)}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1 py-0 text-[9px] font-mono uppercase tracking-wider cursor-help",
                TIER_CLS[tier],
              )}
            >
              <span className={cn(
                "h-1 w-1 rounded-full",
                tier === "realtime" && "bg-bullish animate-pulse",
                tier === "fresh" && "bg-primary",
                tier === "delayed" && "bg-warning",
                tier === "stale" && "bg-bearish",
              )} />
              {formatAge(age)}
            </span>
            {!compact && highConfidence && (
              <span className="inline-flex items-center rounded border border-bullish/40 bg-bullish/10 px-1 py-0 text-[9px] font-mono uppercase tracking-wider text-bullish">
                hi-conf
              </span>
            )}
            {!compact && lowLiquidity && (
              <span className="inline-flex items-center rounded border border-warning/40 bg-warning/10 px-1 py-0 text-[9px] font-mono uppercase tracking-wider text-warning">
                low-liq
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px]">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
