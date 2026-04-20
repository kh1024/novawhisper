import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/Hint";
import { Star, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { useWatchlist, useRemoveFromWatchlist, type WatchlistItem } from "@/lib/watchlist";
import { useVerdicts } from "@/lib/portfolioVerdict";
import type { PortfolioPosition } from "@/lib/portfolio";
import { TickerPrice } from "@/components/TickerPrice";
import { Sparkline } from "@/components/Sparkline";
import { useSma200 } from "@/lib/sma200";
import { PickMetaRow, VerdictBadge } from "@/components/PickMetaRow";
import { computeVerdict } from "@/lib/verdictModel";
import { useBudget } from "@/lib/budget";

interface Props {
  onOpenSymbol?: (symbol: string) => void;
}

/** Map a watchlist row into the PortfolioPosition shape useVerdicts expects. */
function toPseudoPosition(w: WatchlistItem): PortfolioPosition {
  return {
    id: w.id,
    owner_key: w.owner_key,
    symbol: w.symbol,
    option_symbol: null,
    option_type: w.option_type,
    direction: w.direction,
    strike: Number(w.strike ?? 0),
    strike_short: w.strike_short != null ? Number(w.strike_short) : null,
    expiry: w.expiry ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    contracts: 1,
    entry_premium: null,
    entry_underlying: w.entry_price != null ? Number(w.entry_price) : null,
    entry_at: w.created_at,
    entry_cost_total: null,
    thesis: w.thesis,
    entry_thesis: w.thesis,
    initial_score: null,
    initial_gates: null,
    risk_bucket: null,
    source: w.source,
    status: "open",
    close_premium: null,
    closed_at: null,
    notes: null,
    is_paper: true,
    hard_stop_pct: -30,
    target_1_pct: 50,
    target_2_pct: 100,
    max_hold_days: null,
    current_price: null,
    current_profit_pct: null,
    exit_recommendation: "NO_SIGNAL",
    exit_reason: null,
    exit_price: null,
    exit_time: null,
    realized_pnl: null,
    last_evaluated_at: null,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

/** Translate the legacy verdict signal into the upstream label our shared
 *  verdict model understands. Lets one badge speak for the whole row. */
function upstreamFromVerdict(action?: string, status?: string): string {
  const a = (action ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (a === "cut" || s.includes("trouble") || s.includes("bleeding")) return "AVOID";
  if (a === "take_profit" || s.includes("expiring")) return "EXIT";
  if (s === "winning" || s === "running fine") return "BUY NOW";
  return "WAIT";
}

export function WatchlistPanel({ onOpenSymbol }: Props) {
  const { data: items = [], isLoading } = useWatchlist();
  const remove = useRemoveFromWatchlist();
  const [budget] = useBudget();
  const pseudo = useMemo(() => items.map(toPseudoPosition), [items]);
  const verdictQ = useVerdicts(pseudo);
  // Daily closes for sparklines — same 24h cache as the rest of the app.
  const symbols = useMemo(() => Array.from(new Set(items.map((w) => w.symbol))), [items]);
  const { map: smaMap } = useSma200(symbols);

  const verdictMap = useMemo(
    () => new Map((verdictQ.data?.verdicts ?? []).map((v) => [v.id, v])),
    [verdictQ.data],
  );
  const quoteMap = useMemo(
    () => new Map((verdictQ.data?.quotes ?? []).map((q) => [q.symbol, q])),
    [verdictQ.data],
  );

  return (
    <Card className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-warning fill-warning" />
          <h2 className="text-sm font-semibold tracking-wide">My Watchlist</h2>
          <Badge variant="outline" className="h-5 text-[10px]">{items.length}</Badge>
          {verdictQ.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <span className="text-[10px] text-muted-foreground">
          Saved by you · Live verdict refreshes every few minutes.
        </span>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">
          Tap the <Star className="inline h-3 w-3 -mt-0.5" /> Watch button on any pick (Scanner, Market,
          Strategy, Planning, Research) to track it here with a live Buy Now / Watchlist / Wait / Avoid verdict.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((w) => {
            const v = verdictMap.get(w.id);
            const live = quoteMap.get(w.symbol);
            const upstream = upstreamFromVerdict(v?.action, v?.status);
            const entry = w.entry_price != null ? Number(w.entry_price) : null;
            const delta = entry != null && live?.price ? ((live.price - entry) / entry) * 100 : null;
            const verdictResult = computeVerdict({
              symbol: w.symbol,
              rawBias: w.bias,
              optionType: w.option_type,
              strike: w.strike,
              price: live?.price ?? null,
              changePct: live?.changePct ?? null,
              budget,
              riskBucket: w.tier,
              upstreamLabel: upstream,
              isReady: upstream === "BUY NOW",
            });
            return (
              <div
                key={w.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenSymbol?.(w.symbol)}
                onKeyDown={(e) => { if (e.key === "Enter") onOpenSymbol?.(w.symbol); }}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all cursor-pointer"
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-mono text-xs font-bold ${
                  w.bias === "bullish" ? "bg-bullish/15 text-bullish"
                  : w.bias === "bearish" ? "bg-bearish/15 text-bearish"
                  : "bg-muted text-muted-foreground"
                }`}>
                  {w.symbol.slice(0, 4)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{w.symbol}</span>
                    <TickerPrice symbol={w.symbol} showChange />
                    {w.source && (
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                        from {w.source}
                      </span>
                    )}
                  </div>
                  <PickMetaRow className="mt-1.5" result={verdictResult} expiry={w.expiry} />
                  {w.thesis && (
                    <div className="text-xs text-muted-foreground truncate mt-1">{w.thesis}</div>
                  )}
                </div>

                <div className="text-right shrink-0 hidden sm:block">
                  {(() => {
                    const closes = smaMap.get(w.symbol)?.closes;
                    const tail = closes && closes.length >= 2 ? closes.slice(-20) : null;
                    return tail ? (
                      <div className="mb-1 flex justify-end">
                        <Sparkline values={tail} width={72} height={20} ariaLabel={`${w.symbol} 20-day trend`} />
                      </div>
                    ) : null;
                  })()}
                  {entry != null && (
                    <div className="text-[10px] text-muted-foreground">
                      Entry <span className="mono text-foreground">${entry.toFixed(2)}</span>
                    </div>
                  )}
                  {delta != null && (
                    <div className={`mono text-xs font-semibold ${delta >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(2)}%
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">Live</span>
                    <VerdictBadge verdict={verdictResult.verdict} reason={verdictResult.reason} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Hint label="Open research">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 gap-1"
                        onClick={(e) => { e.stopPropagation(); onOpenSymbol?.(w.symbol); }}
                      >
                        <ExternalLink className="h-3 w-3" /> Open
                      </Button>
                    </Hint>
                    <Hint label="Remove from watchlist">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-bearish"
                        onClick={(e) => { e.stopPropagation(); remove.mutate(w.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </Hint>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
