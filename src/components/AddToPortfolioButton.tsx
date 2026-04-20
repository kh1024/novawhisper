// Add to Portfolio — light "trade ticket" dialog. Accepts EITHER a full
// ApprovedPick (Scanner / Top Opportunities) or a generic PickSpec (Watchlist,
// SetupCard, MobileScannerCard) so the button is usable everywhere.
import { useMemo, useState } from "react";
import { Briefcase, Check, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAddPosition, useIsHeld } from "@/lib/portfolio";
import { defaultMaxHoldDays } from "@/lib/exitGuidance";
import { useSettings } from "@/lib/settings";
import { estimatePremium, ivRankToIv } from "@/lib/premiumEstimator";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ApprovedPick } from "@/lib/useScannerPicks";
import { canAddToPortfolio, type TradeStage } from "@/lib/tradeStage";

/** Generic shape any pick surface can supply. */
export interface PickSpec {
  symbol: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
  /** Live underlying price (optional — used for BS-lite premium prefill if no premium given). */
  spot?: number | null;
  /** Per-share option premium if already known (e.g. from the strike ladder). */
  premium?: number | null;
  /** Used to seed BS-lite if premium is missing. Defaults to 50. */
  ivRank?: number | null;
  /** Risk bucket label (Conservative / Moderate / Aggressive / Lottery). */
  bucket?: string;
  /** Snapshot of gates / status flags at entry — saved into initial_gates. */
  initialGates?: Record<string, unknown>;
  /** Score at entry. */
  initialScore?: number | null;
  /** Plain-language thesis. */
  thesis?: string | null;
  /** Source surface — "scanner" / "watchlist" / "top-opportunities" etc. */
  source?: string;
  /** Trade stage — only ENTRY_CONFIRMED / OPEN_POSITION may add. */
  tradeStage?: TradeStage;
}

interface Props {
  /** Either pass the rich ApprovedPick or a generic PickSpec. */
  pick?: ApprovedPick;
  spec?: PickSpec;
  size?: "sm" | "xs" | "default";
  className?: string;
  variant?: "default" | "outline" | "secondary";
  /** When true, render only an icon (mobile / dense rows). */
  iconOnly?: boolean;
}

function dteFromExpiry(expiry: string): number {
  const t = new Date(expiry + "T16:00:00Z").getTime();
  return Math.max(1, Math.round((t - Date.now()) / 86_400_000));
}

function specFromPick(pick: ApprovedPick): PickSpec {
  return {
    symbol: pick.row.symbol,
    optionType: pick.contract.optionType,
    strike: pick.contract.strike,
    expiry: pick.contract.expiry,
    spot: pick.row.price,
    premium: pick.premium,
    ivRank: pick.row.ivRank,
    bucket: pick.bucket,
    initialScore: pick.rank?.finalRank ?? pick.row.setupScore,
    thesis: pick.verdict?.reason ?? pick.row.crl?.reason ?? `Setup ${pick.row.setupScore} · ${pick.row.bias}`,
    source: "scanner",
    initialGates: {
      direction: pick.tradeStatus.direction,
      volume: pick.tradeStatus.volume,
      gap: pick.tradeStatus.gap,
      budget: pick.tradeStatus.budget,
      liquidity: pick.tradeStatus.liquidity,
      tradeStatus: pick.tradeStatus.tradeStatus,
      tradeStage: pick.tradeStage,
    },
  };
}

