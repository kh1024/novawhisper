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
          { id: "hero", node: <MarketHeroCards /> },
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
