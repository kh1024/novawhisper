// Strategy Edit Drawer — compact subset for in-flow tweaks from the Scanner.
//
// Spec section 3: clicking "Edit →" on the StrategyContextBar opens this
// drawer (not a navigation). It exposes the levers most likely to be
// adjusted while looking at picks: per-trade cap, allowed structures, ORB
// lock, and IVP threshold. Anything more elaborate stays on /strategy.
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/Hint";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useStrategyProfile, maxPerTradeDollars, allowedStructureCount, type AllowedStructures } from "@/lib/strategyProfile";
import { useScannerOverrides } from "@/lib/scannerOverrides";

const STRUCTURE_LABELS: Record<keyof AllowedStructures, string> = {
  longCall: "Long Call",
  longPut: "Long Put",
  leapsCall: "LEAPS Call",
  leapsPut: "LEAPS Put",
  callDebitSpread: "Call Debit Spread",
  putDebitSpread: "Put Debit Spread",
};

export function StrategyEditDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profile, update } = useStrategyProfile();
  const { overrides, set } = useScannerOverrides();
  const cap = maxPerTradeDollars(profile);
  const structures = allowedStructureCount(profile.allowedStructures);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Quick-edit Strategy</SheetTitle>
          <SheetDescription>
            Changes apply instantly across Scanner, Chains, and Portfolio. Saved automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Per-trade cap */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Max per trade</Label>
              <span className="mono text-sm font-semibold">{profile.maxPerTradePct}% · ${cap.toLocaleString()}</span>
            </div>
            <Slider
              min={1}
              max={10}
              step={1}
              value={[profile.maxPerTradePct]}
              onValueChange={(v) => update({ maxPerTradePct: v[0] })}
            />
            <p className="text-[11px] text-muted-foreground">
              Account size ${profile.accountSize.toLocaleString()}. Picks costing more than the cap show "OVER BUDGET".
            </p>
          </section>

          {/* Allowed structures */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Structures</Label>
              <span className="text-[11px] text-muted-foreground">{structures} of 6 enabled</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STRUCTURE_LABELS) as (keyof AllowedStructures)[]).map((k) => {
                const checked = profile.allowedStructures[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => update({ allowedStructures: { ...profile.allowedStructures, [k]: !checked } })}
                    className={`text-left text-[12px] rounded-md border px-2.5 py-2 transition-colors ${
                      checked
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border bg-muted/20 text-muted-foreground hover:border-border"
                    }`}
                  >
                    {STRUCTURE_LABELS[k]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Gate overrides (compact) */}
          <section className="space-y-3 pt-2 border-t border-border/60">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Gate overrides</div>
            <div className="flex items-center justify-between">
              <Hint label="Gate 5 — blocks new entries before 10:30 AM ET. Disabling this lets picks fire pre-market.">
                <Label className="text-sm cursor-help">ORB Lock (10:30 AM)</Label>
              </Hint>
              <Switch
                checked={profile.gateOverrides.orbLockEnabled}
                onCheckedChange={(v) => update({ gateOverrides: { ...profile.gateOverrides, orbLockEnabled: v } })}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Hint label="Gate 6 — picks above this IV percentile are blocked because you'd be paying top-of-market for volatility (high crush risk).">
                  <Label className="text-sm cursor-help">IV Percentile max</Label>
                </Hint>
                <span className="mono text-sm font-semibold">{profile.gateOverrides.ivpMaxThreshold}</span>
              </div>
              <Slider
                min={50}
                max={100}
                step={5}
                value={[profile.gateOverrides.ivpMaxThreshold]}
                onValueChange={(v) => update({ gateOverrides: { ...profile.gateOverrides, ivpMaxThreshold: v[0] } })}
              />
            </div>
          </section>

          {/* Universe — Small-Cap Friendly toggle */}
          <section className="space-y-3 pt-2 border-t border-border/60">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Universe</div>
            <div className="flex items-center justify-between">
              <Hint label="Inject ~19 sub-$25 tickers (SOFI, T, NIO, SNAP, AAL, NU, LCID, CCL, HOOD, NOK, SIRI, GRAB, WBD, PLUG, OPEN, KRE, XRT, EEM, FXI) so a small per-trade cap can find affordable ITM calls.">
                <Label className="text-sm cursor-help">Small-Cap Friendly</Label>
              </Hint>
              <Switch
                checked={overrides.smallCapFriendly}
                onCheckedChange={(v) => set("smallCapFriendly", v)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Best for accounts with a per-trade cap under $1,000. Session-scoped — clears on refresh.
            </p>
          </section>
        </div>

        <SheetFooter className="flex-row justify-between gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/strategy" onClick={() => onOpenChange(false)}>
              Full Strategy <ExternalLink className="h-3 w-3" />
            </Link>
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
