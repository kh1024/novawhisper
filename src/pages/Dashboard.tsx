import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "react-router-dom";
import { AlertTriangle, Flame, ShieldCheck, Sparkles, Loader2, Info, RotateCcw } from "lucide-react";
import { Hint } from "@/components/Hint";
import { getMockPicks, UPCOMING_EVENTS, TICKER_UNIVERSE } from "@/lib/mockData";
import { useLiveQuotes, statusMeta, currentSessionET } from "@/lib/liveData";
import { useMemo, useState } from "react";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { NewsFeed } from "@/components/NewsFeed";
import { SectorBreakdown } from "@/components/SectorBreakdown";
import { MarketHeroCards } from "@/components/MarketHeroCards";
import { PreMarketFutures } from "@/components/PreMarketFutures";
import { PlaybookCard } from "@/components/PlaybookCard";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { PickMetaRow } from "@/components/PickMetaRow";
import { TickerPrice } from "@/components/TickerPrice";
import { QuoteSourceChip } from "@/components/QuoteSourceChip";
import { TipsRotator } from "@/components/TipsRotator";
import { SortableList } from "@/components/SortableList";
import { useHiddenSections } from "@/lib/dashboardSections";
import { NovaStatusStrip } from "@/components/NovaStatusStrip";
import { NovaModeBadge } from "@/components/NovaModeBadge";
import { NovaGuardBadges } from "@/components/NovaGuardBadges";
import { evaluateGuards } from "@/lib/novaGuards";
import { useSma200 } from "@/lib/sma200";
import { NovaFilterBar } from "@/components/NovaFilterBar";
import { useNovaFilter, pickMatchesFilter, isFilterActive } from "@/lib/novaFilter";
import { useOptionsScout, type ScoutPick } from "@/lib/optionsScout";
import { actionFromScore, labelClasses } from "@/lib/finalRank";
import { smartActionLabel, smartActionTooltip, emptyStateCopy } from "@/lib/actionCopy";
import { detectTimeState } from "@/lib/novaBrain";
import { BudgetAltSuggestion } from "@/components/BudgetAltSuggestion";
import { useBudget } from "@/lib/budget";
import { useSettings } from "@/lib/settings";
import { partitionByAffordability, type AffordabilityResult } from "@/lib/affordability";
import { AffordabilityBadge } from "@/components/AffordabilityBadge";
import type { OptionPick } from "@/lib/mockData";

/**
 * Compute moneyness for a long option vs the live underlying price.
 * Returns ITM / ATM / OTM with the % distance — used for the inline
 * moneyness chip on every pick row.
 */
function moneynessOf(optionType: "call" | "put", strike: number, spot: number | null) {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  const diffPct = ((spot - strike) / spot) * 100;          // call: + = ITM
  const intrinsicPct = optionType === "call" ? diffPct : -diffPct;
  if (Math.abs(intrinsicPct) < 1) {
    return { kind: "ATM" as const, pct: intrinsicPct, cls: "border-muted-foreground/40 text-foreground bg-surface/60" };
  }
  if (intrinsicPct > 0) {
    return { kind: "ITM" as const, pct: intrinsicPct, cls: "border-bullish/50 bg-bullish/10 text-bullish" };
  }
  return { kind: "OTM" as const, pct: intrinsicPct, cls: "border-warning/50 bg-warning/10 text-warning" };
}

const RIGHT_COL_STORAGE_KEY = "nova_dashboard_right_col_order";
const SECTIONS_STORAGE_KEY = "nova_dashboard_sections_order";

type RiskBucket = "safe" | "mild" | "aggressive" | "lottery";

