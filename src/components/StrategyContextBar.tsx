// Strategy Context Bar — sticky chip row at the top of /scanner.
//
// Spec section 3: shows the active StrategyProfile in human terms, live
// pipeline counts, an "Edit →" trigger that opens the compact drawer, and a
// chip whenever the profile filtered something out of the universe. This is
// what makes "0 picks shown" visibly the profile's fault, not a mystery
// failure of the scanner.
import { Pencil, Target, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/Hint";
import {
  useStrategyProfile, personaName, maxPerTradeDollars, allowedStructureCount,
} from "@/lib/strategyProfile";
import { usePreMarketStatus } from "@/lib/preMarketPreview";
import { OVERRIDE_LABELS, useScannerOverrides, type ScannerOverrides } from "@/lib/scannerOverrides";
import { cn } from "@/lib/utils";

export interface PipelineCounts {
  universe: number;
  gatePassing: number;
  gateBlocked: number;
  budgetBlocked: number;
  /** Optional: subset of budgetBlocked routed to "Strong Setups — Over Budget". */
  overBudgetWatchlist?: number;
  shown: number;
  /** Optional reason text e.g. "excluded 4 long puts (profile allows calls only)" */
  filterChip?: string | null;
}

export function StrategyContextBar({
  counts,
  onEdit,
}: {
  counts: PipelineCounts;
  onEdit: () => void;
}) {
  const { profile } = useStrategyProfile();
  const preMarket = usePreMarketStatus();
  const { overrides, set: setOverride, activeCount } = useScannerOverrides();

  const cap = maxPerTradeDollars(profile);
  const structures = allowedStructureCount(profile.allowedStructures);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <Target className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold text-foreground">Active Profile:</span>
        <span className="text-foreground">{personaName(profile)}</span>
        <span className="text-muted-foreground">·</span>
        <Hint label="Per-trade cap = account size × max-per-trade %.">
          <span className="cursor-help">Cap <span className="mono font-semibold text-foreground">${cap.toLocaleString()}</span></span>
        </Hint>
        <span className="text-muted-foreground">·</span>
        <span>{structures} of 6 structures</span>
        {preMarket.isPreMarket && profile.gateOverrides.orbLockEnabled && !overrides.bypassOrbLock && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-warning">ORB locked {preMarket.countdown}</span>
          </>
        )}
        <Button variant="ghost" size="sm" className="h-6 ml-auto px-2 gap-1 text-primary hover:text-primary" onClick={onEdit}>
          <Pencil className="h-3 w-3" /> Edit
        </Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
        <CountChip label="universe" value={counts.universe} />
        <CountChip label="gate-passing" value={counts.gatePassing} tone={counts.gatePassing > 0 ? "good" : "neutral"} />
        <CountChip label="gate-blocked" value={counts.gateBlocked} tone={counts.gateBlocked > 0 ? "warn" : "neutral"} />
        <CountChip label="budget-blocked" value={counts.budgetBlocked} tone={counts.budgetBlocked > 0 ? "warn" : "neutral"} />
        <CountChip label="shown" value={counts.shown} tone={counts.shown > 0 ? "good" : "bad"} />
        {counts.filterChip && (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning text-[10px] gap-1 ml-1">
            <AlertTriangle className="h-3 w-3" />
            Filtered by profile: {counts.filterChip}
          </Badge>
        )}
      </div>

      {activeCount > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-warning/30">
          <span className="text-[10px] uppercase tracking-wider text-warning font-semibold">Session overrides</span>
          {(Object.keys(OVERRIDE_LABELS) as (keyof ScannerOverrides)[])
            .filter((k) => overrides[k])
            .map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setOverride(k, false)}
                className="inline-flex items-center gap-1 rounded-full border border-warning/60 bg-warning/10 px-2 py-0.5 text-[10px] text-warning hover:bg-warning/20 transition-colors"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                {OVERRIDE_LABELS[k]}
                <span className="opacity-70">(undo)</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function CountChip({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const cls = tone === "good"
    ? "text-bullish"
    : tone === "warn"
      ? "text-warning"
      : tone === "bad"
        ? "text-bearish"
        : "text-foreground";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn("mono font-semibold", cls)}>{value}</span>
      <span>{label}</span>
    </span>
  );
}
