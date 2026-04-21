// Top Opportunities Today — Dashboard widget. Now driven entirely by the
// TradeState machine (src/lib/tradeState.ts) so badges, helper text, and
// CTAs ALWAYS agree. No more "Watchlist Only + BUY" contradictions.
//
// Three exclusive sections (per spec):
//   1. Trade Ready Now           — TRADE_READY only, full-size BUY CTA
//   2. Confirmed but Near Limit  — NEAR_LIMIT_CONFIRMED only, reduced-size BUY
//   3. Setups to Watch           — WATCHLIST_ONLY, NO buy buttons
//
// When there are 0 TRADE_READY + 0 NEAR_LIMIT_CONFIRMED, the widget shows a
// clean empty state plus a "best pending" preview row (top 3 watchlist names
// with explicit "waiting for X" trigger language). No forced picks.
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, ExternalLink, ShieldAlert, DollarSign, RefreshCw, Loader2, Eye, CheckCircle2, AlertTriangle, Moon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useScannerPicks, type ApprovedPick } from "@/lib/useScannerPicks";
import { useActiveBucket, bucketEmoji, type ActiveBucket } from "@/lib/scannerBucket";
import { TRADE_STATE_LABEL, TRADE_STATE_CLASSES } from "@/lib/tradeState";
import { Hint } from "@/components/Hint";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { cn } from "@/lib/utils";
import { getMarketState } from "@/lib/marketHours";
import { getGamePlanPicks } from "@/lib/gamePlan";

const BUCKET_TABS: ActiveBucket[] = ["All", "Conservative", "Moderate", "Aggressive", "Lottery"];

