// Add to Portfolio — light "trade ticket" dialog that snapshots gates +
// risk parameters into a new portfolio_positions row. Paired with the
// existing BUY NOW broker CTA on every TradeReady pick.
import { useState } from "react";
import { Briefcase, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAddPosition } from "@/lib/portfolio";
import { defaultMaxHoldDays } from "@/lib/exitGuidance";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { ApprovedPick } from "@/lib/useScannerPicks";

interface Props {
  pick: ApprovedPick;
  /** "Add to Portfolio" / "Saved" label changes after success. */
  size?: "sm" | "xs" | "default";
  className?: string;
  variant?: "default" | "outline" | "secondary";
}

function dteFromExpiry(expiry: string): number {
  const t = new Date(expiry + "T16:00:00Z").getTime();
  return Math.max(1, Math.round((t - Date.now()) / 86_400_000));
}

export function AddToPortfolioButton({ pick, size = "sm", className, variant = "outline" }: Props) {
  const [settings] = useSettings();
  const add = useAddPosition();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const dte = dteFromExpiry(pick.contract.expiry);
  const [contracts, setContracts] = useState("1");
  const [entryPrice, setEntryPrice] = useState(pick.premium.toFixed(2));
  const [hardStop, setHardStop] = useState("-30");
  const [t1, setT1] = useState("50");
  const [t2, setT2] = useState("100");
  const [maxHold, setMaxHold] = useState(String(defaultMaxHoldDays(dte)));

  const numContracts = Math.max(1, Math.floor(Number(contracts) || 1));
  const numEntry = Number(entryPrice) || 0;
  const totalCost = numEntry > 0 ? (numEntry * 100 * numContracts).toFixed(0) : null;

  const submit = (e: React.MouseEvent) => {
    e.stopPropagation();
    add.mutate(
      {
        symbol: pick.row.symbol,
        optionType: pick.contract.optionType,
        direction: "long",
        strike: pick.contract.strike,
        expiry: pick.contract.expiry,
        contracts: numContracts,
        entryPremium: numEntry > 0 ? numEntry : null,
        entryUnderlying: pick.row.price,
        thesis: pick.verdict?.reason ?? pick.row.crl?.reason ?? `Setup ${pick.row.setupScore} · ${pick.row.bias}`,
        source: "scanner",
        isPaper: settings.paperMode,
        hardStopPct: Number(hardStop) || -30,
        target1Pct: Number(t1) || 50,
        target2Pct: Number(t2) || 100,
        maxHoldDays: Number(maxHold) || null,
        riskBucket: pick.bucket,
        initialScore: pick.rank?.finalRank ?? pick.row.setupScore,
        initialGates: {
          direction: pick.tradeStatus.direction,
          volume: pick.tradeStatus.volume,
          gap: pick.tradeStatus.gap,
          budget: pick.tradeStatus.budget,
          liquidity: pick.tradeStatus.liquidity,
          tradeStatus: pick.tradeStatus.tradeStatus,
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saved && setOpen(o)}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant={saved ? "secondary" : variant}
          className={cn(
            size === "xs" ? "h-6 px-2 text-[10px]" : size === "default" ? "h-9 px-3" : "h-7 px-2 text-[11px]",
            className,
          )}
          disabled={saved}
          onClick={(e) => e.stopPropagation()}
        >
          {saved ? <Check className="mr-1 h-3 w-3" /> : <Briefcase className="mr-1 h-3 w-3" />}
          {saved ? "Tracking" : "Add to Portfolio"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add to Portfolio</DialogTitle>
          <DialogDescription>
            We'll track this position and alert you when it's time to take profits or cut the loss.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-md border border-border bg-surface/40 p-3">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-mono font-semibold">{pick.row.symbol}</span>
              <Badge variant="outline" className="h-5 text-[10px]">
                ${pick.contract.strike}{pick.contract.optionType === "call" ? "C" : "P"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">exp {pick.contract.expiry}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5 ml-auto">
                {pick.bucket}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Spot ${pick.row.price.toFixed(2)} · {dte} DTE · {pick.rung} rung
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Contracts">
              <Input type="number" min={1} step={1} value={contracts}
                onChange={(e) => setContracts(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Entry $/contract">
              <Input type="number" min={0} step="0.01" value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)} className="h-8 text-xs" />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Hard stop %">
              <Input type="number" step={1} value={hardStop}
                onChange={(e) => setHardStop(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Target 1 %">
              <Input type="number" step={5} value={t1}
                onChange={(e) => setT1(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Target 2 %">
              <Input type="number" step={5} value={t2}
                onChange={(e) => setT2(e.target.value)} className="h-8 text-xs" />
            </Field>
          </div>

          <Field label="Max hold (days)">
            <Input type="number" min={1} step={1} value={maxHold}
              onChange={(e) => setMaxHold(e.target.value)} className="h-8 text-xs" />
          </Field>

          {totalCost && (
            <div className="text-[11px] text-muted-foreground">
              Total cost: <span className="font-mono text-foreground">${totalCost}</span>
              {settings.paperMode && (
                <span className="ml-2 text-warning">· will be saved as paper</span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={add.isPending} onClick={submit}>
            {add.isPending ? "Adding…" : "Add to Portfolio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