// Map a NOVA scout pick (from the options-scout edge fn) into the OptionPick
// shape the dashboard row renderer expects. This lets us share a single render
// path between live scout picks and the mock fallback.
function scoutToOptionPick(s: ScoutPick, bucket: RiskBucket, idx: number): OptionPick {
  const isPut = s.optionType === "put";
  const isLeaps = /leaps/i.test(s.strategy);
  const strategy: OptionPick["strategy"] = isLeaps
    ? (isPut ? "leaps-put" : "leaps-call")
    : (isPut ? "long-put" : "long-call");
  const expDate = new Date(s.expiry);
  const dte = Math.max(1, Math.round((expDate.getTime() - Date.now()) / 86_400_000));
  const premiumNum = Number(String(s.premiumEstimate ?? "").match(/[\d.]+/)?.[0] ?? 0);
  const annualized = Number(String(s.expectedReturn ?? "").match(/[\d.]+/)?.[0] ?? 0);
  const score = (s.confidenceScore ?? 7) * 10;
  const grade: "A" | "B" | "C" = (s.grade as "A" | "B" | "C") ?? "B";
  return {
    id: `scout-${bucket}-${s.symbol}-${idx}`,
    symbol: s.symbol,
    strategy,
    riskBucket: bucket,
    expiration: s.expiry,
    dte,
    strike: s.strike,
    premium: premiumNum,
    premiumPct: 0,
    annualized,
    delta: 0, theta: 0, vega: 0, ivRank: 0, oi: 0, volume: 0, spreadPct: 0,
    score,
    confidence: grade,
    bias: s.bias ?? (isPut ? "bearish" : "bullish"),
    signals: [],
    reason: s.thesis,
  };
}

