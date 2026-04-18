// Portfolio — saved options positions with live underlying + Nova's honest take.
import { Briefcase, RefreshCw, Trash2, X, TrendingUp, TrendingDown, Minus, AlertTriangle, Trophy, Skull, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePortfolio, useClosePosition, useDeletePosition, type PortfolioPosition } from "@/lib/portfolio";
import { TickerPrice } from "@/components/TickerPrice";
import { useVerdicts, type Verdict } from "@/lib/portfolioVerdict";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useMemo } from "react";
import { useSettings, BROKER_PRESETS, type AppSettings } from "@/lib/settings";
import { dispatchVerdictTransitions } from "@/lib/webhook";
import { feeOneSide, feeRoundTrip } from "@/lib/fees";

function statusIcon(s: Verdict["status"]) {
  if (s === "winning") return <Trophy className="h-3.5 w-3.5" />;
  if (s === "bleeding" || s === "in trouble") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (s === "expiring worthless") return <Skull className="h-3.5 w-3.5" />;
  if (s === "running fine") return <TrendingUp className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}
function statusClass(s: Verdict["status"]) {
  if (s === "winning" || s === "running fine") return "text-bullish border-bullish/40 bg-bullish/10";
  if (s === "bleeding" || s === "in trouble" || s === "expiring worthless") return "text-bearish border-bearish/40 bg-bearish/10";
  return "text-muted-foreground border-border bg-muted/30";
}

/**
 * Estimate unrealized P&L for an OPEN position.
 * We don't have a live options chain here, so we approximate the contract's
 * current value as its intrinsic value (max(0, ITM amount)). For long calls
 * this is a CONSERVATIVE floor (real value ≥ intrinsic because of time value).
 * For long puts, same. For shorts (credit), it's an upper bound on what's owed.
 */
function estimateUnrealizedPnl(p: PortfolioPosition, spot: number | null | undefined, settings: AppSettings): number | null {
  if (spot == null || p.entry_premium == null) return null;
  const strike = Number(p.strike);
  const isCall = p.option_type.includes("call");
  const isPut = p.option_type.includes("put");
  let intrinsic = 0;
  if (isCall) intrinsic = Math.max(0, spot - strike);
  else if (isPut) intrinsic = Math.max(0, strike - spot);
  else return null;
  const sign = p.direction === "long" ? 1 : -1;
  const gross = sign * (intrinsic - Number(p.entry_premium)) * p.contracts * 100;
  // Subtract entry fees (already paid) + projected exit fees.
  return gross - feeRoundTrip(settings, p.contracts);
}

function realizedPnl(p: PortfolioPosition, settings: AppSettings): number | null {
  if (p.entry_premium == null || p.close_premium == null) return null;
  const sign = p.direction === "long" ? 1 : -1;
  const gross = sign * (Number(p.close_premium) - Number(p.entry_premium)) * p.contracts * 100;
  return gross - feeRoundTrip(settings, p.contracts);
}

function fmtUsd(n: number) {
  const s = n >= 0 ? "+" : "−";
  return `${s}$${Math.abs(n).toFixed(0)}`;
}

