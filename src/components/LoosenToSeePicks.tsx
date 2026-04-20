// Loosen-To-See Picks — inline panel shown when 0 picks pass the active
// profile but blocked candidates exist. Each button is a session-scoped
// override (cleared on refresh). Spec section 4.
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, ShieldOff, DollarSign, Zap, RotateCcw, Sprout } from "lucide-react";
import { useStrategyProfile, DEFAULT_PROFILE } from "@/lib/strategyProfile";
import { useScannerOverrides } from "@/lib/scannerOverrides";

export function LoosenToSeePicks({
  budgetBlockedCount,
  orbBlockedCount,
  ivBlockedCount,
}: {
  budgetBlockedCount: number;
  orbBlockedCount: number;
  ivBlockedCount: number;
}) {
  const { profile, update } = useStrategyProfile();
  const { overrides, set } = useScannerOverrides();

  const showResetButton = true;

  return (
    <Card className="glass-card p-4 border-warning/40 bg-warning/5 space-y-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">No approved picks match your profile right now.</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Quick fixes — all temporary, undo any time. Your saved profile stays unchanged.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {budgetBlockedCount > 0 && (
          <Button
            size="sm"
            variant={overrides.showBudgetBlocked ? "default" : "outline"}
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => set("showBudgetBlocked", !overrides.showBudgetBlocked)}
          >
            <DollarSign className="h-3.5 w-3.5" />
            {overrides.showBudgetBlocked ? "Hide budget-blocked" : `Show budget-blocked (${budgetBlockedCount})`}
          </Button>
        )}
        {orbBlockedCount > 0 && (
          <Button
            size="sm"
            variant={overrides.bypassOrbLock ? "default" : "outline"}
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => set("bypassOrbLock", !overrides.bypassOrbLock)}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            {overrides.bypassOrbLock ? "Re-enable ORB Lock" : `Disable ORB Lock — unlocks ${orbBlockedCount}`}
          </Button>
        )}
        {ivBlockedCount > 0 && (
          <Button
            size="sm"
            variant={overrides.allowHighIv ? "default" : "outline"}
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => set("allowHighIv", !overrides.allowHighIv)}
          >
            <Zap className="h-3.5 w-3.5" />
            {overrides.allowHighIv ? "Re-enable IV Guard" : `Include high-IV — unlocks ${ivBlockedCount}`}
          </Button>
        )}
        {budgetBlockedCount > 0 && (
          <Button
            size="sm"
            variant={overrides.smallCapFriendly ? "default" : "outline"}
            className="h-8 gap-1.5 text-[12px]"
            onClick={() => set("smallCapFriendly", !overrides.smallCapFriendly)}
            title="Inject ~19 sub-$25 tickers (SOFI, T, NIO, SNAP, AAL, NU, LCID, CCL, HOOD…) so a small cap can find affordable ITM contracts."
          >
            <Sprout className="h-3.5 w-3.5" />
            {overrides.smallCapFriendly ? "Hide Small-Cap universe" : "Add Small-Cap Friendly tickers"}
          </Button>
        )}
        {showResetButton && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-[12px] text-muted-foreground"
            onClick={() => update({ ...DEFAULT_PROFILE, accountSize: profile.accountSize })}
            title="Reset profile to Moderate defaults (keeps account size)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset profile to Moderate
          </Button>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground border-t border-warning/20 pt-2">
        Overrides reset on page refresh. Your saved Strategy profile is the source of truth.
      </div>
    </Card>
  );
}