export function TopOpportunitiesToday({ maxResults = 6 }: { maxResults?: number }) {
  const [bucket, setBucket] = useActiveBucket();
  const picks = useScannerPicks({ maxResults });
  const navigate = useNavigate();
  const marketState = getMarketState();

  const [, setTick] = useState(0);
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

  const tradeReady = picks.approved.filter((p) => p.tradeState === "TRADE_READY");
  const nearLimit = picks.approved.filter((p) => p.tradeState === "NEAR_LIMIT_CONFIRMED");
  const watchlist = picks.watchlistOnly.slice(0, maxResults);
  const inPreview = picks.counts.marketMode === "PREVIEW";
  const totalActionable = tradeReady.length + nearLimit.length;
  const totalBlocked = picks.budgetBlocked.length + picks.safetyBlocked.length;

  const gamePlanPreview = useMemo(
    () => (marketState === "OPEN" ? [] : getGamePlanPicks(picks, 3)),
    [marketState, picks.approved, picks.watchlistOnly, picks.bestPending, picks.cap],
  );
  const hasGamePlanPreview = marketState !== "OPEN" && gamePlanPreview.length > 0;
  const everythingEmpty = totalActionable === 0 && watchlist.length === 0 && totalBlocked === 0 && !hasGamePlanPreview;

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

      {(picks.isLoading || picks.counts.universe === 0) && everythingEmpty && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning universe…
        </div>
      )}

      {inPreview && totalActionable > 0 && (
        <div className="text-[11px] text-warning bg-warning/5 border border-warning/30 rounded px-2 py-1.5 mb-3">
          👀 Pre-market preview — markets open at 9:30 AM ET. Picks shown for planning; trade states activate at the open.
        </div>
      )}

      {hasGamePlanPreview && (
        <Section
          title="Tomorrow's Game Plan"
          icon={<Moon className="h-4 w-4 text-primary" />}
          tone="primary"
          count={gamePlanPreview.length}
        >
          <div className="text-[11px] text-muted-foreground -mt-1 mb-1">
            Top 3 budget-qualified setups for the next open.
          </div>
          {gamePlanPreview.map((p) => (
            <PendingPreviewRow key={p.key} pick={p} onOpen={open} label="Tomorrow" />
          ))}
        </Section>
      )}

      {tradeReady.length > 0 && (
        <Section
          title="Trade Ready Now"
          icon={<CheckCircle2 className="h-4 w-4 text-bullish" />}
          tone="bullish"
          count={tradeReady.length}
        >
          {tradeReady.map((p) => (
            <PickCard key={p.key} pick={p} onOpen={open} inPreview={inPreview} />
          ))}
        </Section>
      )}

      {nearLimit.length > 0 && (
        <Section
          title="Confirmed — Reduce Size"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
          tone="warning"
          count={nearLimit.length}
        >
          {nearLimit.map((p) => (
            <PickCard key={p.key} pick={p} onOpen={open} inPreview={inPreview} />
          ))}
        </Section>
      )}

      {totalActionable === 0 && !picks.isLoading && picks.counts.universe > 0 && watchlist.length > 0 && !hasGamePlanPreview && (
        <Section
          title="Top Setups — Pending Trigger"
          icon={<Eye className="h-4 w-4 text-primary" />}
          tone="primary"
          count={Math.min(3, watchlist.length)}
        >
          <div className="text-[11px] text-muted-foreground -mt-1 mb-1">
            No trade-ready setups right now — these are the strongest watchlist names with the missing condition called out.
          </div>
          {watchlist.slice(0, 3).map((p) => (
            <WatchlistRow key={p.key} pick={p} onOpen={open} />
          ))}
        </Section>
      )}

      {totalActionable === 0 && !picks.isLoading && picks.counts.universe > 0 && watchlist.length === 0 && !hasGamePlanPreview && (
        <div className="rounded-lg border border-dashed border-border/60 bg-surface/30 p-4 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold">No trade-ready setups right now</div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {picks.bestPending.length > 0
              ? "Best current names are pending confirmation — see below."
              : <>Universe of <span className="mono text-foreground">{picks.counts.universe}</span> scanned · next refresh in <span className="mono text-foreground">{nextRefreshIn}s</span></>}
          </div>
          {picks.bestPending.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {picks.bestPending.map((p) => (
                <PendingPreviewRow key={p.key} pick={p} onOpen={open} />
              ))}
            </div>
          )}
        </div>
      )}

      {totalActionable > 0 && watchlist.length > 0 && (
        <Section
          title="Setups to Watch"
          icon={<Eye className="h-4 w-4 text-primary" />}
          tone="primary"
          count={watchlist.length}
        >
          {watchlist.map((p) => (
            <WatchlistRow key={p.key} pick={p} onOpen={open} />
          ))}
        </Section>
      )}

      {totalActionable === 0 && picks.bestPending.length === 0 && totalBlocked > 0 && !picks.isLoading && !hasGamePlanPreview && (
        <div className="space-y-2 mt-3">
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
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span><span className="mono text-foreground">{picks.counts.universe}</span> universe</span>
          <span>·</span>
          <span><span className="mono text-bullish">{picks.counts.tradeReadyCount}</span> trade-ready</span>
          <span>·</span>
          <span><span className="mono text-warning">{picks.counts.nearLimitConfirmedCount}</span> near-limit</span>
          <span>·</span>
          <span><span className="mono text-primary">{picks.counts.watchlistOnlyCount}</span> watchlist</span>
          <span>·</span>
          <span><span className="mono text-warning">{picks.counts.budgetBlocked}</span> budget</span>
          <span>·</span>
          <span><span className="mono text-bearish">{picks.counts.gateBlocked}</span> safety</span>
          <span>·</span>
          <span className="text-[10px]">Mode: <span className="mono text-foreground">{picks.counts.marketMode}</span></span>
        </div>
        <Link to="/scanner" className="text-primary hover:underline underline-offset-2 inline-flex items-center gap-1">
          View in Scanner <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}

function Section({
  title, icon, tone, count, children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "bullish" | "warning" | "primary";
  count: number;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "bullish" ? "text-bullish" :
    tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className={cn("text-xs font-semibold uppercase tracking-wider", toneCls)}>{title}</h3>
        <Badge variant="outline" className="h-4 text-[10px] px-1.5">{count}</Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PickCard({
  pick: p, onOpen, inPreview,
}: {
  pick: ApprovedPick;
  onOpen: (p: ApprovedPick) => void;
  inPreview: boolean;
}) {
  const isCall = p.contract.optionType === "call";
  const cta = p.cta;
  const buyDisabled = inPreview;

  return (
    <div className="w-full rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all">
      <button
        onClick={() => onOpen(p)}
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
            <Hint label={p.tradeStateResult.reason} asChild={false}>
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border cursor-help",
                TRADE_STATE_CLASSES[p.tradeState],
              )}>
                {TRADE_STATE_LABEL[p.tradeState]}
              </span>
            </Hint>
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {p.tradeStateResult.reason}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="mono text-lg font-semibold text-bullish">{p.rank?.finalRank ?? p.row.setupScore}</div>
          <div className="text-[10px] text-muted-foreground">est ${p.estCost.toLocaleString()}</div>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      <div className="flex items-center gap-2 px-3 pb-3 flex-wrap">
        {cta.primary === "BUY_NOW" && (
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={buyDisabled}
            onClick={(e) => { e.stopPropagation(); onOpen(p); }}
          >
            {buyDisabled ? "⏳ OPENS 9:30 ET" : "BUY NOW →"}
          </Button>
        )}
        {cta.primary === "BUY_REDUCED" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] border-warning/40 text-warning bg-warning/5 hover:bg-warning/10"
            disabled={buyDisabled}
            onClick={(e) => { e.stopPropagation(); onOpen(p); }}
          >
            {buyDisabled ? "⏳ OPENS 9:30 ET" : "BUY (REDUCE SIZE) →"}
          </Button>
        )}
        {cta.showAddToPortfolio && <AddToPortfolioButton pick={p} />}
        <span className="text-[10px] text-muted-foreground hidden md:inline ml-auto">
          {cta.helper}
        </span>
      </div>
    </div>
  );
}

