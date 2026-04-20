// Top Opportunities Today — Dashboard widget that is a DERIVED VIEW of the
// /scanner pipeline. Shares useScannerPicks() with /scanner so counts and
// pick IDs always match. Cards deep-link to /scanner with auto-scroll +
// flash-highlight via ?symbol=&strike=&expiry=&highlight=true.
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, ExternalLink, ShieldAlert, DollarSign, RefreshCw, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useScannerPicks, type ApprovedPick } from "@/lib/useScannerPicks";
import { useActiveBucket, bucketEmoji, type ActiveBucket } from "@/lib/scannerBucket";
import { TRADE_STATUS_CLASSES, TRADE_STATUS_LABEL } from "@/lib/tradeStatus";
import { Hint } from "@/components/Hint";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { cn } from "@/lib/utils";

const BUCKET_TABS: ActiveBucket[] = ["All", "Conservative", "Moderate", "Aggressive", "Lottery"];

export function TopOpportunitiesToday({ maxResults = 6 }: { maxResults?: number }) {
  const [bucket, setBucket] = useActiveBucket();
  const picks = useScannerPicks({ maxResults });
  const navigate = useNavigate();

  // Manual refresh countdown for the truly-empty state.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const nextRefreshIn = Math.max(
    0,
    Math.ceil((picks.dataUpdatedAt + 60_000 - Date.now()) / 1000),
  );

  const open = (p: { row: { symbol: string }; contract: { strike: number; expiry: string } }) => {
    navigate(
      `/scanner?symbol=${p.row.symbol}&strike=${p.contract.strike}&expiry=${p.contract.expiry}&highlight=true`,
    );
  };

  // TradeStatus middleware filter — only TradeReady picks are surfaced.
  // During pre-market every pick is WatchlistOnly, so we fall back to those
  // so the widget isn't blank but flag it as "Watchlist preview".
  const tradeReady = useMemo(
    () => picks.approved.filter((p) => p.tradeStatus.tradeStatus === "TradeReady"),
    [picks.approved],
  );
  const watchlistFallback = useMemo(
    () => picks.approved.filter((p) => p.tradeStatus.tradeStatus === "WatchlistOnly"),
    [picks.approved],
  );
  const display: ApprovedPick[] = tradeReady.length > 0 ? tradeReady : watchlistFallback;
  const usingFallback = tradeReady.length === 0 && watchlistFallback.length > 0;

  const totalApproved = display.length;
  const totalBlocked = picks.budgetBlocked.length + picks.safetyBlocked.length;
  const everythingEmpty = totalApproved === 0 && totalBlocked === 0;

  return (
    <Card className="glass-card p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold tracking-wide">Top Opportunities Today</h2>
          <span className="text-[10px] text-muted-foreground">
            · derived live from <Link to="/scanner" className="underline underline-offset-2 hover:text-foreground">/scanner</Link>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={bucket} onValueChange={(v) => setBucket(v as ActiveBucket)}>
            <TabsList className="h-8 bg-surface/60">
              {BUCKET_TABS.map((b) => (
                <TabsTrigger key={b} value={b} className="text-xs h-6">
                  {bucketEmoji(b)} {b}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => picks.refetch()} className="h-8 gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", picks.isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Loading state — show while quotes are still arriving OR universe hasn't
          materialized yet. The /scanner page may already be rendering picks via
          its own cached pipeline; we treat universe===0 as "still loading" so
          users don't see a misleading "warming up" while /scanner has data. */}
      {(picks.isLoading || picks.counts.universe === 0) && totalApproved === 0 && totalBlocked === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning universe…
        </div>
      )}

      {/* Empty state — universe loaded, but every gate-passing pick was blocked. */}
      {!picks.isLoading && picks.counts.universe > 0 && everythingEmpty && (
        <div className="rounded-lg border border-dashed border-border/60 bg-surface/30 p-6 text-center space-y-2">
          <div className="text-sm font-semibold">Scanner is still warming up</div>
          <div className="text-xs text-muted-foreground">
            Universe of <span className="mono text-foreground">{picks.counts.universe}</span> scanned · next refresh in <span className="mono text-foreground">{nextRefreshIn}s</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => picks.refetch()} className="mt-2 gap-1.5">
            <RefreshCw className="h-3 w-3" /> Refresh now
          </Button>
        </div>
      )}

      {/* Approved picks — top N as compact cards */}
      {totalApproved > 0 && (
        <div className="space-y-2">
          {usingFallback && (
            <div className="text-[11px] text-warning bg-warning/5 border border-warning/30 rounded px-2 py-1.5">
              👀 Watchlist preview — pre-market window. Real Trade-Ready picks unlock at 9:30 AM ET after intraday confirmation.
            </div>
          )}
          {display.map((p) => {
            const isCall = p.contract.optionType === "call";
            return (
              <div
                key={p.key}
                className="w-full rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all"
              >
                <button
                  onClick={() => open(p)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center font-mono text-xs font-bold",
                    isCall ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish",
                  )}>
                    {p.row.symbol.slice(0, 4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{p.row.symbol}</span>
                      <span className="mono text-[11px] text-muted-foreground">${p.row.price.toFixed(2)}</span>
                      <Badge variant="outline" className="h-5 text-[10px]">
                        ${p.contract.strike}{isCall ? "C" : "P"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">exp {p.contract.expiry}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5">
                        {bucketEmoji(p.bucket)} {p.bucket}
                      </span>
                      <Hint label={p.tradeStatus.reason} asChild={false}>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded border cursor-help",
                          TRADE_STATUS_CLASSES[p.tradeStatus.tradeStatus],
                        )}>
                          {TRADE_STATUS_LABEL[p.tradeStatus.tradeStatus]}
                        </span>
                      </Hint>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[9px] text-muted-foreground">
                      <span>Dir: <span className="text-foreground">{p.tradeStatus.direction}</span></span>
                      <span>·</span>
                      <span>Vol: <span className="text-foreground">{p.tradeStatus.volume}</span></span>
                      <span>·</span>
                      <span>Gap: <span className="text-foreground">{p.tradeStatus.gap}</span></span>
                      <span>·</span>
                      <span>Liq: <span className="text-foreground">{p.tradeStatus.liquidity}</span></span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {p.verdict?.reason ?? p.row.crl?.reason ?? `Setup ${p.row.setupScore} · ${p.row.bias}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="mono text-lg font-semibold text-bullish">{p.rank?.finalRank ?? p.row.setupScore}</div>
                    <div className="text-[10px] text-muted-foreground">est ${p.estCost.toLocaleString()}</div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
                <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
                  {p.tradeStatus.tradeStatus === "TradeReady" ? (
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={(e) => { e.stopPropagation(); open(p); }}
                    >
                      BUY NOW →
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      className="h-7 text-[11px] border-warning/40 text-warning bg-warning/5"
                    >
                      ⏳ WAIT
                    </Button>
                  )}
                  <AddToPortfolioButton pick={p} />
                  <span className="text-[10px] text-muted-foreground hidden md:inline ml-auto">
                    {p.tradeStatus.tradeStatus === "TradeReady"
                      ? "We'll alert you when to take profits or cut the loss."
                      : "Track speculatively — exit guidance updates every 5 min."}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Blocked-Picks Preview — same treatment as Scanner. Only when no
          approved picks are available so we never bury wins. */}
      {totalApproved === 0 && totalBlocked > 0 && !picks.isLoading && (
        <div className="space-y-2">
          {picks.budgetBlocked.length > 0 && (
            <BlockedSummaryRow
              icon={<DollarSign className="h-4 w-4" />}
              tone="warning"
              count={picks.budgetBlocked.length}
              label="candidate"
              suffix={`over your $${picks.cap.toLocaleString()} cap`}
            />
          )}
          {picks.safetyBlocked.length > 0 && (
            <BlockedSummaryRow
              icon={<ShieldAlert className="h-4 w-4" />}
              tone="bearish"
              count={picks.safetyBlocked.length}
              label="candidate"
              suffix="blocked by safety gates"
            />
          )}
          {/* Inline previews of the first 3 blocked items so the user can act. */}
          <div className="space-y-1.5 pt-1">
            {[...picks.budgetBlocked, ...picks.safetyBlocked].slice(0, 3).map((b) => {
              const isCall = b.contract.optionType === "call";
              return (
                <button
                  key={b.key}
                  onClick={() => open(b)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded border text-[11px] transition-colors text-left",
                    b.kind === "budget"
                      ? "border-warning/40 bg-warning/5 hover:bg-warning/10"
                      : "border-bearish/40 bg-bearish/5 hover:bg-bearish/10",
                  )}
                >
                  <span className="font-mono font-semibold text-foreground w-12">{b.row.symbol}</span>
                  <span className={cn("mono text-[11px]", isCall ? "text-bullish" : "text-bearish")}>
                    ${b.contract.strike}{isCall ? "C" : "P"}
                  </span>
                  <span className="text-muted-foreground flex-1 truncate">{b.reason}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer — counts mirror Scanner exactly. */}
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span><span className="mono text-foreground">{picks.counts.universe}</span> in universe</span>
          <span>·</span>
          <span><span className="mono text-foreground">{picks.counts.gatePassing}</span> gate-passing</span>
          <span>·</span>
          <span><span className="mono text-warning">{picks.counts.budgetBlocked}</span> budget</span>
          <span>·</span>
          <span><span className="mono text-bearish">{picks.counts.gateBlocked}</span> safety</span>
        </div>
        <Link to="/scanner" className="text-primary hover:underline underline-offset-2 inline-flex items-center gap-1">
          View in Scanner <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}

function BlockedSummaryRow({
  icon, tone, count, label, suffix,
}: {
  icon: React.ReactNode;
  tone: "warning" | "bearish";
  count: number;
  label: string;
  suffix: string;
}) {
  const cls = tone === "warning" ? "border-warning/40 bg-warning/5 text-warning" : "border-bearish/40 bg-bearish/5 text-bearish";
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]", cls)}>
      {icon}
      <span>
        <span className="font-mono font-semibold">{count}</span> {label}{count === 1 ? "" : "s"} {suffix}
      </span>
      <Link to="/scanner" className="ml-auto text-[11px] underline underline-offset-2 hover:opacity-80">
        View in Scanner
      </Link>
    </div>
  );
}
