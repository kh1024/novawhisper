// Portfolio — saved options positions with live underlying + Nova's honest take.
import { Briefcase, RefreshCw, Trash2, X, TrendingUp, TrendingDown, Minus, AlertTriangle, Trophy, Skull, Clock, FlaskConical, Sparkles, Play, Pause } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePortfolio, useClosePosition, useDeletePosition, useAddPosition, type PortfolioPosition } from "@/lib/portfolio";
import { TickerPrice } from "@/components/TickerPrice";
import { useVerdicts, type Verdict } from "@/lib/portfolioVerdict";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useSettings, BROKER_PRESETS, type AppSettings } from "@/lib/settings";
import { dispatchVerdictTransitions } from "@/lib/webhook";
import { feeOneSide, feeRoundTrip } from "@/lib/fees";
import { buildSamplePaperTrades } from "@/lib/seedPaperTrades";
import { toast } from "@/hooks/use-toast";

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

type BookFilter = "all" | "real" | "paper";

export default function Portfolio() {
  const { data: allPositions = [], isLoading } = usePortfolio();
  const [settingsForFilter] = useSettings();
  // Default to PAPER view when SIM mode is on so users actually see their sim trades.
  const [book, setBook] = useState<BookFilter>(settingsForFilter.paperMode ? "paper" : "all");
  const positions = useMemo(() => {
    if (book === "all") return allPositions;
    if (book === "paper") return allPositions.filter((p) => p.is_paper);
    return allPositions.filter((p) => !p.is_paper);
  }, [allPositions, book]);
  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status !== "open"), [positions]);
  const paperCount = allPositions.filter((p) => p.is_paper).length;
  const realCount = allPositions.length - paperCount;
  const addPos = useAddPosition();
  // Auto-cycle paper prices: random walk applied to every paper card every ~2s.
  // Paper trades only — real positions are never affected.
  const [autoSim, setAutoSim] = useState(false);
  // Per-position sim offset reported up from each card so portfolio totals
  // can reflect the simulated underlying.
  const [simOffsets, setSimOffsets] = useState<Record<string, number>>({});
  const reportSimOffset = (id: string, pct: number) =>
    setSimOffsets((cur) => (cur[id] === pct ? cur : { ...cur, [id]: pct }));

  const seedSamples = () => {
    const samples = buildSamplePaperTrades();
    let done = 0;
    samples.forEach((s) =>
      addPos.mutate(s, {
        onSuccess: () => {
          done++;
          if (done === samples.length) {
            toast({ title: "Simulation seeded", description: `${samples.length} sample paper trades added.` });
            setBook("paper");
          }
        },
      }),
    );
  };
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
    let feesPaid = 0;
    for (const p of closed) {
      const r = realizedPnl(p, settings);
      if (r != null) realized += r;
      feesPaid += feeRoundTrip(settings, p.contracts);
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
      // Entry fee already paid on open positions.
      feesPaid += feeOneSide(settings, p.contracts);
    }
    return { openCount, realized, unrealized, unrealizedKnown, total: realized + unrealized, costBasis, feesPaid };
  }, [open, closed, quoteMap, settings]);

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
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2" title={`Net of broker + regulatory fees (${BROKER_PRESETS.find(b => b.value === settings.brokerPreset)?.label ?? "Custom"} preset). Fees so far: $${totals.feesPaid.toFixed(2)}`}>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total P&amp;L (net)</div>
            <div className={cn("font-mono text-lg font-semibold", totals.total >= 0 ? "text-bullish" : "text-bearish")}>
              {fmtUsd(totals.total)}
            </div>
            <div className="text-[9px] text-muted-foreground mt-0.5">−${totals.feesPaid.toFixed(2)} fees</div>
          </div>
          <Button size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["portfolio-verdict"] }); verdictQ.refetch(); }} disabled={verdictQ.isFetching || open.length === 0}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", verdictQ.isFetching && "animate-spin")} />
            Refresh verdict
          </Button>
        </div>
      </div>

      {/* Book filter — Real / Paper / All */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Book:</span>
        {([
          { id: "all" as const, label: `All (${allPositions.length})` },
          { id: "real" as const, label: `Real (${realCount})` },
          { id: "paper" as const, label: `Paper (${paperCount})`, sim: true },
        ]).map((b) => (
          <button
            key={b.id}
            onClick={() => setBook(b.id)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded border transition-colors flex items-center gap-1",
              book === b.id
                ? b.sim
                  ? "border-warning bg-warning/15 text-warning"
                  : "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-surface",
            )}
          >
            {b.sim && <FlaskConical className="h-2.5 w-2.5" />}
            {b.label}
          </button>
        ))}
        {settings.paperMode && paperCount === 0 && (
          <Button
            size="sm" variant="outline"
            className="h-7 text-[11px] border-warning/50 text-warning hover:bg-warning/10 ml-auto gap-1"
            onClick={seedSamples}
            disabled={addPos.isPending}
          >
            <Sparkles className="h-3 w-3" />
            {addPos.isPending ? "Seeding…" : "Seed sample paper trades"}
          </Button>
        )}
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
            <Card className="p-8 text-center text-sm text-muted-foreground space-y-3">
              <p>
                {book === "paper"
                  ? "No paper trades yet. Turn on Simulation in Settings, then Save any pick — or seed samples below."
                  : book === "real"
                  ? "No real trades yet. Make sure Simulation Mode is OFF when you Save."
                  : "No open positions yet. Hit "}
                {book === "all" && <span className="font-semibold text-foreground">Save</span>}
                {book === "all" && " on any Web Pick, Planning pick, or Top Opportunity to start tracking."}
              </p>
              {settings.paperMode && (
                <Button
                  size="sm" variant="outline"
                  className="border-warning/50 text-warning hover:bg-warning/10 gap-1"
                  onClick={seedSamples}
                  disabled={addPos.isPending}
                >
                  <Sparkles className="h-3 w-3" />
                  {addPos.isPending ? "Seeding…" : "Seed 5 sample paper trades"}
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {open.map((p) => (
                <PositionCard key={p.id} p={p} verdict={verdictMap.get(p.id)} spot={quoteMap.get(p.symbol)?.price} settings={settings} autoSim={autoSim} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="closed" className="mt-3">
          {closed.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No closed positions yet.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {closed.map((p) => <PositionCard key={p.id} p={p} spot={quoteMap.get(p.symbol)?.price} settings={settings} autoSim={false} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PositionCard({ p, verdict, spot, settings, autoSim = false }: { p: PortfolioPosition; verdict?: Verdict; spot?: number; settings: AppSettings; autoSim?: boolean }) {
  const close = useClosePosition();
  const del = useDeletePosition();
  const isCall = p.option_type.includes("call");
  const isPut = p.option_type.includes("put");
  const tone = p.direction === "long" && isCall ? "text-bullish" : p.direction === "long" && isPut ? "text-bearish" : "text-foreground";
  const strikeLabel = p.strike_short ? `${p.strike}/${p.strike_short}` : String(p.strike);
  const dte = Math.max(0, Math.round((new Date(p.expiry + "T16:00:00Z").getTime() - Date.now()) / 86_400_000));

  // Per-card simulated spot override (paper trades only). Manual chips set a
  // fixed offset; auto-cycle drives a random-walk offset every 2s.
  const [simOffsetPct, setSimOffsetPct] = useState(0);

  // Random-walk auto-cycle: only runs for open paper trades when parent toggles autoSim.
  useEffect(() => {
    if (!autoSim || !p.is_paper || p.status !== "open") return;
    const id = setInterval(() => {
      setSimOffsetPct((cur) => {
        // Mean-reverting random walk in [-10, +10]
        const drift = -cur * 0.08; // pull back toward 0
        const shock = (Math.random() - 0.5) * 1.6; // ±0.8% per tick
        const next = cur + drift + shock;
        return Math.max(-10, Math.min(10, +next.toFixed(2)));
      });
    }, 2000);
    return () => clearInterval(id);
  }, [autoSim, p.is_paper, p.status]);

  const realSpot = spot ?? null;
  const effectiveSpot = realSpot != null && simOffsetPct !== 0
    ? realSpot * (1 + simOffsetPct / 100)
    : realSpot;
  const isSimulating = simOffsetPct !== 0 && realSpot != null;

  const moneyness = effectiveSpot != null
    ? (isCall ? (effectiveSpot > Number(p.strike) ? "ITM" : "OTM") : isPut ? (effectiveSpot < Number(p.strike) ? "ITM" : "OTM") : "—")
    : null;
  const distance = effectiveSpot != null ? ((effectiveSpot - Number(p.strike)) / Number(p.strike)) * 100 : null;

  const unrealized = p.status === "open" ? estimateUnrealizedPnl(p, effectiveSpot ?? null, settings) : null;
  const unrealizedPct = unrealized != null && p.entry_premium != null && p.direction === "long"
    ? (unrealized / (Number(p.entry_premium) * p.contracts * 100)) * 100
    : null;
  const roundTripFee = feeRoundTrip(settings, p.contracts);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold">{p.symbol}</span>
            <TickerPrice symbol={p.symbol} price={spot ?? null} showChange />
            <Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge>
            {p.is_paper && (
              <Badge variant="outline" className="text-[10px] border-warning/40 bg-warning/10 text-warning gap-1">
                <FlaskConical className="h-2.5 w-2.5" /> SIM
              </Badge>
            )}
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
          {realSpot != null && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {isSimulating ? "Sim spot" : "Spot"}
              </div>
              <div className={cn("font-mono text-sm font-semibold", isSimulating && "text-warning")}>
                ${(effectiveSpot ?? realSpot).toFixed(2)}
              </div>
              {isSimulating && (
                <div className="text-[9px] text-muted-foreground mono">
                  real ${realSpot.toFixed(2)}
                </div>
              )}
              {distance != null && (
                <div className={cn("text-[10px]", distance >= 0 ? "text-bullish" : "text-bearish")}>
                  {distance >= 0 ? "+" : ""}{distance.toFixed(1)}% vs strike
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Simulate price move — paper trades only */}
      {p.is_paper && p.status === "open" && realSpot != null && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-2">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="text-[10px] uppercase tracking-widest text-warning flex items-center gap-1">
              <FlaskConical className="h-3 w-3" /> Simulate price move
              {isSimulating && (
                <span className="font-mono normal-case tracking-normal ml-1">
                  · {simOffsetPct > 0 ? "+" : ""}{simOffsetPct}%
                </span>
              )}
            </div>
            {isSimulating && (
              <button
                onClick={() => setSimOffsetPct(0)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                reset
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {[-10, -5, -2, +2, +5, +10].map((d) => (
              <button
                key={d}
                onClick={() => setSimOffsetPct((cur) => (cur === d ? 0 : d))}
                className={cn(
                  "text-[10px] font-mono px-2 py-0.5 rounded border transition-colors",
                  simOffsetPct === d
                    ? d > 0
                      ? "border-bullish bg-bullish/15 text-bullish"
                      : "border-bearish bg-bearish/15 text-bearish"
                    : "border-border text-muted-foreground hover:bg-surface",
                )}
              >
                {d > 0 ? "+" : ""}{d}%
              </button>
            ))}
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">
            Adjusts P&amp;L estimate &amp; moneyness only — Nova's verdict still uses real spot.
          </div>
        </div>
      )}

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
          {(() => {
            const r = realizedPnl(p, settings);
            if (r == null) return <span />;
            return (
              <span className={cn("font-mono", r >= 0 ? "text-bullish" : "text-bearish")} title={`Net of $${roundTripFee.toFixed(2)} round-trip fees`}>
                P&amp;L: {fmtUsd(r)} <span className="opacity-60">(net)</span>
              </span>
            );
          })()}
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