export function AddToPortfolioButton({ pick, spec, size = "sm", className, variant = "outline", iconOnly = false }: Props) {
  const resolved: PickSpec | null = useMemo(() => {
    if (spec) return spec;
    if (pick) return specFromPick(pick);
    return null;
  }, [pick, spec]);

  const [settings] = useSettings();
  const add = useAddPosition();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Already-held detection — keeps users from double-adding the same contract.
  const held = useIsHeld(
    resolved?.symbol ?? "",
    resolved?.optionType ?? "call",
    resolved?.strike ?? 0,
    resolved?.expiry ?? "",
  );

  // Prefill premium: explicit > BS-lite (DTE > 7) > spot fallback.
  const dte = resolved ? dteFromExpiry(resolved.expiry) : 30;
  const prefilledPremium = useMemo(() => {
    if (!resolved) return 0;
    if (resolved.premium != null && resolved.premium > 0) return resolved.premium;
    if (resolved.spot != null && resolved.spot > 0) {
      const est = estimatePremium({
        spot: resolved.spot,
        strike: resolved.strike,
        iv: ivRankToIv(resolved.ivRank ?? 50),
        dte: Math.max(1, dte),
        optionType: resolved.optionType,
      });
      return est.perShare;
    }
    return 0;
  }, [resolved, dte]);

  const [contracts, setContracts] = useState("1");
  const [entryPrice, setEntryPrice] = useState(prefilledPremium > 0 ? prefilledPremium.toFixed(2) : "");
  const [hardStop, setHardStop] = useState("-30");
  const [t1, setT1] = useState("50");
  const [t2, setT2] = useState("100");
  const [maxHold, setMaxHold] = useState(String(defaultMaxHoldDays(dte)));
  const [notes, setNotes] = useState("");

  if (!resolved) return null;

  // Stage gate — only ENTRY_CONFIRMED ideas (or already-OPEN positions) may add.
  const stage = pick?.tradeStage ?? spec ? (pick?.tradeStage ?? "ENTRY_CONFIRMED") : "ENTRY_CONFIRMED";
  const stageAllowsAdd = canAddToPortfolio(stage as TradeStage) || held.held;

  const numContracts = Math.max(1, Math.floor(Number(contracts) || 1));
  const numEntry = Number(entryPrice) || 0;
  const totalCost = numEntry > 0 ? (numEntry * 100 * numContracts).toFixed(0) : null;

  // Already-held → render a "View in Portfolio" link instead of the dialog.
  if (held.held && !add.isPending) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className={cn(
          size === "xs" ? "h-6 px-2 text-[10px]" : size === "default" ? "h-9 px-3" : "h-7 px-2 text-[11px]",
          "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          navigate(held.id ? `/portfolio#pos-${held.id}` : "/portfolio");
        }}
      >
        <Check className="mr-1 h-3 w-3" />
        {iconOnly ? "" : "In Portfolio"}
      </Button>
    );
  }

  const submit = (e: React.MouseEvent) => {
    e.stopPropagation();
    add.mutate(
      {
        symbol: resolved.symbol,
        optionType: resolved.optionType,
        direction: "long",
        strike: resolved.strike,
        expiry: resolved.expiry,
        contracts: numContracts,
        entryPremium: numEntry > 0 ? numEntry : null,
        entryUnderlying: resolved.spot ?? null,
        thesis: notes.trim() || resolved.thesis || null,
        source: resolved.source ?? "scanner",
        isPaper: settings.paperMode,
        hardStopPct: Number(hardStop) || -30,
        target1Pct: Number(t1) || 50,
        target2Pct: Number(t2) || 100,
        maxHoldDays: Number(maxHold) || null,
        riskBucket: resolved.bucket ?? null,
        initialScore: resolved.initialScore ?? null,
        initialGates: resolved.initialGates ?? null,
      },
      {
        onSuccess: () => {
          setOpen(false);
          // Custom toast with View-in-Portfolio link
          toast({
            title: `${resolved.symbol} $${resolved.strike}${resolved.optionType === "call" ? "C" : "P"} added to Portfolio`,
            description: "Exit guidance will update every 5 min during market hours.",
            action: (
              <button
                onClick={() => navigate("/portfolio")}
                className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                View in Portfolio <ExternalLink className="h-3 w-3" />
              </button>
            ) as never,
          });
        },
      },
    );
  };

  // Stage gate UI — when not eligible, render a disabled "Wait for Confirmation" pill
  // instead of the dialog trigger so the user can never accidentally enter a non-confirmed trade.
  if (!stageAllowsAdd) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        className={cn(
          size === "xs" ? "h-6 px-2 text-[10px]" : size === "default" ? "h-9 px-3" : "h-7 px-2 text-[11px]",
          "border-warning/40 bg-warning/5 text-warning cursor-not-allowed",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        title="Add to Portfolio unlocks once direction, volume, gap and liquidity are all confirmed."
      >
        <Briefcase className={cn("h-3 w-3", !iconOnly && "mr-1")} />
        {!iconOnly && "Wait — not confirmed"}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant={variant}
          className={cn(
            size === "xs" ? "h-6 px-2 text-[10px]" : size === "default" ? "h-9 px-3" : "h-7 px-2 text-[11px]",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
          aria-label="Add to Portfolio"
        >
          <Briefcase className={cn("h-3 w-3", !iconOnly && "mr-1")} />
          {!iconOnly && "Add to Portfolio"}
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
              <span className="font-mono font-semibold">{resolved.symbol}</span>
              <Badge variant="outline" className="h-5 text-[10px]">
                ${resolved.strike}{resolved.optionType === "call" ? "C" : "P"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">exp {resolved.expiry}</span>
              {resolved.bucket && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5 ml-auto">
                  {resolved.bucket}
                </span>
              )}
            </div>
            {resolved.spot != null && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Spot ${resolved.spot.toFixed(2)} · {dte} DTE
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Contracts">
              <Input type="number" min={1} step={1} value={contracts}
                onChange={(e) => setContracts(e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Entry $/contract">
              <Input type="number" min={0} step="0.01" value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)} className="h-8 text-xs"
                placeholder="0.00" />
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

          <Field label="Notes (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={resolved.thesis ?? "Why this trade…"}
              className="h-8 text-xs" />
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
