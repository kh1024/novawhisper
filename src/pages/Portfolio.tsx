// Portfolio — saved options positions with live exit guidance.
//
// Each open position is evaluated by the exit-guidance engine (preview here,
// authoritative writes from the cron). The page shows entry/current/profit%,
// 5 gate chips (Direction/Volume/Gap/Budget/Liquidity at entry), and a
// recommendation line: HOLD / TRIM / TAKE PROFIT / SELL AT LOSS / TIME EXIT.
import { useMemo, useState } from "react";
import { Briefcase, RefreshCw, Trash2, FlaskConical, Loader2, Pencil, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  usePortfolio, useClosePosition, useDeletePosition, useUpdatePositionTargets,
  type PortfolioPosition,
} from "@/lib/portfolio";
import { useLiveQuotes, type VerifiedQuote } from "@/lib/liveData";
import { estimatePremium, ivRankToIv } from "@/lib/premiumEstimator";
import {
  getExitRecommendation, EXIT_LABEL, EXIT_CLASSES, type ExitRecommendation,
} from "@/lib/exitGuidance";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "open" | "closed";

const REC_FILTERS: Array<"ALL" | ExitRecommendation> = [
  "ALL", "HOLD", "TRIM_PARTIAL", "TAKE_PROFIT", "SELL_AT_LOSS", "TIME_EXIT", "NO_SIGNAL",
];

function dteFromExpiry(expiry: string): number {
  const t = new Date(expiry + "T16:00:00Z").getTime();
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}

function fmtUsd(n: number) {
  const s = n >= 0 ? "+" : "−";
  return `${s}$${Math.abs(n).toFixed(0)}`;
}

/** Estimate live option mid from underlying using BS-lite. Used only for the
 *  client-side preview; the cron writes the authoritative number. */
function previewExitDecision(p: PortfolioPosition, spot: number | null) {
  if (p.entry_premium == null) return null;
  if (spot == null) {
    // No live quote — fall back to whatever the cron last wrote.
    if (p.current_price == null) return null;
    return getExitRecommendation(
      {
        side: p.option_type.toLowerCase().includes("call") ? "CALL" : "PUT",
        entry_price: Number(p.entry_premium),
        hard_stop_pct: Number(p.hard_stop_pct),
        target_1_pct: Number(p.target_1_pct),
        target_2_pct: Number(p.target_2_pct),
        max_hold_days: p.max_hold_days,
        thesis_bias: p.option_type.toLowerCase().includes("put") ? "bearish" : "bullish",
      },
      {
        underlyingPrice: spot ?? Number(p.current_price),
        optionMidPrice: Number(p.current_price),
        vwap: spot ?? Number(p.current_price),
        intradayMA: spot ?? Number(p.current_price),
        openingRangeHigh: 0, openingRangeLow: 0,
        relVolume: 1, timeOfDayMinutes: 60,
        daysToExpiry: dteFromExpiry(p.expiry),
      },
    );
  }
  const isCall = p.option_type.toLowerCase().includes("call");
  // Approximate IV from a 50 ivRank (good enough for preview).
  const est = estimatePremium({
    spot, strike: Number(p.strike), iv: ivRankToIv(50),
    dte: Math.max(1, dteFromExpiry(p.expiry)),
    optionType: isCall ? "call" : "put",
  });
  return getExitRecommendation(
    {
      side: isCall ? "CALL" : "PUT",
      entry_price: Number(p.entry_premium),
      hard_stop_pct: Number(p.hard_stop_pct),
      target_1_pct: Number(p.target_1_pct),
      target_2_pct: Number(p.target_2_pct),
      max_hold_days: p.max_hold_days,
      thesis_bias: isCall ? "bullish" : "bearish",
    },
    {
      underlyingPrice: spot,
      optionMidPrice: est.perShare,
      vwap: spot, intradayMA: spot,
      openingRangeHigh: 0, openingRangeLow: 0,
      relVolume: 1, timeOfDayMinutes: 60,
      daysToExpiry: dteFromExpiry(p.expiry),
    },
  );
}