export default function Portfolio() {
  const { data: positions = [], isLoading } = usePortfolio();
  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status !== "open"), [positions]);
  const verdictQ = useVerdicts(open);
  const verdictMap = new Map((verdictQ.data?.verdicts ?? []).map((v) => [v.id, v]));
  const quoteMap = new Map((verdictQ.data?.quotes ?? []).map((q) => [q.symbol, q]));
  const qc = useQueryClient();
  const [settings] = useSettings();

  // Fire webhook on WAIT→GO/EXIT transitions whenever fresh verdicts arrive.
  useEffect(() => {
    const verdicts = verdictQ.data?.verdicts;
    if (!verdicts || verdicts.length === 0) return;
    dispatchVerdictTransitions({
      settings,
      verdicts,
      positions: open.map((p) => ({ id: p.id, symbol: p.symbol })),
    });
  }, [verdictQ.data, settings, open]);

  const totals = useMemo(() => {
    const openCount = open.length;
    let realized = 0;
    for (const p of closed) {
      const r = realizedPnl(p, settings);
      if (r != null) realized += r;
    }
    let unrealized = 0;
    let unrealizedKnown = false;
    let costBasis = 0;
    for (const p of open) {
      const spot = quoteMap.get(p.symbol)?.price ?? null;
      const u = estimateUnrealizedPnl(p, spot, settings);
      if (u != null) { unrealized += u; unrealizedKnown = true; }
      if (p.entry_premium != null && p.direction === "long") {
        costBasis += Number(p.entry_premium) * p.contracts * 100;
      }
    }
    return { openCount, realized, unrealized, unrealizedKnown, total: realized + unrealized, costBasis };
  }, [open, closed, quoteMap]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" /> Portfolio · saved positions
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Your Plays</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Save any pick from the app. Nova checks the live underlying and tells you straight what's working and what's not.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Open</div>
            <div className="font-mono text-lg font-semibold">{totals.openCount}</div>
          </div>
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2" title="Estimated using intrinsic value (spot − strike). Real value usually higher because of time value.">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Unrealized (est.)</div>
            <div className={cn("font-mono text-lg font-semibold", totals.unrealized >= 0 ? "text-bullish" : "text-bearish")}>
              {totals.unrealizedKnown ? fmtUsd(totals.unrealized) : "—"}
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Realized</div>
            <div className={cn("font-mono text-lg font-semibold", totals.realized >= 0 ? "text-bullish" : "text-bearish")}>
              {fmtUsd(totals.realized)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total P&amp;L</div>
            <div className={cn("font-mono text-lg font-semibold", totals.total >= 0 ? "text-bullish" : "text-bearish")}>
              {fmtUsd(totals.total)}
            </div>
          </div>
          <Button size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["portfolio-verdict"] }); verdictQ.refetch(); }} disabled={verdictQ.isFetching || open.length === 0}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", verdictQ.isFetching && "animate-spin")} />
            Refresh verdict
          </Button>
        </div>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-3">
          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
          ) : open.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No open positions yet. Hit <span className="font-semibold text-foreground">Save</span> on any Web Pick, Planning pick, or Top Opportunity to start tracking.
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {open.map((p) => (
                <PositionCard key={p.id} p={p} verdict={verdictMap.get(p.id)} spot={quoteMap.get(p.symbol)?.price} settings={settings} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="closed" className="mt-3">
          {closed.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No closed positions yet.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {closed.map((p) => <PositionCard key={p.id} p={p} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PositionCard({ p, verdict, spot }: { p: PortfolioPosition; verdict?: Verdict; spot?: number }) {
  const close = useClosePosition();
  const del = useDeletePosition();
  const isCall = p.option_type.includes("call");
  const isPut = p.option_type.includes("put");
  const tone = p.direction === "long" && isCall ? "text-bullish" : p.direction === "long" && isPut ? "text-bearish" : "text-foreground";
  const strikeLabel = p.strike_short ? `${p.strike}/${p.strike_short}` : String(p.strike);
  const dte = Math.max(0, Math.round((new Date(p.expiry + "T16:00:00Z").getTime() - Date.now()) / 86_400_000));

  const moneyness = spot != null
    ? (isCall ? (spot > Number(p.strike) ? "ITM" : "OTM") : isPut ? (spot < Number(p.strike) ? "ITM" : "OTM") : "—")
    : null;
  const distance = spot != null ? ((spot - Number(p.strike)) / Number(p.strike)) * 100 : null;

  const unrealized = p.status === "open" ? estimateUnrealizedPnl(p, spot ?? null) : null;
  const unrealizedPct = unrealized != null && p.entry_premium != null && p.direction === "long"
    ? (unrealized / (Number(p.entry_premium) * p.contracts * 100)) * 100
    : null;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold">{p.symbol}</span>
            <TickerPrice symbol={p.symbol} price={spot ?? null} showChange />
            <Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge>
            {moneyness && <Badge variant="secondary" className="text-[10px]">{moneyness}</Badge>}
          </div>
          <div className={cn("mt-1 font-mono text-sm font-semibold", tone)}>
            {p.direction.toUpperCase()} ${strikeLabel} {p.option_type.replace("_", " ").toUpperCase()} · {p.expiry}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {p.contracts} contract{p.contracts > 1 ? "s" : ""}
            {p.entry_premium != null && ` · entry $${Number(p.entry_premium).toFixed(2)}`}
            {dte > 0 ? ` · ${dte} DTE` : " · expired"}
          </div>
          {unrealized != null && (
            <div
              className={cn("mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-mono",
                unrealized >= 0 ? "text-bullish border-bullish/40 bg-bullish/10" : "text-bearish border-bearish/40 bg-bearish/10")}
              title="Estimated from intrinsic value only — real option value is usually higher because of time value."
            >
              Unrealized (est.): {fmtUsd(unrealized)}
              {unrealizedPct != null && <span className="opacity-80">({unrealizedPct >= 0 ? "+" : ""}{unrealizedPct.toFixed(0)}%)</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {spot != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Spot</div>
              <div className="font-mono text-sm font-semibold">${spot.toFixed(2)}</div>
              {distance != null && (
                <div className={cn("text-[10px]", distance >= 0 ? "text-bullish" : "text-bearish")}>
                  {distance >= 0 ? "+" : ""}{distance.toFixed(1)}% vs strike
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {verdict?.crl && <CrlPanel crl={verdict.crl} metrics={verdict.metrics} />}

      {verdict && (
        <div className={cn("mt-3 rounded-md border p-2.5", statusClass(verdict.status))}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest">
            {statusIcon(verdict.status)} {verdict.status} · {verdict.action.replace("_", " ")}
          </div>
          <p className="mt-1 text-xs leading-snug">{verdict.verdict}</p>
        </div>
      )}

      {p.thesis && <p className="mt-2 text-[11px] text-muted-foreground italic line-clamp-2">"{p.thesis}"</p>}

      {p.status === "open" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => {
            const px = prompt("Closing premium per contract (USD):");
            if (px == null) return;
            const n = Number(px);
            if (Number.isFinite(n)) close.mutate({ id: p.id, closePremium: n, status: "closed" });
          }}>
            <X className="mr-1 h-3 w-3" /> Close
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => {
            if (confirm("Delete this position?")) del.mutate(p.id);
          }}>
            <Trash2 className="mr-1 h-3 w-3" /> Remove
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          {p.close_premium != null && p.entry_premium != null && (
            <span className={cn("font-mono", (Number(p.close_premium) - Number(p.entry_premium)) * (p.direction === "long" ? 1 : -1) >= 0 ? "text-bullish" : "text-bearish")}>
              P&amp;L: {((Number(p.close_premium) - Number(p.entry_premium)) * (p.direction === "long" ? 1 : -1) * p.contracts * 100).toFixed(0)} USD
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground" onClick={() => del.mutate(p.id)}>
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── Conflict Resolution Layer chip ─────────────────────────────────────────
function CrlPanel({ crl, metrics }: { crl: NonNullable<Verdict["crl"]>; metrics?: Verdict["metrics"] }) {
  const verdictStyle: Record<typeof crl.verdict, string> = {
    GO:      "bg-bullish/15 text-bullish border-bullish/40",
    EXIT:    "bg-bearish/20 text-bearish border-bearish/50",
    NO:      "bg-bearish/15 text-bearish border-bearish/40",
    WAIT:    "bg-warning/15 text-warning border-warning/40",
    NEUTRAL: "bg-muted/30 text-muted-foreground border-border",
  };
  const riskStyle: Record<string, string> = {
    Safe: "bg-bullish/10 text-bullish border-bullish/30",
    Mild: "bg-warning/10 text-warning border-warning/30",
    Aggressive: "bg-bearish/10 text-bearish border-bearish/30",
  };
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-surface/30 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border", verdictStyle[crl.verdict])}>
          {crl.verdict}
        </span>
        {crl.riskBadge && (
          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border", riskStyle[crl.riskBadge])}>
            Risk: {crl.riskBadge}
          </span>
        )}
        {crl.stopLossTriggered && (
          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border bg-bearish/20 text-bearish border-bearish/50 animate-pulse">
            🚨 SELL AT LOSS
          </span>
        )}
      </div>
      <p className="text-[11px] text-foreground/85 leading-snug">
        <span className="text-muted-foreground">Reasoning · </span>{crl.reason}
      </p>
      {metrics && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/40">
          {metrics.rsi14 != null && <span>RSI {metrics.rsi14.toFixed(0)}</span>}
          {metrics.ema8 != null && <span>8-EMA ${metrics.ema8.toFixed(2)}</span>}
          {crl.emaDistancePct != null && <span className={crl.emaDistancePct >= 0 ? "text-bullish" : "text-bearish"}>{crl.emaDistancePct >= 0 ? "+" : ""}{crl.emaDistancePct.toFixed(1)}% vs 8-EMA</span>}
          {metrics.delta != null && <span>Δ {metrics.delta.toFixed(2)}</span>}
          {metrics.theta != null && <span>Θ {metrics.theta.toFixed(2)}</span>}
          {metrics.iv != null && <span>IV {(metrics.iv * 100).toFixed(0)}%</span>}
          {metrics.dte != null && <span>{metrics.dte}d DTE</span>}
        </div>
      )}
    </div>
  );
}
