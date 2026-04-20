// Budget / Strategy Mismatch — shown on the Scanner when the active profile
// is "Conservative" but the per-trade cap is too small to clear any blue-chip
// Deep-ITM premium. Replaces the generic empty state with three concrete
// one-click fixes (raise cap, switch universe, switch persona).
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TriangleAlert, DollarSign, ArrowRightLeft, Layers } from "lucide-react";
import { useStrategyProfile } from "@/lib/strategyProfile";
import { useScannerOverrides } from "@/lib/scannerOverrides";
import { CONSERVATIVE_CHEAP_TICKERS } from "@/lib/bucketing";

export function BudgetMismatchCard({
  cap,
  budgetBlockedCount,
}: { cap: number; budgetBlockedCount: number }) {
  const { update } = useStrategyProfile();
  const { set } = useScannerOverrides();

  return (
    <Card className="glass-card p-4 border-warning/40 bg-warning/5 space-y-3">
      <div className="flex items-start gap-2">
        <TriangleAlert className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">Budget / Strategy Mismatch</div>
          <div className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Conservative setups on blue-chip names (SPY, QQQ, AAPL, MSFT) typically
            cost <span className="mono text-foreground">$1,500–$4,000</span> per
            contract because Deep ITM premium is mostly intrinsic. Your current
            per-trade cap of <span className="mono text-foreground">${cap.toLocaleString()}</span>{" "}
            excludes most conservative picks by design{budgetBlockedCount > 0 ? ` — ${budgetBlockedCount} are blocked right now` : ""}.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => set("perTradeCapOverride", 2500)}
        >
          <DollarSign className="h-3.5 w-3.5" />
          Raise cap to $2,500 for today
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => set("conservativeCheapOnly", true)}
          title={`Restrict universe to: ${CONSERVATIVE_CHEAP_TICKERS.slice(0, 8).join(", ")}…`}
        >
          <Layers className="h-3.5 w-3.5" />
          Scan cheaper Conservative tickers
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => update({ riskTolerance: "Moderate", horizon: "Swing", minDTE: 30, maxDTE: 45 })}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Switch to Moderate (30–45 DTE)
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground border-t border-warning/20 pt-2">
        Cap raise + universe swap reset on refresh. Switching to Moderate writes
        your saved profile.
      </div>
    </Card>
  );
}
