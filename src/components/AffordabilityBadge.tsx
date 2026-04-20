// Single, themed badge that any surface (Dashboard pick row, Trade Plan card,
// Scanner card, Research drawer) can drop in to display the user's
// affordability verdict for a candidate trade. Pulls only display logic from
// `affordability.ts` so the tier rules stay testable in pure functions.
import { Wallet, AlertTriangle, Ban, CircleDashed } from "lucide-react";
import { tierLabel, tierTone, type AffordabilityResult } from "@/lib/affordability";
import { cn } from "@/lib/utils";

interface Props {
  result: AffordabilityResult;
  /** Compact = chip only. Detailed = chip + dollar amount + (if blocked) over-by. */
  variant?: "compact" | "detailed";
  className?: string;
}

const ICON = {
  comfortable: Wallet,
  affordable:  Wallet,
  blocked:     Ban,
  unavailable: CircleDashed,
  stale:       AlertTriangle,
} as const;

const TONE_CLS = {
  good:  "bg-bullish/15 text-bullish border-bullish/40",
  ok:    "bg-warning/10 text-warning border-warning/40",
  bad:   "bg-bearish/15 text-bearish border-bearish/50",
  muted: "bg-muted/30 text-muted-foreground border-border",
} as const;

export function AffordabilityBadge({ result, variant = "compact", className }: Props) {
  const Icon = ICON[result.tier];
  const tone = tierTone(result.tier);
  const label = tierLabel(result.tier);
  const cost = result.totalCost;

  const dollars =
    cost == null
      ? null
      : cost >= 1000
        ? `$${(cost / 1000).toFixed(1)}k`
        : `$${cost.toFixed(0)}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono leading-none whitespace-nowrap",
        TONE_CLS[tone],
        className,
      )}
      title={
        result.tier === "blocked" && cost != null
          ? `Blocked — trade cost ${dollars} exceeds your $${result.budget} per-trade budget by $${Math.round(result.overBy)}.`
          : result.tier === "comfortable" || result.tier === "affordable"
            ? `${label}: ${dollars} of $${result.budget} budget`
            : result.reason
      }
    >
      <Icon className="h-3 w-3 shrink-0" />
      {variant === "detailed" && dollars ? (
        <>
          <span>{dollars}</span>
          <span className="opacity-70">·</span>
          <span>{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
      {variant === "detailed" && result.tier === "blocked" && (
        <span className="opacity-80">· over by ${Math.round(result.overBy)}</span>
      )}
    </span>
  );
}
