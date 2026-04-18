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
import { useMemo } from "react";

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

export default function Portfolio() {
  const { data: positions = [], isLoading } = usePortfolio();
  const open = useMemo(() => positions.filter((p) => p.status === "open"), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status !== "open"), [positions]);
  const verdictQ = useVerdicts(open);
  const verdictMap = new Map((verdictQ.data?.verdicts ?? []).map((v) => [v.id, v]));
  const quoteMap = new Map((verdictQ.data?.quotes ?? []).map((q) => [q.symbol, q]));
  const qc = useQueryClient();

  const totals = useMemo(() => {
    let openCount = open.length;
    let closedPnl = 0;
    for (const p of closed) {
      if (p.entry_premium != null && p.close_premium != null) {
        const sign = p.direction === "long" ? 1 : -1;
        closedPnl += sign * (Number(p.close_premium) - Number(p.entry_premium)) * p.contracts * 100;
      }
    }
    return { openCount, closedPnl };
  }, [open, closed]);

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
        <div className="flex gap-3">
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Open</div>
            <div className="font-mono text-lg font-semibold">{totals.openCount}</div>
          </div>
          <div className="rounded-md border border-border bg-surface/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Realized P&amp;L</div>
            <div className={cn("font-mono text-lg font-semibold", totals.closedPnl >= 0 ? "text-bullish" : "text-bearish")}>
              {totals.closedPnl >= 0 ? "+" : ""}${totals.closedPnl.toFixed(0)}
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
                <PositionCard key={p.id} p={p} verdict={verdictMap.get(p.id)} spot={quoteMap.get(p.symbol)?.price} />
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
