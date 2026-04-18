import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Flame, ShieldCheck, Sparkles, Loader2, Info, RotateCcw } from "lucide-react";
import { getMockPicks, UPCOMING_EVENTS } from "@/lib/mockData";
import { useLiveQuotes, statusMeta } from "@/lib/liveData";
import { useMemo, useState } from "react";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { NewsFeed } from "@/components/NewsFeed";
import { SectorBreakdown } from "@/components/SectorBreakdown";
import { MarketHeroCards } from "@/components/MarketHeroCards";
import { PlaybookCard } from "@/components/PlaybookCard";
import { SaveToPortfolioButton } from "@/components/SaveToPortfolioButton";
import { TickerPrice } from "@/components/TickerPrice";
import { TipsRotator } from "@/components/TipsRotator";
import { SortableList } from "@/components/SortableList";

const RIGHT_COL_STORAGE_KEY = "nova_dashboard_right_col_order";

type RiskBucket = "safe" | "mild" | "aggressive";

export default function Dashboard() {
  const { data: quotes = [], isLoading: quotesLoading } = useLiveQuotes();
  const allPicks = useMemo(() => getMockPicks(60), []);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [riskTab, setRiskTab] = useState<RiskBucket>("safe");

  const picks = useMemo(
    () => allPicks.filter((p) => p.riskBucket === riskTab).slice(0, 6),
    [allPicks, riskTab]
  );

  const etfs = quotes.filter((q) => q.sector === "ETF");
  const verifiedCount = quotes.filter((q) => q.status === "verified" || q.status === "close").length;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Hero strip — plain-English meters */}
      <MarketHeroCards />

      {/* ETF strip */}
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
          <div className="text-xs text-muted-foreground py-6 text-center">No ETF quotes available right now.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
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
                        <div className={`pill ${meta.cls} mt-1.5 text-[9px]`}>{meta.label}</div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top opportunities */}
        <Card className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-wide">Top Opportunities Today</h2>
            </div>
            <Tabs value={riskTab} onValueChange={(v) => setRiskTab(v as RiskBucket)} className="w-auto">
              <TabsList className="h-8 bg-surface/60">
                <TabsTrigger value="safe" className="text-xs h-6">🟢 Safe</TabsTrigger>
                <TabsTrigger value="mild" className="text-xs h-6">🟡 Mild</TabsTrigger>
                <TabsTrigger value="aggressive" className="text-xs h-6">🔴 Aggressive</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {picks.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">No {riskTab} picks right now. Try another risk level.</div>
          )}
          <div className="space-y-2">
            {picks.map((p) => {
              const isPut = p.strategy.includes("put");
              const optionType = isPut ? "put" : "call";
              const direction = (p.strategy === "csp" || p.strategy === "covered-call") ? "short" : "long";
              return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenSymbol(p.symbol)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpenSymbol(p.symbol); }}
                className="w-full flex items-center gap-4 p-3 rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all text-left cursor-pointer"
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-mono text-xs font-bold ${p.bias === "bullish" ? "bg-bullish/15 text-bullish" : p.bias === "bearish" ? "bg-bearish/15 text-bearish" : "bg-muted text-muted-foreground"}`}>
                  {p.symbol.slice(0, 4)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{p.symbol}</span>
                    <TickerPrice symbol={p.symbol} showChange />
                    <span
                      title="NOVA — Nova's verdict engine reconciling technicals, Greeks & risk"
                      className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/40"
                    >
                      NOVA
                    </span>
                    <Badge variant="outline" className="h-5 text-[10px] capitalize border-border/60">
                      {p.strategy.replace("-", " ")}
                    </Badge>
                    <span className={`pill ${p.riskBucket === "safe" ? "pill-bullish" : p.riskBucket === "mild" ? "pill-neutral" : "pill-bearish"} capitalize`}>
                      {p.riskBucket}
                    </span>
                  </div>
                  <div className={`mono text-[11px] mt-1 font-semibold ${p.bias === "bullish" ? "text-bullish" : p.bias === "bearish" ? "text-bearish" : "text-foreground"}`}>
                    ${p.strike} {isPut ? "PUT" : "CALL"} · exp {p.expiration}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{p.reason}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="mono text-sm font-semibold text-bullish">{p.annualized}% ann.</div>
                  <div className="text-[10px] text-muted-foreground">${p.premium} • {p.dte}d</div>
                </div>
                <div className="text-right shrink-0 w-12">
                  <div className="mono text-lg font-semibold">{p.score}</div>
                  <div className="text-[10px] text-muted-foreground">Grade {p.confidence}</div>
                </div>
                <SaveToPortfolioButton
                  size="xs"
                  symbol={p.symbol}
                  optionType={optionType}
                  direction={direction}
                  strike={p.strike}
                  expiry={p.expiration}
                  entryPremium={p.premium}
                  thesis={p.reason}
                  source="dashboard"
                />
              </div>
            );})}
          </div>
        </Card>

        {/* Right column — drag to reorder */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
              Drag the grip to reorder widgets
            </span>
            <button
              onClick={() => { window.localStorage.removeItem(RIGHT_COL_STORAGE_KEY); window.location.reload(); }}
              title="Reset widget order"
              className="text-muted-foreground/60 hover:text-foreground transition-colors p-1"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
          <SortableList
            storageKey={RIGHT_COL_STORAGE_KEY}
            className="space-y-6"
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
            renderItem={(item, handle) => (
              <div className="relative group">
                <div className="absolute -left-1 top-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                  {handle}
                </div>
                {item.node}
              </div>
            )}
          />
        </div>
      </div>

      <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
