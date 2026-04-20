import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";
import { AlertTriangle, ShieldCheck, Sparkles, Loader2, Info, RotateCcw } from "lucide-react";
import { Hint } from "@/components/Hint";
import { UPCOMING_EVENTS } from "@/lib/mockData";
import { useLiveQuotes, statusMeta, currentSessionET } from "@/lib/liveData";
import { useState } from "react";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { NewsFeed } from "@/components/NewsFeed";
import { SectorBreakdown } from "@/components/SectorBreakdown";
import { MarketHeroCards } from "@/components/MarketHeroCards";
import { PreMarketFutures } from "@/components/PreMarketFutures";
import { PlaybookCard } from "@/components/PlaybookCard";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { QuoteSourceChip } from "@/components/QuoteSourceChip";
import { TipsRotator } from "@/components/TipsRotator";
import { SortableList } from "@/components/SortableList";
import { useHiddenSections } from "@/lib/dashboardSections";
import { NovaStatusStrip } from "@/components/NovaStatusStrip";
import { NovaModeBadge } from "@/components/NovaModeBadge";
import { NovaFilterBar } from "@/components/NovaFilterBar";
import { TopOpportunitiesToday } from "@/components/TopOpportunitiesToday";

const RIGHT_COL_STORAGE_KEY = "nova_dashboard_right_col_order";
const SECTIONS_STORAGE_KEY = "nova_dashboard_sections_order";

export default function Dashboard() {
  const { data: quotes = [], isLoading: quotesLoading } = useLiveQuotes();
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const { hiddenSet, hide } = useHiddenSections();

  const etfs = quotes.filter((q) => q.sector === "ETF");
  const verifiedCount = quotes.filter((q) => q.status === "verified" || q.status === "close").length;

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
            Drag the grip to reorder · click ✕ to hide (restore from <Link to="/settings" className="underline underline-offset-2 hover:text-foreground">Settings</Link>)
          </span>
          <NovaModeBadge />
        </div>
        <Hint label="Reset section order to default">
          <button
            onClick={() => { window.localStorage.removeItem(SECTIONS_STORAGE_KEY); window.location.reload(); }}
            aria-label="Reset section order"
            className="text-muted-foreground/60 hover:text-foreground transition-colors p-1"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </Hint>
      </div>

      <SortableList
        storageKey={SECTIONS_STORAGE_KEY}
        className="space-y-6"
        hiddenIds={hiddenSet}
        onHide={hide}
        renderItem={(item, handle, hideButton) => (
          <div className="relative group">
            <div className="absolute -left-2 top-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
              {handle}
              {hideButton}
            </div>
            {item.node}
          </div>
        )}
        items={[
          ...(currentSessionET() === "regular" ? [] : [{ id: "futures", node: <PreMarketFutures /> }]),
          { id: "nova-status", node: <NovaStatusStrip /> },
          { id: "nova-filter", node: <NovaFilterBar /> },
          { id: "hero", node: <MarketHeroCards /> },
          { id: "etfs", node: (
            <Card className="glass-card p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-wide">Sector ETFs</h2>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                          <Info className="h-3 w-3" /> About prices
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                        Prices come from Finnhub + Alpha Vantage and may be delayed up to ~15 minutes vs. live brokerage feeds (e.g. Robinhood). Use for research, not order entry.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {quotesLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="pill pill-bullish cursor-help">
                          <ShieldCheck className="h-3 w-3" /> {verifiedCount}/{quotes.length} good
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        Two providers agree on the price (within 1%).
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span>{etfs.length} ETFs</span>
                </div>
              </div>
              {etfs.length === 0 && !quotesLoading ? (
                <div className="text-xs text-muted-foreground py-6 text-center min-h-[88px] flex items-center justify-center">No ETF quotes available right now.</div>
              ) : etfs.length === 0 && quotesLoading ? (
                <div className="min-h-[88px]" aria-hidden />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 min-h-[88px]">
                  {etfs.map((e) => {
                    const up = e.change >= 0;
                    const meta = statusMeta(e.status);
                    return (
                      <TooltipProvider key={e.symbol} delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setOpenSymbol(e.symbol)}
                              className="text-left p-3 rounded-lg border border-border bg-surface/40 hover:border-primary/40 hover:bg-surface transition-all w-full"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-semibold">{e.symbol}</span>
                                <span className={`text-[10px] mono ${up ? "text-bullish" : "text-bearish"}`}>
                                  {up ? "+" : ""}{e.changePct.toFixed(2)}%
                                </span>
                              </div>
                              <div className="mono text-sm mt-1">${e.price.toFixed(2)}</div>
                              <div className="flex items-center gap-1 mt-1.5">
                                <div className={`pill ${meta.cls} text-[9px]`}>{meta.label}</div>
                                <QuoteSourceChip quote={e} />
                              </div>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                            {meta.tip}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              )}
            </Card>
          )},
          { id: "watchlist", node: <WatchlistPanel onOpenSymbol={setOpenSymbol} /> },
          { id: "opportunities-grid", node: (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <TopOpportunitiesToday maxResults={6} />

        {/* Right column — drag to reorder */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              Drag the grip to reorder widgets
            </span>
            <Hint label="Reset widget order to default">
              <button
                onClick={() => { window.localStorage.removeItem(RIGHT_COL_STORAGE_KEY); window.location.reload(); }}
                aria-label="Reset widget order"
                className="text-muted-foreground/60 hover:text-foreground transition-colors p-1"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </Hint>
          </div>
          <SortableList
            storageKey={RIGHT_COL_STORAGE_KEY}
            className="space-y-6"
            hiddenIds={hiddenSet}
            onHide={hide}
            items={[
              { id: "events", node: (
                <Card className="glass-card p-5">
                  <h2 className="text-sm font-semibold tracking-wide mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-neutral" /> Event Watch
                  </h2>
                  <div className="space-y-2">
                    {UPCOMING_EVENTS.map((e) => (
                      <div key={e.label} className="flex items-center justify-between p-2 rounded-md border border-border/60">
                        <div>
                          <div className="text-sm">{e.label}</div>
                          <div className="text-[11px] text-muted-foreground">{e.when}</div>
                        </div>
                        <span className={`pill ${e.risk === "high" ? "pill-bearish" : "pill-neutral"} capitalize`}>
                          {e.risk}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )},
              { id: "ai-summary", node: (
                <Card className="glass-card p-5">
                  <h2 className="text-sm font-semibold tracking-wide mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" /> AI Summary of the Day
                  </h2>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    Risk-on regime continues with semis leading. <span className="text-bullish font-medium">SMH +2.4%</span> dragged tech higher. IV remains compressed across mega caps — <span className="text-foreground">favor premium-selling on quality</span>. Caution: <span className="text-bearish font-medium">NVDA earnings Thursday</span>; consider closing short-dated short premium before AMC.
                  </p>
                </Card>
              )},
              { id: "tips", node: <TipsRotator /> },
              { id: "playbook", node: <PlaybookCard onPick={setOpenSymbol} /> },
              { id: "news", node: <NewsFeed limit={8} title="Reuters News" sources={["reuters"]} sourceLabel="via Reuters" /> },
              { id: "sectors", node: <SectorBreakdown quotes={quotes} onPick={setOpenSymbol} /> },
            ]}
            renderItem={(item, handle, hideButton) => (
              <div className="relative group">
                <div className="absolute -left-1 top-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                  {handle}
                  {hideButton}
                </div>
                {item.node}
              </div>
            )}
          />
        </div>
            </div>
          )},
        ]}
      />

      <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