export default function Portfolio() {
  const { data: positions = [], isLoading, refetch, isFetching } = usePortfolio();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [recFilter, setRecFilter] = useState<"ALL" | ExitRecommendation>("ALL");

  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);
  const { data: quotes = [] } = useLiveQuotes(symbols);
  const quoteMap = useMemo(
    () => new Map<string, VerifiedQuote>((quotes as VerifiedQuote[]).map((q) => [q.symbol, q])),
    [quotes],
  );

  const filtered = useMemo(() => {
    let rows = positions;
    if (status === "open") rows = rows.filter((p) => p.status === "open");
    else if (status === "closed") rows = rows.filter((p) => p.status !== "open");
    if (recFilter !== "ALL" && status === "open") {
      rows = rows.filter((p) => {
        const dec = previewExitDecision(p, quoteMap.get(p.symbol)?.price ?? null);
        return (dec?.recommendation ?? p.exit_recommendation) === recFilter;
      });
    }
    return rows;
  }, [positions, status, recFilter, quoteMap]);

  const counts = useMemo(() => {
    const open = positions.filter((p) => p.status === "open");
    const closed = positions.filter((p) => p.status !== "open");
    let realized = 0;
    for (const p of closed) if (p.realized_pnl != null) realized += Number(p.realized_pnl);
    let unrealized = 0;
    for (const p of open) {
      if (p.entry_premium == null) continue;
      const spot = quoteMap.get(p.symbol)?.price;
      if (spot == null && p.current_price == null) continue;
      const isCall = p.option_type.toLowerCase().includes("call");
      let mid: number;
      if (spot != null) {
        const est = estimatePremium({
          spot, strike: Number(p.strike), iv: ivRankToIv(50),
          dte: Math.max(1, dteFromExpiry(p.expiry)),
          optionType: isCall ? "call" : "put",
        });
        mid = est.perShare;
      } else {
        mid = Number(p.current_price);
      }
      const sign = p.direction === "long" ? 1 : -1;
      unrealized += sign * (mid - Number(p.entry_premium)) * 100 * p.contracts;
    }
    return { open: open.length, closed: closed.length, realized, unrealized, total: realized + unrealized };
  }, [positions, quoteMap]);

  return (
    <div className="space-y-5 p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" /> Portfolio · live exit guidance
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Your Plays</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every open position is monitored against your hard stop, profit targets, and trend rules.
            Recommendations refresh every 5 minutes during market hours.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Stat label="Open" value={String(counts.open)} />
          <Stat label="Unrealized (est.)" value={fmtUsd(counts.unrealized)} tone={counts.unrealized >= 0 ? "bullish" : "bearish"} />
          <Stat label="Realized" value={fmtUsd(counts.realized)} tone={counts.realized >= 0 ? "bullish" : "bearish"} />
          <Stat label="Total P&L" value={fmtUsd(counts.total)} tone={counts.total >= 0 ? "bullish" : "bearish"} />
          <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">All ({positions.length})</TabsTrigger>
            <TabsTrigger value="open">Open ({counts.open})</TabsTrigger>
            <TabsTrigger value="closed">Closed ({counts.closed})</TabsTrigger>
          </TabsList>
        </Tabs>

        {status === "open" && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-1">Recommendation:</span>
            {REC_FILTERS.map((r) => (
              <button
                key={r}
                onClick={() => setRecFilter(r)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded border transition-colors",
                  recFilter === r
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:bg-surface",
                )}
              >
                {r === "ALL" ? "All" : EXIT_LABEL[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      <Tabs value={status}>
        <TabsContent value={status} className="mt-0">
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {status === "open"
                ? "No open positions yet. Hit Add to Portfolio on any Trade-Ready pick to start tracking."
                : status === "closed"
                ? "No closed positions yet."
                : "No positions yet."}
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((p) => (
                <PositionCard key={p.id} p={p} spot={quoteMap.get(p.symbol)?.price} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bullish" | "bearish" }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn(
        "font-mono text-lg font-semibold",
        tone === "bullish" && "text-bullish",
        tone === "bearish" && "text-bearish",
      )}>{value}</div>
    </div>
  );
}

function PositionCard({ p, spot }: { p: PortfolioPosition; spot?: number }) {
  const close = useClosePosition();
  const del = useDeletePosition();
  const updateTargets = useUpdatePositionTargets();

  const isCall = p.option_type.toLowerCase().includes("call");
  const dte = dteFromExpiry(p.expiry);
  const isOpen = p.status === "open";
  const quoteUnavailable = isOpen && p.last_quote_quality != null && p.last_quote_quality !== "VALID";
  // Only run live exit-decision preview for OPEN positions with a valid quote.
  // Invalid/stale/missing quotes must use the persisted frozen mark from the exit engine.
  const dec = isOpen && !quoteUnavailable ? previewExitDecision(p, spot ?? null) : null;
  const recommendation = (dec?.recommendation ?? p.exit_recommendation) as ExitRecommendation;
  const reason = dec?.reason ?? p.exit_reason ?? "Awaiting first evaluation tick.";
  const realizedPct = (!isOpen && p.entry_premium != null && p.close_premium != null && Number(p.entry_premium) > 0)
    ? ((Number(p.close_premium) - Number(p.entry_premium)) / Number(p.entry_premium)) * 100
    : null;
  const profitPct = isOpen
    ? (dec?.profitPct ?? (p.current_profit_pct != null ? Number(p.current_profit_pct) : null))
    : realizedPct;

  // Prefer the validated mark written by the exit engine. Only fall back to a
  // client estimate when we truly have no persisted current_price yet.
  let currentMid: number | null = null;
  if (isOpen && p.current_price != null) {
    currentMid = Number(p.current_price);
  } else if (isOpen && spot != null && p.entry_premium != null) {
    currentMid = estimatePremium({
      spot, strike: Number(p.strike), iv: ivRankToIv(50),
      dte: Math.max(1, dte),
      optionType: isCall ? "call" : "put",
    }).perShare;
  }
  const quoteUnavailable = isOpen && p.last_quote_quality != null && p.last_quote_quality !== "VALID";

  const initialGates = (p.initial_gates ?? {}) as Record<string, string>;

  const [closeOpen, setCloseOpen] = useState(false);
  const [closePrice, setClosePrice] = useState(currentMid != null ? currentMid.toFixed(2) : "");
  const [editOpen, setEditOpen] = useState(false);
  const [hardStop, setHardStop] = useState(String(p.hard_stop_pct));
  const [t1, setT1] = useState(String(p.target_1_pct));
  const [t2, setT2] = useState(String(p.target_2_pct));
  const [maxHold, setMaxHold] = useState(p.max_hold_days != null ? String(p.max_hold_days) : "");
  const [notes, setNotes] = useState(p.notes ?? "");

  const submitClose = async () => {
    const cp = Number(closePrice);
    if (!Number.isFinite(cp) || cp < 0) {
      toast({ title: "Enter a valid exit price", variant: "destructive" });
      return;
    }
    await close.mutateAsync({
      id: p.id,
      closePremium: cp,
      status: "closed",
      contracts: p.contracts,
      entryPremium: p.entry_premium,
      direction: p.direction,
    });
    setCloseOpen(false);
  };

  const submitTargets = async () => {
    await updateTargets.mutateAsync({
      id: p.id,
      hard_stop_pct: Number(hardStop),
      target_1_pct: Number(t1),
      target_2_pct: Number(t2),
      max_hold_days: maxHold === "" ? null : Number(maxHold),
      notes: notes.trim() === "" ? null : notes.trim(),
    });
    setEditOpen(false);
  };

  return (
    <Card id={`pos-${p.id}`} className="p-4 space-y-3 scroll-mt-24 target:ring-2 target:ring-primary target:ring-offset-2 target:ring-offset-background">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold">{p.symbol}</span>
            <Badge variant="outline" className={cn("text-[10px]", isCall ? "text-bullish border-bullish/40" : "text-bearish border-bearish/40")}>
              ${p.strike}{isCall ? "C" : "P"}
            </Badge>
            <span className="text-[11px] text-muted-foreground">exp {p.expiry} · {dte}d</span>
            <span className="text-[10px] text-muted-foreground">× {p.contracts}</span>
            {p.is_paper && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning flex items-center gap-1">
                <FlaskConical className="h-2.5 w-2.5" /> SIM
              </span>
            )}
            {p.risk_bucket && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5">
                {p.risk_bucket}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Entry ${p.entry_premium != null ? Number(p.entry_premium).toFixed(2) : "—"}
            {isOpen && currentMid != null && (<>
              {" · "}Now <span className="text-foreground font-mono">${currentMid.toFixed(2)}</span>
            </>)}
            {!isOpen && p.close_premium != null && (<>
              {" · "}Exit <span className="text-foreground font-mono">${Number(p.close_premium).toFixed(2)}</span>
            </>)}
            {profitPct != null && (
              <span className={cn("ml-2 font-mono", profitPct >= 0 ? "text-bullish" : "text-bearish")}>
                {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {p.status === "open" && (
          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap", EXIT_CLASSES[recommendation])}>
            {EXIT_LABEL[recommendation]}
          </span>
        )}
        {p.status !== "open" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground whitespace-nowrap uppercase">
            {p.status}
          </span>
        )}
      </div>

      {/* Entry-time gate snapshot chips */}
      {Object.keys(initialGates).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
          {(["direction", "volume", "gap", "budget", "liquidity"] as const).map((k) => {
            const v = initialGates[k];
            if (!v) return null;
            return (
              <span key={k} className="px-1.5 py-0.5 rounded border border-border bg-surface/40 text-muted-foreground">
                <span className="uppercase">{k}:</span> <span className="text-foreground">{v}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Exit guidance line */}
      {quoteUnavailable && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] leading-snug text-warning">
          <span className="font-semibold mr-1">Quote Unavailable —</span>
          <span>using last valid price. Verify in your broker.</span>
        </div>
      )}
      {p.status === "open" && (
        <div className={cn(
          "rounded-md border px-3 py-2 text-[12px] leading-snug",
          quoteUnavailable ? "border-warning/40 bg-warning/10 text-warning" : EXIT_CLASSES[recommendation],
        )}>
          <span className="font-semibold mr-1">
            {quoteUnavailable ? "Recommendation: HOLD —" : `Recommendation: ${EXIT_LABEL[recommendation]} —`}
          </span>
          <span className="opacity-90">
            {quoteUnavailable ? "Quote unavailable or anomalous; using last valid price. No auto-stop. Check your broker." : reason}
          </span>
        </div>
      )}

      {p.status === "closed" && p.realized_pnl != null && (
        <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-[12px]">
          Realized P&L: <span className={cn("font-mono", Number(p.realized_pnl) >= 0 ? "text-bullish" : "text-bearish")}>
            {fmtUsd(Number(p.realized_pnl))}
          </span>
        </div>
      )}

      {/* Actions */}
      {p.status === "open" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setCloseOpen(true)}>
            Close Manually
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3 w-3" /> Edit Targets
          </Button>
          <Button
            size="sm" variant="ghost"
            className="h-7 text-[11px] text-bearish hover:bg-bearish/10 ml-auto"
            onClick={() => del.mutate(p.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}

      {p.status !== "open" && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm" variant="ghost"
            className="h-7 text-[11px] text-bearish hover:bg-bearish/10"
            onClick={() => del.mutate(p.id)}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Remove
          </Button>
        </div>
      )}

      {/* Close-manually dialog */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close {p.symbol} ${p.strike}{isCall ? "C" : "P"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Exit price (per contract)</Label>
            <Input type="number" min={0} step="0.01" value={closePrice}
              onChange={(e) => setClosePrice(e.target.value)} className="h-8 text-xs" />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCloseOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitClose} disabled={close.isPending}>
              {close.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Close position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit targets / notes */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit targets</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Hard stop %</Label>
                <Input type="number" step={1} value={hardStop} onChange={(e) => setHardStop(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Target 1 %</Label>
                <Input type="number" step={5} value={t1} onChange={(e) => setT1(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Target 2 %</Label>
                <Input type="number" step={5} value={t2} onChange={(e) => setT2(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Max hold (days)</Label>
              <Input type="number" min={1} value={maxHold} onChange={(e) => setMaxHold(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs min-h-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={submitTargets} disabled={updateTargets.isPending} className="gap-1">
              <Save className="h-3 w-3" />
              {updateTargets.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
