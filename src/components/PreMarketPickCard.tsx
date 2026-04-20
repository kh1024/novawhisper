// Pre-Market Pick Card — compact card used by the pre-market generator.
// Each shows the pick + a 3-scenario "Opening plan" so the user can act
// the moment the bell rings.
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sunrise, ArrowUpRight, ArrowRight, ArrowDownRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreMarketPick } from "@/lib/preMarketGenerator";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";

export function PreMarketPickCard({ pick, onOpen }: { pick: PreMarketPick; onOpen: () => void }) {
  const isCall = pick.bias === "bullish";
  return (
    <Card className="glass-card p-3.5 space-y-2.5 border border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 -mx-3.5 -mt-3.5 px-3.5 py-1.5 border-b border-warning/30 bg-warning/10 text-[11px] font-semibold text-warning">
        <Sunrise className="h-3.5 w-3.5" />
        <span>PRE-MARKET · {pick.kind.toUpperCase()}</span>
        <span className="ml-auto text-[10px] text-warning/80">{pick.dte}d DTE</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono font-semibold text-base">{pick.symbol}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{pick.row.name}</div>
        </div>
        <div className="text-right">
          <div className={cn("mono text-lg font-semibold", isCall ? "text-bullish" : "text-bearish")}>
            ${pick.strike}{isCall ? "C" : "P"}
          </div>
          <div className="text-[10px] text-muted-foreground">exp {pick.expiry}</div>
        </div>
      </div>

      <div className="text-[11px] text-foreground/85">{pick.thesis}</div>

      <div className="space-y-1 pt-2 border-t border-warning/30 text-[11px]">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Opening plan</div>
        <PlanRow Icon={ArrowUpRight} cls="text-bullish" label="Gap up + holds" text={pick.plan.ifGapUpHolds} />
        <PlanRow Icon={ArrowRight} cls="text-warning" label="Gap up + fades" text={pick.plan.ifGapUpFades} />
        <PlanRow Icon={ArrowDownRight} cls="text-bearish" label="Gap down" text={pick.plan.ifGapDown} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <SaveToWatchlistButton
          size="xs"
          symbol={pick.symbol}
          direction="long"
          optionType={isCall ? "call" : "put"}
          strike={pick.strike}
          expiry={pick.expiry}
          bias={pick.bias}
          tier={pick.row.readiness}
          entryPrice={pick.row.price}
          thesis={pick.thesis}
          source="scanner"
          meta={{ preMarketKind: pick.kind, openingPlan: pick.plan }}
        />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] ml-auto" onClick={onOpen}>
          <ExternalLink className="h-3 w-3 mr-1" /> Open
        </Button>
      </div>
    </Card>
  );
}

function PlanRow({ Icon, cls, label, text }: { Icon: typeof ArrowUpRight; cls: string; label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <Icon className={cn("h-3 w-3 mt-0.5 shrink-0", cls)} />
      <div>
        <div className={cn("text-[10px] font-semibold uppercase tracking-wider", cls)}>{label}</div>
        <div className="text-foreground/85">{text}</div>
      </div>
    </div>
  );
}
