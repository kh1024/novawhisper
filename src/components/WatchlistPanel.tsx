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


interface Props {
  onOpenSymbol?: (symbol: string) => void;
}

/** Map a watchlist row into the PortfolioPosition shape useVerdicts expects. */
function toPseudoPosition(w: WatchlistItem): PortfolioPosition {
  return {
    id: w.id,
    owner_key: w.owner_key,
    symbol: w.symbol,
    option_type: w.option_type,
    direction: w.direction,
    strike: Number(w.strike ?? 0),
    strike_short: w.strike_short != null ? Number(w.strike_short) : null,
    expiry: w.expiry ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    contracts: 1,
    entry_premium: null,
    entry_underlying: w.entry_price != null ? Number(w.entry_price) : null,
    entry_at: w.created_at,
    thesis: w.thesis,
    source: w.source,
    status: "open",
    close_premium: null,
    closed_at: null,
    notes: null,
    is_paper: true,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

/** Friendly label + classes for a verdict signal. */
function signalChip(action?: string, status?: string) {
  const a = (action ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (a === "cut" || s.includes("trouble") || s.includes("bleeding"))
    return { label: "AVOID", cls: "border-bearish/50 bg-bearish/15 text-bearish" };
  if (a === "take_profit" || s.includes("expiring"))
    return { label: "EXIT", cls: "border-warning/50 bg-warning/15 text-warning" };
  if (s === "winning" || s === "running fine")
    return { label: "BUY NOW", cls: "border-bullish/50 bg-bullish/15 text-bullish" };
  return { label: "WAIT", cls: "border-muted-foreground/40 bg-muted/40 text-foreground" };
}

/** Map the verdict signal into a plain-English Timing label. */
function timingLabel(action?: string, status?: string): { label: string; cls: string } {
  const chip = signalChip(action, status);
  if (chip.label === "BUY NOW") return { label: "Ready", cls: "text-bullish" };
  if (chip.label === "EXIT") return { label: "Exit Soon", cls: "text-warning" };
  if (chip.label === "AVOID") return { label: "Avoid", cls: "text-bearish" };
  // WAIT — distinguish "wait for open" vs "watch closely" by market clock.
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = est.getDay();
  const min = est.getHours() * 60 + est.getMinutes();
  const isOpen = dow >= 1 && dow <= 5 && min >= 9 * 60 + 30 && min < 16 * 60;
  return isOpen
    ? { label: "Watch Closely", cls: "text-warning" }
    : { label: "Wait for Open", cls: "text-muted-foreground" };
}

/** Normalize the saved tier into a clean Risk label. */
function riskLabel(tier?: string | null): string {
  const t = (tier ?? "").toLowerCase();
  if (t === "safe" || t.startsWith("conserv")) return "Conservative";
  if (t === "mild" || t.startsWith("mod") || t === "mid") return "Mid";
  if (t === "aggressive" || t === "lottery") return "Aggressive";
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "—";
}

/** Build the compact contract label, e.g. "$120C" or "$95P". */
function contractLabel(strike: number | string | null | undefined, optionType: string): string {
  if (strike == null || strike === "") return optionType.toUpperCase();
  const n = Number(strike);
  const s = Number.isFinite(n) ? (Number.isInteger(n) ? `${n}` : n.toFixed(2)) : `${strike}`;
  const suffix = optionType === "put" ? "P" : optionType === "call" ? "C" : optionType.charAt(0).toUpperCase();
  return `$${s}${suffix}`;
}

export function WatchlistPanel({ onOpenSymbol }: Props) {
  const { data: items = [], isLoading } = useWatchlist();
  const remove = useRemoveFromWatchlist();
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
          Live verdicts refresh every few minutes.
        </span>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">
          Tap the <Star className="inline h-3 w-3 -mt-0.5" /> Watch button on any pick (Scanner, Market,
          Strategy, Planning, Research) to track it here with a live Buy / Wait / Avoid verdict.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((w) => {
            const v = verdictMap.get(w.id);
            const live = quoteMap.get(w.symbol);
            const chip = signalChip(v?.action, v?.status);
            const isPut = w.option_type === "put";
            const entry = w.entry_price != null ? Number(w.entry_price) : null;
            const delta = entry != null && live?.price ? ((live.price - entry) / entry) * 100 : null;
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
                  {(() => {
                    const timing = timingLabel(v?.action, v?.status);
                    const biasText = w.bias === "bullish" ? "Bullish" : w.bias === "bearish" ? "Bearish" : "Neutral";
                    const biasCls = w.bias === "bullish" ? "text-bullish" : w.bias === "bearish" ? "text-bearish" : "text-foreground";
                    return (
                      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] leading-tight">
                        <div>
                          <span className="text-muted-foreground">Bias:</span>{" "}
                          <span className={`font-semibold ${biasCls}`}>{biasText}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Timing:</span>{" "}
                          <span className={`font-semibold ${timing.cls}`}>{timing.label}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Risk:</span>{" "}
                          <span className="font-semibold text-foreground">{riskLabel(w.tier)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Contract:</span>{" "}
                          <span className="font-semibold mono text-foreground">{contractLabel(w.strike, w.option_type)}</span>
                          {w.expiry ? <span className="text-muted-foreground"> · {w.expiry}</span> : null}
                        </div>
                      </div>
                    );
                  })()}
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
                  <Hint label={
                    chip.label === "BUY NOW" ? "NOVA verdict says it's a high-conviction entry right now."
                    : chip.label === "EXIT" ? "Take profit / cut — the setup is breaking down."
                    : chip.label === "AVOID" ? "Edge gone — better to skip this one."
                    : "Mixed signals — wait for confirmation before entering."
                  }>
                    <span className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded border cursor-help ${chip.cls}`}>
                      {chip.label}
                    </span>
                  </Hint>
                  <div className="flex items-center gap-1">
                    <Hint label="Open research">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={(e) => { e.stopPropagation(); onOpenSymbol?.(w.symbol); }}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </Hint>
                    <Hint label="Remove from watchlist">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-bearish"
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