function WatchlistRow({
  pick: p, onOpen,
}: {
  pick: ApprovedPick;
  onOpen: (p: ApprovedPick) => void;
}) {
  const isCall = p.contract.optionType === "call";
  return (
    <div className="w-full rounded-lg border border-primary/20 bg-primary/[0.03] hover:bg-primary/5 transition-colors">
      <button onClick={() => onOpen(p)} className="w-full flex items-center gap-3 p-3 text-left">
        <div className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold opacity-80",
          isCall ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish",
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
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary bg-primary/5">
              👀 Watchlist Only
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {p.tradeStateResult.triggerNeeded ?? p.tradeStateResult.reason}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="mono text-sm font-semibold text-muted-foreground">{p.rank?.finalRank ?? p.row.setupScore}</div>
        </div>
      </button>
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <SaveToWatchlistButton
          size="sm"
          symbol={p.row.symbol}
          direction={isCall ? "long_call" : "long_put"}
          optionType={p.contract.optionType}
          strike={p.contract.strike}
          expiry={p.contract.expiry}
          bias={p.row.bias}
          tier={p.row.readiness}
          entryPrice={p.row.price}
          thesis={p.tradeStateResult.triggerNeeded ?? p.tradeStateResult.reason}
          source="top-opportunities-watch"
          meta={{ setupScore: p.row.setupScore, tradeState: p.tradeState }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); onOpen(p); }}
        >
          View Trigger →
        </Button>
      </div>
    </div>
  );
}

function PendingPreviewRow({
  pick: p, onOpen, label = "Pending",
}: {
  pick: ApprovedPick;
  onOpen: (p: ApprovedPick) => void;
  label?: string;
}) {
  const isCall = p.contract.optionType === "call";
  return (
    <button
      onClick={() => onOpen(p)}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-primary/30 bg-primary/5 hover:bg-primary/10 text-[11px] text-left transition-colors"
    >
      <span className="font-mono font-semibold text-foreground w-12">{p.row.symbol}</span>
      <span className={cn("mono text-[11px]", isCall ? "text-bullish" : "text-bearish")}>
        ${p.contract.strike}{isCall ? "C" : "P"}
      </span>
      <span className="text-muted-foreground flex-1 truncate">
        {label}: {p.tradeStateResult.triggerNeeded ?? "waiting for trigger"}
      </span>
      <ExternalLink className="h-3 w-3 text-muted-foreground" />
    </button>
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