export default function Dashboard() {
  const { data: quotes = [], isLoading: quotesLoading } = useLiveQuotes();
  const { data: scout } = useOptionsScout();
  const allPicks = useMemo(() => getMockPicks(60), []);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const { hiddenSet, hide } = useHiddenSections();
  const [riskTab, setRiskTab] = useState<RiskBucket>("safe");
  // DTE quick-filter — lets the user narrow Top Opportunities to ultra-short
  // dated contracts. "all" = no filter, "0dte" = expires today (≤1 day),
  // "week" = expires within the next 7 days. Applied AFTER Nova/affordability
  // filters so it only narrows what's already eligible.
  const [dteFilter, setDteFilter] = useState<"all" | "0dte" | "week">("all");
  const [novaSpec] = useNovaFilter();
  const novaActive = isFilterActive(novaSpec);
  const [budget] = useBudget();
  const [settings] = useSettings();
  const [showBlocked, setShowBlocked] = useState(false);
  const [showBudgetBlocked, setShowBudgetBlocked] = useState(false);
  // Weekend Kill-Switch — only meaningful on Sat/Sun. Default ON so users
  // don't see Friday-frozen "ghost" picks on a quiet Saturday morning.
  const isWeekend = useMemo(() => {
    const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
    return dow === 0 || dow === 6;
  }, []);
  const [hideWeekendGhosts, setHideWeekendGhosts] = useState(true);

  // Step 1 — gather the candidate pool (NOVA scout if available, mock otherwise)
  // and apply the user's Nova-filter spec. We do NOT touch budget here.
  const filtered = useMemo(() => {
    const bucketMap: Record<RiskBucket, ScoutPick[]> = {
      safe: scout?.conservative ?? [],
      mild: scout?.moderate ?? [],
      aggressive: scout?.aggressive ?? [],
      lottery: scout?.lottery ?? [],
    };
    const singleLegMock = allPicks.filter((p) =>
      p.strategy === "long-call" || p.strategy === "long-put" ||
      p.strategy === "leaps-call" || p.strategy === "leaps-put"
    );
    let pool: OptionPick[];
    if (novaActive) {
      const allScout = (["safe", "mild", "aggressive", "lottery"] as RiskBucket[])
        .flatMap((b) => bucketMap[b].map((s, i) => scoutToOptionPick(s, b, i)));
      pool = allScout.length > 0 ? allScout : singleLegMock;
    } else {
      const liveBucket = bucketMap[riskTab].map((s, i) => scoutToOptionPick(s, riskTab, i));
      pool = liveBucket.length > 0
        ? liveBucket
        : singleLegMock.filter((p) => p.riskBucket === riskTab);
    }
    return pool.filter((p) => pickMatchesFilter({
      symbol: p.symbol,
      strategy: p.strategy,
      riskBucket: p.riskBucket,
      bias: p.bias,
      optionType: p.strategy === "long-put" || p.strategy === "leaps-put" ? "put" : "call",
      expiration: p.expiration,
      dte: p.dte,
      premium: p.premium,
      score: p.score,
      annualized: p.annualized,
      earningsInDays: p.earningsInDays ?? null,
    }, novaSpec));
  }, [allPicks, riskTab, novaSpec, novaActive, scout]);

  // Step 2 — HARD AFFORDABILITY FILTER (spec: budget is a hard rule).
  // Splits the pool into recommendable (Comfortable/Affordable, never blocked)
  // and blocked (over budget — surfaced separately, never ranked as top picks).
  // Re-runs whenever `budget` changes so flipping it in Settings refreshes
  // the recommendation list immediately.
  const partition = useMemo(
    () => partitionByAffordability(filtered, budget, (p) => ({
      perShareCost: p.premium,
      contracts: 1,
      settings,
    })),
    [filtered, budget, settings],
  );

  // Map pick.id → AffordabilityResult so child rows can render the badge.
  const affBy = useMemo(() => {
    const m = new Map<string, AffordabilityResult>();
    for (const r of partition.recommendable) m.set(r.item.id, r.aff);
    for (const r of partition.blocked)        m.set(r.item.id, r.aff);
    for (const r of partition.unavailable)    m.set(r.item.id, r.aff);
    return m;
  }, [partition]);

  // Apply DTE quick-filter on top of affordability — keeps the cap consistent
  // with what the user sees in the chip toolbar.
  const dteFiltered = useMemo(() => {
    const recs = partition.recommendable;
    if (dteFilter === "all") return recs;
    if (dteFilter === "0dte") return recs.filter(({ item }) => item.dte <= 1);
    return recs.filter(({ item }) => item.dte <= 7);
  }, [partition, dteFilter]);

  // Top picks the user actually sees — affordability-filtered FIRST, then
  // DTE-narrowed, then capped. Blocked items live in their own drawer below.
  const picks = useMemo(
    () => dteFiltered.map((r) => r.item).slice(0, novaActive ? 12 : 6),
    [dteFiltered, novaActive],
  );
  const blockedPicks = partition.blocked;
  // Counts for the chip toolbar — shown as small badges so users see at a
  // glance how many same-day / same-week affordable picks exist right now.
  const dteCounts = useMemo(() => ({
    all: partition.recommendable.length,
    "0dte": partition.recommendable.filter(({ item }) => item.dte <= 1).length,
    week: partition.recommendable.filter(({ item }) => item.dte <= 7).length,
  }), [partition]);
  // True when there's nothing affordable to recommend AT ALL.
  const noAffordableTrades = partition.recommendable.length === 0 && filtered.length > 0;


  const etfs = quotes.filter((q) => q.sector === "ETF");
  const verifiedCount = quotes.filter((q) => q.status === "verified" || q.status === "close").length;

  // Quote map for guard eval (Stale Quote + Intrinsic Audit) — live spot per symbol.
  const quoteMap = useMemo(() => new Map(quotes.map((q) => [q.symbol, q])), [quotes]);
  // 200-day SMA cache (24h) — drives the long-term trend gate.
  const pickSymbols = useMemo(() => Array.from(new Set(picks.map((p) => p.symbol))), [picks]);
  const sma = useSma200(pickSymbols);

  // Pre-compute the guard verdict for each pick so we can hide the BLOCKED rows
  // by default (they only clutter the list — users can opt-in to see them).
  const picksWithGuard = useMemo(() => picks.map((p) => {
    const isPut = p.strategy === "long-put" || p.strategy === "leaps-put";
    const optionType = isPut ? ("put" as const) : ("call" as const);
    const live = quoteMap.get(p.symbol);
    const pickPrice = TICKER_UNIVERSE.find((u) => u.symbol === p.symbol)?.base ?? null;
    const guard = evaluateGuards({
      symbol: p.symbol,
      pickPrice,
      livePrice: live?.price ?? null,
      riskBucket: p.riskBucket,
      optionType,
      direction: "long",
      strike: p.strike,
      sma200: sma.map.get(p.symbol)?.sma200 ?? null,
    });
    // Weekend Ghost: live quote older than 4h on a Sat/Sun = stale Friday data.
    const ageH = live?.updatedAt ? (Date.now() - new Date(live.updatedAt).getTime()) / 3_600_000 : Infinity;
    const isGhost = isWeekend && ageH > 4;
    return { p, guard, blocked: guard.shouldBlockSignal, optionType, live, pickPrice, isGhost };
  }), [picks, quoteMap, sma, isWeekend]);
  const blockedCount = picksWithGuard.filter((x) => x.blocked).length;
  const ghostCount = picksWithGuard.filter((x) => x.isGhost).length;
  const visiblePicks = picksWithGuard.filter((x) => {
    if (!showBlocked && x.blocked) return false;
    if (hideWeekendGhosts && x.isGhost) return false;
    return true;
  });

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
