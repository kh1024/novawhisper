// Blocked Pick Card — compact card used inside the SAFETY BLOCKED and
// BUDGET BLOCKED collapsibles on the Scanner. Shows ALL the analytical data
// (so the pick stays valuable for planning) plus a clear blocking reason
// and the right action (Monitor for unlock / Suggest cheaper / Open).
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/Hint";
import { ShieldAlert, DollarSign, ExternalLink, BellRing } from "lucide-react";
import type { SetupRow } from "@/lib/setupScore";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { cn } from "@/lib/utils";

export interface BlockedPickInfo {
  row: SetupRow;
  /** "safety" → Gate failure (IVP, RSI, trend, etc.). "budget" → over per-trade cap. */
  kind: "safety" | "budget";
  /** Short reason ("Gate 6 — IV Percentile 87 > 80"). */
  reason: string;
  /** Long-form gate reasoning for the "Why blocked?" tooltip. */
  detail: string;
  /** For budget-blocked picks: the dollar gap. */
  overBudgetBy?: number;
  cap?: number;
  cost?: number;
  contract: {
    optionType: "call" | "put";
    strike: number;
    expiry: string;
  };
}

export function BlockedPickCard({ info, onOpen, onSuggestCheaper, onRaiseCap }: {
  info: BlockedPickInfo;
  onOpen: () => void;
  onSuggestCheaper?: () => void;
  onRaiseCap?: () => void;
}) {
  const { row, kind, reason, detail } = info;
  const isCall = info.contract.optionType === "call";
  const [revealed, setRevealed] = useState(false);

  return (
    <Card className={cn(
      "glass-card p-3.5 space-y-2.5 border",
      kind === "safety" ? "border-bearish/30" : "border-warning/30",
    )}>
      <div className={cn(
        "flex items-center gap-2 -mx-3.5 -mt-3.5 px-3.5 py-2 border-b text-[11px] font-semibold",
        kind === "safety"
          ? "bg-bearish/10 text-bearish border-bearish/30"
          : "bg-warning/10 text-warning border-warning/30",
      )}>
        {kind === "safety" ? <ShieldAlert className="h-3.5 w-3.5" /> : <DollarSign className="h-3.5 w-3.5" />}
        <span>BLOCKED — {reason}</span>
        <Hint label={detail}>
          <button type="button" className="ml-auto text-[10px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100">
            Why blocked?
          </button>
        </Hint>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono font-semibold text-base">{row.symbol}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{row.name}</div>
        </div>
        <div className="text-right">
          <div className={cn("mono text-lg font-semibold", isCall ? "text-bullish" : "text-bearish")}>
            ${info.contract.strike}{isCall ? "C" : "P"}
          </div>
          <div className="text-[10px] text-muted-foreground">exp {info.contract.expiry}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <Stat label="Last" value={`$${row.price.toFixed(2)}`} />
        <Stat label="Chg" value={`${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%`} cls={row.changePct >= 0 ? "text-bullish" : "text-bearish"} />
        <Stat label="IVR" value={String(row.ivRank)} />
        <Stat label="RSI" value={String(row.rsi)} />
      </div>

      {kind === "budget" && info.overBudgetBy != null && info.cap != null && info.cost != null && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-2.5 py-1.5 text-[11px] text-warning space-y-0.5">
          <div>
            Over budget by <span className="mono font-semibold">${info.overBudgetBy.toLocaleString()}</span>
          </div>
          <div className="text-warning/80">
            Cap <span className="mono">${info.cap.toLocaleString()}</span> · This costs <span className="mono">${info.cost.toLocaleString()}</span>
          </div>
        </div>
      )}

      {kind === "budget" && revealed && (
        <div className="rounded-md border border-warning/60 bg-warning/10 px-2.5 py-1.5 text-[10px] font-semibold text-warning uppercase tracking-wider">
          ⚠ Over Budget — Planning Only · Buy disabled
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {kind === "safety" ? (
          <SaveToWatchlistButton
            size="xs"
            symbol={row.symbol}
            direction="long"
            optionType={info.contract.optionType}
            strike={info.contract.strike}
            expiry={info.contract.expiry}
            bias={row.bias}
            tier={row.readiness}
            entryPrice={row.price}
            thesis={`Gate-blocked — ${reason}`}
            source="scanner"
            meta={{ watchForGateFlip: true, blockReason: reason }}
            className="border-primary/40"
          />
        ) : (
          <>
            {onSuggestCheaper && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] gap-1" onClick={onSuggestCheaper}>
                <Search className="h-3 w-3" /> Show cheaper alternative
              </Button>
            )}
            {!revealed && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1 text-warning" onClick={() => setRevealed(true)}>
                <Eye className="h-3 w-3" /> Still show me
              </Button>
            )}
            {onRaiseCap && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-warning" onClick={onRaiseCap}>
                Raise cap
              </Button>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] ml-auto" onClick={onOpen}>
          <ExternalLink className="h-3 w-3 mr-1" /> Open
        </Button>
      </div>

      {kind === "safety" && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <BellRing className="h-3 w-3" />
          "Watch" queues this for an unlock alert when the gate flips.
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("mono font-semibold", cls)}>{value}</div>
    </div>
  );
}

interface BadgeProps { children: React.ReactNode }
// re-export for convenience to keep imports compact in callers
export const _Badge = (p: BadgeProps) => <Badge>{p.children}</Badge>;
