import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useActiveBucket, rowBucket, bucketEmoji, type ActiveBucket } from "@/lib/scannerBucket";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, LayoutGrid, Table2, SlidersHorizontal, RefreshCw, Loader2,
  TrendingUp, TrendingDown, Minus, AlertTriangle, ShieldAlert, Activity,
  Gauge, Zap, Clock, Newspaper, Scale, RotateCcw, CandlestickChart, ExternalLink,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { useLiveQuotes } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { computeSetups, type SetupRow, type Bias, type Readiness } from "@/lib/setupScore";
import { selectStrategy, type StrategyDecision } from "@/lib/strategySelector";
import { rankSetup, labelClasses, type RankResult, type ActionLabel } from "@/lib/finalRank";
import { smartActionLabel } from "@/lib/actionCopy";
import { useSnapshotUploader } from "@/lib/useSnapshotUploader";
import { StrategyPlaybookCard } from "@/components/StrategyPlaybookCard";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/lib/settings";
import { useBudget } from "@/lib/budget";
import { dispatchPickAlerts } from "@/lib/webhook";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { Hint } from "@/components/Hint";
import { usePickExpiration, type PickInputs } from "@/lib/pickExpiration";
import { PickExpiryChips } from "@/components/PickExpiryChips";
import { evaluateGuards } from "@/lib/novaGuards";
import { useSma200 } from "@/lib/sma200";
import { useEarnings } from "@/lib/earnings";
import { NovaGuardBadges } from "@/components/NovaGuardBadges";
import { NovaFilterBar } from "@/components/NovaFilterBar";
import { useNovaFilter, pickMatchesFilter } from "@/lib/novaFilter";
import { usePortfolio } from "@/lib/portfolio";
import { ScannerToolbar } from "@/components/ScannerToolbar";
import { Sparkline } from "@/components/Sparkline";
import { VerdictBadge } from "@/components/PickMetaRow";
import {
  computeVerdict, isMarketOpen, isWeekend,
  type VerdictResult, type Verdict,
} from "@/lib/verdictModel";
import { getMarketState, getSessionMode, type SessionMode } from "@/lib/marketHours";
import { MobileScannerList } from "@/components/scanner/MobileScannerList";
import { PreMarketPreviewBanner } from "@/components/PreMarketPreviewBanner";
import { StrategyContextBar, type PipelineCounts } from "@/components/StrategyContextBar";
import { StrategyEditDrawer } from "@/components/StrategyEditDrawer";
import { CollapsibleBlockedSection } from "@/components/CollapsibleBlockedSection";
import { BlockedPickCard, type BlockedPickInfo } from "@/components/BlockedPickCard";
import { PreMarketPickCard } from "@/components/PreMarketPickCard";
import { LoosenToSeePicks } from "@/components/LoosenToSeePicks";
import { ScanCache, formatCacheAge } from "@/lib/scanCache";
import { generatePreMarketPicks, isPreMarketWindow } from "@/lib/preMarketGenerator";
import { useStrategyProfile, maxPerTradeDollars, isStructureAllowed } from "@/lib/strategyProfile";
import { useScannerOverrides } from "@/lib/scannerOverrides";
import { usePreMarketStatus } from "@/lib/preMarketPreview";
import { isConservativeCheapTicker } from "@/lib/bucketing";
import { BudgetMismatchCard } from "@/components/BudgetMismatchCard";
import { TomorrowsGamePlan } from "@/components/TomorrowsGamePlan";
import { buildStrikeLadder, pickBestRung } from "@/lib/strikeLadder";
import { findCheapestAlternative } from "@/lib/useScannerPicks";
import { Sparkles } from "lucide-react";
import { getOrbStatus } from "@/lib/orb";
import { useScannerPicks } from "@/lib/useScannerPicks";
import { ScannerBuckets } from "@/components/ScannerBuckets";

// Build a sensible default options contract from a scanner row so the user can
// save it to their portfolio with one click. ATM strike, ~30 DTE next Friday,
// option type follows the row's bias (bullish → call, bearish → put,
// neutral/reversal → call by default).
function deriveContractFromRow(r: SetupRow) {
  const optionType = r.bias === "bearish" ? "put" : "call";
  // ATM-ish: round to nearest dollar (or nearest $5 for stocks > $100).
  const step = r.price >= 100 ? 5 : 1;
  const strike = Math.max(step, Math.round(r.price / step) * step);
  // Next Friday at least 28 days out.
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 28);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  const expiry = d.toISOString().slice(0, 10);
  return {
    symbol: r.symbol,
    optionType,
    direction: "long",
    strike,
    expiry,
    entryUnderlying: r.price,
    thesis: r.crl?.reason || `${r.bias} setup · score ${r.setupScore}`,
    source: "scanner" as const,
  };
}

type View = "table" | "cards";

const BIAS_OPTIONS: { v: "all" | Bias; label: string }[] = [
  { v: "all", label: "All bias" },
  { v: "bullish", label: "Bullish" },
  { v: "bearish", label: "Bearish" },
  { v: "neutral", label: "Range" },
  { v: "reversal", label: "Reversal" },
];

const READINESS_OPTIONS: { v: "all" | Readiness; label: string; cls: string }[] = [
  { v: "all", label: "Any readiness", cls: "" },
  { v: "NOW", label: "NOW only", cls: "text-bullish" },
  { v: "WAIT", label: "WAIT only", cls: "text-warning" },
  { v: "AVOID", label: "AVOID only", cls: "text-bearish" },
];

const SECTORS = ["all", ...Array.from(new Set(TICKER_UNIVERSE.map((t) => t.sector).filter(Boolean)))];

const DEFAULT_FILTERS = {
  search: "",
  sector: "all",
  bias: "all" as "all" | Bias,
  readiness: "all" as "all" | Readiness,
  minScore: [40] as number[],
  minRelVol: [0] as number[],
  ivrRange: [0, 100] as number[],
  rsiRange: [0, 100] as number[],
  changeRange: [-15, 15] as number[],
  minOptionsLiq: [40] as number[],
  excludeEarnings: false,
  weeklyOnly: false,
  hideAvoid: false,
};

const biasMeta = (b: Bias) => {
  switch (b) {
    case "bullish":  return { cls: "pill-bullish",  Icon: TrendingUp };
    case "bearish":  return { cls: "pill-bearish",  Icon: TrendingDown };
    case "reversal": return { cls: "pill-neutral",  Icon: RotateCcw };
    default:         return { cls: "pill-neutral",  Icon: Minus };
  }
};

const readinessMeta = (r: Readiness) => {
  switch (r) {
    case "NOW":   return { label: "NOW",   cls: "bg-bullish/15 text-bullish border-bullish/40" };
    case "WAIT":  return { label: "WAIT",  cls: "bg-warning/15 text-warning border-warning/40" };
    case "AVOID": return { label: "AVOID", cls: "bg-bearish/15 text-bearish border-bearish/40" };
  }
};

const scoreColor = (n: number) =>
  n >= 70 ? "text-bullish" : n >= 45 ? "text-foreground" : "text-bearish";

// ── Metric color rules (red = bad, green = good, white = neutral) ─────────────
// Uniform 3-tier coloring for the scanner table so the user can scan a row and
// instantly read "good/neutral/bad" per metric without parsing numbers.
const ivrColor = (n: number) =>
  n < 30 ? "text-bullish" : n > 60 ? "text-bearish" : "text-foreground";
const rsiColor = (n: number) =>
  n < 30 || n > 70 ? "text-bearish" : n >= 45 && n <= 60 ? "text-bullish" : "text-foreground";
const atrColor = (n: number) =>
  n < 2 ? "text-bullish" : n > 4 ? "text-bearish" : "text-foreground";
const liqColor = (n: number) =>
  n >= 60 ? "text-bullish" : n < 30 ? "text-bearish" : "text-foreground";

function ScoreBar({ label, value, Icon }: { label: string; value: number; Icon: any }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </span>
        <span className={cn("mono font-semibold", scoreColor(value))}>{value}</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

export default function Scanner() {
  const [view, setView] = useState<View>("table");
  const isMobile = useIsMobile();
  // On phones the wide table forces horizontal scroll; render stacked cards instead.
  const effectiveView: View = isMobile ? "cards" : view;
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [maxLossBudget] = useBudget();
  const { profile: strategyProfile } = useStrategyProfile();
  const { overrides } = useScannerOverrides();
  const preMarket = usePreMarketStatus();
  const [strategyDrawerOpen, setStrategyDrawerOpen] = useState(false);
  const scanCacheRef = useRef(new ScanCache<SetupRow>());
  const [activeBucket, setActiveBucket] = useActiveBucket();

  // Deep-link from Dashboard's Top Opportunities — auto-scroll + flash highlight.
  const [searchParams] = useSearchParams();
  const highlightKey = useMemo(() => {
    const symbol = searchParams.get("symbol");
    const strike = searchParams.get("strike");
    const expiry = searchParams.get("expiry");
    if (!symbol || searchParams.get("highlight") !== "true") return null;
    return { symbol: symbol.toUpperCase(), strike, expiry };
  }, [searchParams]);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightKey) return;
    const id = `pick-${highlightKey.symbol}`;
    // Wait for next paint so the card exists before scrolling.
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashKey(highlightKey.symbol);
        setTimeout(() => setFlashKey(null), 2000);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [highlightKey]);

  const universe = useMemo(() => TICKER_UNIVERSE.map((t) => t.symbol), []);
  // Session-aware refetch cadence — quote freshness expectations differ by session.
  const sessionMode = getSessionMode();
  const SESSION_REFRESH_MS: Record<SessionMode, number> = {
    MARKET_OPEN: 10_000,
    PRE_MARKET:  30_000,
    AFTER_HOURS: 60_000,
    CLOSED:      0,
  };
  const refetchMs = SESSION_REFRESH_MS[sessionMode] || 60_000;
  const { data: quotes = [], isLoading, isFetching, refetch, dataUpdatedAt } = useLiveQuotes(universe, {
    refetchMs,
  });

  // 200-day SMA gate — pulled once per session, cached 24h. Also feeds real
  // EMA20/EMA50 distances + streak math into computeSetups via closesBySymbol.
  const sma = useSma200(universe);

  const closesBySymbol = useMemo(() => {
    const m = new Map<string, number[]>();
    sma.map.forEach((v, k) => {
      if (Array.isArray(v.closes) && v.closes.length > 0) m.set(k, v.closes);
    });
    return m;
  }, [sma.map]);

  // Real next-earnings-in-days from fundamentals-fetch (Finnhub calendar).
  // Drives the catalyst score, risk-adjusted penalty, and earnings warnings.
  const earnings = useEarnings(universe);
  const earningsBySymbol = earnings.map;

  // Compute setups, then attach the institutional rank (Setup × .40 +
  // Readiness × .30 + Options × .30 − Penalties). Default sort: Final Rank desc.
  const rows: SetupRow[] = useMemo(
    () => computeSetups(quotes, { closesBySymbol, earningsBySymbol }),
    [quotes, closesBySymbol, earningsBySymbol],
  );

  // Per-symbol Strategy + Rank. Stable map keyed by symbol so DetailPanel /
  // SetupCard can re-use the exact same decision the rank was computed against.
  const rankMap = useMemo(() => {
    const m = new Map<string, { decision: StrategyDecision; rank: RankResult }>();
    for (const r of rows) {
      const decision = selectStrategy({
        symbol: r.symbol, bias: r.bias, price: r.price, changePct: r.changePct,
        ivRank: r.ivRank, atrPct: r.atrPct, rsi: r.rsi,
        optionsLiquidity: r.optionsLiquidity, earningsInDays: r.earningsInDays,
        setupScore: r.setupScore,
        maxLossBudget,
      });
      m.set(r.symbol, { decision, rank: rankSetup(r, decision) });
    }
    return m;
  }, [rows, maxLossBudget]);

  // Persist today's snapshot for the Performance dashboard (throttled to 1×/h).
  const snapshotInputs = useMemo(
    () => rows
      .map((r) => {
        const entry = rankMap.get(r.symbol);
        return entry ? { setup: r, rank: entry.rank } : null;
      })
      .filter((v): v is { setup: SetupRow; rank: RankResult } => v !== null),
    [rows, rankMap],
  );
  useSnapshotUploader(snapshotInputs);

  // Sortable columns. Default = Final Rank desc (with Setup tiebreaker).
  type SortKey = "symbol" | "price" | "changePct" | "relVol" | "ivRank" | "rsi" | "atrPct" | "optionsLiquidity" | "setupScore" | "finalRank";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "finalRank", dir: "desc" });
  const toggleSort = (key: SortKey) =>
    setSort((s) => s.key === key ? { ...s, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "symbol" ? "asc" : "desc" });

  const sortedRows = useMemo(() => {
    const getVal = (r: SetupRow): number | string => {
      if (sort.key === "symbol") return r.symbol;
      if (sort.key === "finalRank") return rankMap.get(r.symbol)?.rank.finalRank ?? 0;
      return (r as any)[sort.key] ?? 0;
    };
    return [...rows].sort((a, b) => {
      const va = getVal(a), vb = getVal(b);
      let cmp = typeof va === "string" || typeof vb === "string"
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number);
      if (cmp === 0 && sort.key !== "setupScore") cmp = b.setupScore - a.setupScore;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, rankMap, sort]);

  // ── Pick Expiration Engine ────────────────────────────────────────────
  // Track first-seen price/time for every scanner row. Force WAIT when RSI > 75.
  // Hide rows that timed out without ever hitting GO.
  const expiryInputs = useMemo<PickInputs[]>(() => rows.map((r) => ({
    key: `scanner:${r.symbol}`,
    price: r.price,
    rsi: r.rsi,
    verdict: r.crl?.verdict ?? null,
    theta: null,             // scanner has no Greeks yet
    confidence: null,
  })), [rows]);
  const expiryStatus = usePickExpiration(expiryInputs);

  // (sma already declared above to feed both gates and computeSetups closes.)

  // EXIT signals only apply to symbols the user actually holds in their portfolio.
  // For everything else, an EXIT verdict is meaningless (you can't exit what you don't own),
  // so we surface it as NO ("don't enter") instead.
  const portfolioQ = usePortfolio();
  const ownedSymbols = useMemo(
    () => new Set((portfolioQ.data ?? []).filter((p) => p.status === "open").map((p) => p.symbol.toUpperCase())),
    [portfolioQ.data],
  );

  const [novaSpec] = useNovaFilter();

  // ── UNIFIED VERDICT MODEL (declared early so the filter below can use it) ──
  // Every row is funneled through computeVerdict() so the summary cards, the
  // Action column, and any other consumer all read from the same map. This
  // makes summary-vs-row mismatches impossible by construction.
  const verdictByRow = useMemo<Map<string, VerdictResult>>(() => {
    const m = new Map<string, VerdictResult>();
    for (const r of rows) {
      const rk = rankMap.get(r.symbol)?.rank;
      const exp = expiryStatus.get(`scanner:${r.symbol}`);
      const guard = evaluateGuards({
        symbol: r.symbol,
        livePrice: r.price,
        pickPrice: r.price,
        optionType: r.bias === "bearish" ? "put" : "call",
        direction: "long",
        strike: r.price,
        sma200: sma.map.get(r.symbol)?.sma200 ?? null,
        riskBucket: r.crl?.riskBadge?.toLowerCase() ?? null,
      });
      const baseVerdict = exp?.effectiveVerdict ?? r.crl?.verdict;
      const upstream =
        guard.shouldBlockSignal && rk?.label === "BUY NOW" ? "BLOCKED"
        : (baseVerdict === "EXIT" && ownedSymbols.has(r.symbol.toUpperCase())) ? "EXIT"
        : rk?.label ?? "WAIT";
      const v = computeVerdict({
        symbol: r.symbol,
        price: r.price,
        changePct: r.changePct,
        setupScore: r.setupScore,
        finalRank: rk?.finalRank ?? null,
        rsi: r.rsi,
        optionsLiquidity: r.optionsLiquidity,
        earningsInDays: r.earningsInDays,
        rawBias: r.bias,
        optionType: r.bias === "bearish" ? "put" : "call",
        strike: Math.max(1, Math.round(r.price / (r.price >= 100 ? 5 : 1)) * (r.price >= 100 ? 5 : 1)),
        budget: maxLossBudget,
        riskBucket: r.crl?.riskBadge?.toLowerCase() ?? null,
        isHardBlocked: guard.shouldBlockSignal,
        isStale: exp?.isStale ?? false,
        isTimedOut: exp?.isTimedOut ?? false,
        upstreamLabel: upstream,
        isReady: rk?.label === "BUY NOW" && !guard.shouldBlockSignal,
      });
      m.set(r.symbol, v);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rankMap, expiryStatus, sma, ownedSymbols, maxLossBudget]);

  /** Legacy unified label — kept for the existing filter shape; derives from
   *  the new verdict model so the Scanner can never disagree with itself. */
  type RowLabel = ActionLabel | "BLOCKED";
  const labelFor = (r: SetupRow): RowLabel => {
    const v = verdictByRow.get(r.symbol)?.verdict;
    if (v === "Buy Now") return "BUY NOW";
    if (v === "Watchlist") return "WATCHLIST";
    if (v === "Wait") return "WAIT";
    return "AVOID";
  };


  const filtered = useMemo(() => {
    return sortedRows.filter((r) => {
      const exp = expiryStatus.get(`scanner:${r.symbol}`);
      if (exp?.isTimedOut) return false;          // remove old setups
      if (filters.search && !r.symbol.includes(filters.search.toUpperCase()) && !r.name.toUpperCase().includes(filters.search.toUpperCase())) return false;
      if (filters.sector !== "all" && r.sector !== filters.sector) return false;
      if (filters.bias !== "all" && r.bias !== filters.bias) return false;
      // Readiness filter uses the UNIFIED action label (same one shown in the
      // Action column) so "NOW" only returns rows whose final verdict is BUY NOW.
      // Previously this checked the raw scout readiness which could disagree
      // with the final rank — leading to "NOW filter shows WAIT rows".
      if (filters.readiness !== "all") {
        const unified = labelFor(r);
        const matches =
          (filters.readiness === "NOW"   && unified === "BUY NOW") ||
          (filters.readiness === "WAIT"  && (unified === "WAIT" || unified === "WAIT PULLBACK" || unified === "WATCHLIST" || unified === "WATCHLIST ONLY" || unified === "EXPENSIVE ENTRY" || unified === "OVEREXTENDED")) ||
          (filters.readiness === "AVOID" && (unified === "AVOID" || unified === "BLOCKED"));
        if (!matches) return false;
      }
      if (filters.hideAvoid) {
        const unified = labelFor(r);
        if (unified === "AVOID" || unified === "BLOCKED") return false;
      }
      if (r.setupScore < filters.minScore[0]) return false;
      if (r.relVolume < filters.minRelVol[0]) return false;
      if (r.ivRank < filters.ivrRange[0] || r.ivRank > filters.ivrRange[1]) return false;
      if (r.rsi < filters.rsiRange[0] || r.rsi > filters.rsiRange[1]) return false;
      if (r.changePct < filters.changeRange[0] || r.changePct > filters.changeRange[1]) return false;
      if (r.optionsLiquidity < filters.minOptionsLiq[0]) return false;
      if (filters.excludeEarnings && r.earningsInDays != null && r.earningsInDays <= 7) return false;

      // NOVA natural-language filter — applied on top of UI filters.
      const optionType: "call" | "put" = r.bias === "bearish" ? "put" : "call";
      const ok = pickMatchesFilter({
        symbol: r.symbol,
        bias: r.bias === "neutral" || r.bias === "reversal" ? "neutral" : r.bias,
        optionType,
        score: r.setupScore,
        earningsInDays: r.earningsInDays ?? null,
      }, novaSpec);
      if (!ok) return false;

      return true;
    });
  }, [sortedRows, filters, expiryStatus, novaSpec]);

  // Fire webhook for any NEW scanner row whose CRL verdict is GO.
  // Dedupe key includes the date so the same GO re-fires once per trading day.
  const [settings] = useSettings();
  useEffect(() => {
    // Use effectiveVerdict so RSI-flipped rows don't fire false GO alerts.
    // Also drop rows whose NOVA Guards block the signal (200-SMA gate, etc.).
    const goRows = rows.filter((r) => {
      const exp = expiryStatus.get(`scanner:${r.symbol}`);
      const v = exp?.effectiveVerdict ?? r.crl?.verdict;
      const g = evaluateGuards({
        symbol: r.symbol,
        livePrice: r.price,
        pickPrice: r.price,
        optionType: r.bias === "bearish" ? "put" : "call",
        direction: "long",
        strike: r.price,
        sma200: sma.map.get(r.symbol)?.sma200 ?? null,
      });
      return v === "GO" && !exp?.isStale && !exp?.isTimedOut && !g.shouldBlockSignal;
    });
    if (goRows.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    dispatchPickAlerts({
      settings,
      picks: goRows.map((r) => ({
        key: `scanner:${today}:${r.symbol}`,
        symbol: r.symbol,
        source: "scanner",
        reason: r.crl?.reason ?? `Setup score ${r.setupScore} · ${r.bias}`,
        risk: r.crl?.riskBadge,
      })),
    });
  }, [rows, settings, expiryStatus, sma]);

  // (labelFor + RowLabel are declared earlier so the filter useMemo can use them.)


  // Summary counts MIRROR the filtered/visible dataset so the cards at the top
  // can never disagree with the rows below them. Filter active? Counts shrink.
  const counts = useMemo(() => {
    const tally: Record<Verdict, number> = { "Buy Now": 0, Watchlist: 0, Wait: 0, Avoid: 0 };
    for (const r of filtered) {
      const v = verdictByRow.get(r.symbol)?.verdict ?? "Wait";
      tally[v]++;
    }
    return tally;
  }, [filtered, verdictByRow]);

  const marketOpen = isMarketOpen();
  const weekend = isWeekend();

  const freshness = dataUpdatedAt
    ? `${Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000))}s ago`
    : "—";

  const marketState = getMarketState();
  const orbStatus = getOrbStatus();
  const cpScan = useScannerPicks({ bucket: activeBucket });
  const overBudgetPicks = cpScan.overBudgetWatchlist ?? [];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-3 sm:p-6 md:p-8 max-w-[1700px] mx-auto space-y-4 sm:space-y-6">
        {/* ORB status banner — Mon/Wed/Fri only */}
        {orbStatus.isOrbDay && (
          <div className={cn(
            "w-full px-4 py-2 rounded text-sm font-medium",
            orbStatus.inRangeWindow && "border border-primary/40 bg-primary/10 text-primary",
            orbStatus.inEntryWindow && "border border-bullish/50 bg-bullish/10 text-bullish",
            orbStatus.windowExpired && "border border-border bg-muted/40 text-muted-foreground",
          )}>
            {orbStatus.inRangeWindow && "⏱ ORB RECORDING — 9:30–9:35 ET opening range forming. Breakout trade available at 9:35."}
            {orbStatus.inEntryWindow && "🟢 ORB WINDOW OPEN — Entry valid until 10:30 AM ET. ATM calls or puts only. Exit at +100% or -50%."}
            {orbStatus.windowExpired && "ORB window closed for today (expired 10:30 AM ET)."}
          </div>
        )}
        {/* Market session banner — explains why scoring may be on EOD data. */}
        {marketState === "PRE_MARKET" && (
          <div className="w-full px-4 py-2 rounded border border-warning/40 bg-warning/10 text-warning text-sm flex items-center justify-between gap-3">
            <span>🌅 Pre-Market — ORB Lock active until 9:30 AM ET open.</span>
            <Badge variant="outline" className="text-warning border-warning/40 text-xs shrink-0">Pre-Market</Badge>
          </div>
        )}
        {marketState === "AFTER_HOURS" && (
          <div className="w-full px-4 py-2 rounded border border-primary/40 bg-primary/10 text-primary text-sm flex items-center justify-between gap-3">
            <span>📊 After Hours — showing picks based on last closing prices. Scores reflect EOD data.</span>
            <Badge variant="outline" className="text-primary border-primary/40 text-xs shrink-0">After Hours</Badge>
          </div>
        )}
        {marketState === "CLOSED" && (
          <div className="w-full px-4 py-2 rounded border border-border bg-muted/40 text-muted-foreground text-sm flex items-center justify-between gap-3">
            <span>🌙 Market closed — picks are based on last session's closing data. Signals refresh at next open.</span>
            <Badge variant="outline" className="text-muted-foreground border-border text-xs shrink-0">Market Closed</Badge>
          </div>
        )}
        {/* NovaWhisper session-aware refresh chip */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="pill pill-neutral">
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            {refetchMs > 0 ? `Auto-refresh ${Math.round(refetchMs / 1000)}s` : "Auto-refresh paused"}
          </span>
          <span>· Session: {sessionMode.replace("_", " ").toLowerCase()}</span>
          {sessionMode !== "MARKET_OPEN" && (
            <span>· Buy-Now signals only during regular session</span>
          )}
        </div>
        <PreMarketPreviewBanner />
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Market Scanner</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Disciplined setup scoring across {rows.length} symbols · NO TRADE is a valid outcome.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="pill pill-live"><span className="live-dot" /> Live · {freshness}</span>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList className="bg-surface/60 h-9">
                <TabsTrigger value="table" className="h-7"><Table2 className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Table</span></TabsTrigger>
                <TabsTrigger value="cards" className="h-7"><LayoutGrid className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Cards</span></TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>



        {/* Weekend / closed-market banner — kills false "Buy Now" expectations. */}
        {!marketOpen && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-warning" />
            <span className="text-foreground/90">
              {weekend ? "Markets are closed for the weekend." : "Market is closed."} Live entry timing
              resumes at the next open — verdicts default to <span className="font-semibold">Wait for Open</span>.
            </span>
          </div>
        )}

        {/* Unified verdict summary — counts mirror the FILTERED rows below. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { k: "Buy Now",   v: counts["Buy Now"],  sub: "Take the trade now",                cls: "border-bullish/60 text-bullish",     Icon: Zap },
            { k: "Watchlist", v: counts.Watchlist,   sub: "Setup close · wait for trigger",    cls: "border-primary/40 text-primary",     Icon: Clock },
            { k: "Wait",      v: counts.Wait,        sub: "Mixed signals · monitor",           cls: "border-warning/40 text-warning",     Icon: ShieldAlert },
            { k: "Avoid",     v: counts.Avoid,       sub: "Hard blocker · no edge",            cls: "border-bearish/40 text-bearish",     Icon: AlertTriangle },
          ] as const).map((c) => (
            <Card key={c.k} className={cn("glass-card p-2.5 sm:p-4 border", c.cls)}>
              <div className="flex items-center justify-between">
                <div className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">{c.k}</div>
                <c.Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 opacity-70" />
              </div>
              <div className="mono text-2xl sm:text-3xl font-semibold mt-1">{c.v}</div>
              <div className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 line-clamp-1 sm:line-clamp-none">{c.sub}</div>
            </Card>
          ))}
        </div>

        {/* 🌙 Tomorrow's Game Plan — only renders when market is not OPEN. */}
        <TomorrowsGamePlan />

        {/* ──── Strategy Context Bar + bucketed picks (approved/budget/safety) ──── */}
        {(() => {
          const profileCap = maxPerTradeDollars(strategyProfile);
          // Honor the user's Settings/Nova budget slider as a hard ceiling.
          const derivedCap = Math.min(profileCap, maxLossBudget > 0 ? maxLossBudget : profileCap);
          const cap = overrides.perTradeCapOverride > 0 ? overrides.perTradeCapOverride : derivedCap;
          const approvedRows: SetupRow[] = [];
          const budgetBlocked: BlockedPickInfo[] = [];
          const safetyBlocked: BlockedPickInfo[] = [];
          let profileFilteredCount = 0;
          let universeFilteredCount = 0;
          for (const r of filtered) {
            // Conservative-Cheap universe override — restrict to sub-$50 names.
            if (overrides.conservativeCheapOnly && !isConservativeCheapTicker(r.symbol)) {
              universeFilteredCount++;
              continue;
            }
            const v = verdictByRow.get(r.symbol);
            const optionType: "call" | "put" = r.bias === "bearish" ? "put" : "call";
            const c = deriveContractFromRow(r);
            const expDate = new Date(c.expiry + "T00:00:00");
            const dte = isNaN(expDate.getTime()) ? 30 : Math.max(0, Math.round((expDate.getTime() - Date.now()) / 86400000));
            if (!isStructureAllowed(strategyProfile, optionType, dte)) {
              profileFilteredCount++;
              continue;
            }

            // ── Strike Ladder ──────────────────────────────────────────────
            // Generate Deep ITM / ITM / ATM (+OTM lottery) and pick the
            // highest-quality rung that fits the cap. Solves the "F $13C
            // costs $1,280 → all blocked" bug.
            const ladder = buildStrikeLadder({
              spot: r.price, ivRank: r.ivRank, optionType, expiry: c.expiry, dte,
              includeOTM: false,
            });
            const pick = pickBestRung(ladder, cap);
            if (!pick) continue;
            const chosenStrike = pick.candidate.strike;
            const estCost = pick.candidate.contractCost;

            const verdict = v?.verdict;
            const isSafetyBlocked = verdict === "Avoid" || (v?.reason ?? "").toLowerCase().includes("block");

            if (isSafetyBlocked) {
              safetyBlocked.push({
                row: r, kind: "safety",
                reason: v?.reason || "Safety gate failure",
                detail: v?.reason || "One or more safety gates flagged this pick.",
                contract: { optionType, strike: chosenStrike, expiry: c.expiry },
              });
              continue;
            }
            if (!pick.fitsCap && !overrides.showBudgetBlocked) {
              const cheapest = pick.cheapest;
              const overBy = cheapest.contractCost - cap;
              budgetBlocked.push({
                row: r, kind: "budget",
                reason: `Over per-trade cap by $${overBy.toLocaleString()}`,
                detail:
                  `Cap $${cap.toLocaleString()}. Cheapest rung is ${cheapest.rung} ` +
                  `${cheapest.optionType} $${cheapest.strike} @ ~$${cheapest.premium.toFixed(2)} ` +
                  `= $${cheapest.contractCost.toLocaleString()}/contract.`,
                overBudgetBy: overBy, cap, cost: cheapest.contractCost,
                contract: { optionType, strike: cheapest.strike, expiry: c.expiry },
              });
              continue;
            }
            // Mutate the row's working copy with the ladder-chosen strike so
            // SetupCard renders the ITM strike (not the legacy ATM derive).
            (r as SetupRow & { _chosenStrike?: number; _chosenPremium?: number; _chosenRung?: string })._chosenStrike = chosenStrike;
            (r as SetupRow & { _chosenStrike?: number; _chosenPremium?: number; _chosenRung?: string })._chosenPremium = pick.candidate.premium;
            (r as SetupRow & { _chosenStrike?: number; _chosenPremium?: number; _chosenRung?: string })._chosenRung = pick.candidate.rung;
            approvedRows.push(r);
            void estCost;
          }

          const candidates = approvedRows.map((r) => ({
            symbol: r.symbol,
            optionType: (r.bias === "bearish" ? "put" : "call") as "call" | "put",
            strike: deriveContractFromRow(r).strike,
            expiry: deriveContractFromRow(r).expiry,
            payload: r,
            score: rankMap.get(r.symbol)?.rank.finalRank ?? r.setupScore,
            passing: true,
          }));
          const stable = scanCacheRef.current.reconcile(candidates, { maxDisplay: 12 });

          const filterChipParts: string[] = [];
          if (profileFilteredCount > 0) filterChipParts.push(`excluded ${profileFilteredCount} pick${profileFilteredCount === 1 ? "" : "s"} (structure not allowed)`);
          if (universeFilteredCount > 0) filterChipParts.push(`excluded ${universeFilteredCount} non-cheap-universe ticker${universeFilteredCount === 1 ? "" : "s"}`);

          const pipelineCounts: PipelineCounts = {
            universe: rows.length,
            gatePassing: approvedRows.length + budgetBlocked.length,
            gateBlocked: safetyBlocked.length,
            budgetBlocked: budgetBlocked.length,
            shown: stable.length,
            filterChip: filterChipParts.length > 0 ? filterChipParts.join(" · ") : null,
          };

          const preMarketPicks = isPreMarketWindow() ? generatePreMarketPicks(rows) : [];
          const safetyDefaultOpen = preMarket.isPreMarket;
          const showLoosen = approvedRows.length === 0 && (safetyBlocked.length > 0 || budgetBlocked.length > 0);

          // Spec section 2: Conservative profile + small cap + only budget blocks → mismatch.
          const showBudgetMismatch =
            approvedRows.length === 0 &&
            budgetBlocked.length > 0 &&
            safetyBlocked.length === 0 &&
            strategyProfile.riskTolerance === "Conservative";

          // Diagnostic: cheapest budget-blocked alternative (sorted by cost asc).
          const cheapestBlocked = budgetBlocked.length > 0
            ? [...budgetBlocked].sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))[0]
            : null;

          return (
            <div className="space-y-3">
              <StrategyContextBar counts={pipelineCounts} onEdit={() => setStrategyDrawerOpen(true)} />

              {/* Pre-market estimate banner — every premium below is theoretical until 9:30 AM ET. */}
              {preMarket.isPreMarket && approvedRows.length > 0 && (
                <Card className="glass-card p-3 border-warning/40 bg-warning/5 flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div className="text-[12px]">
                    <div className="font-semibold text-warning">Pre-market estimate</div>
                    <div className="text-muted-foreground mt-0.5">
                      Options markets open at 9:30 AM ET. Premiums shown are theoretical — real fills may differ ±10–30%.
                      Use <span className="font-semibold text-foreground">Queue for Open</span> to re-validate at 9:35 AM.
                    </div>
                  </div>
                </Card>
              )}

              {showBudgetMismatch && (
                <BudgetMismatchCard cap={cap} budgetBlockedCount={budgetBlocked.length} />
              )}

              {/* Diagnostic: 0 approved + budget-blocked exist → suggest cheapest alternative. */}
              {approvedRows.length === 0 && cheapestBlocked && (
                <Card className="glass-card p-3 border-primary/40 bg-primary/5 flex items-start gap-2.5">
                  <Search className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="text-[12px] flex-1">
                    <div className="font-semibold text-foreground">
                      🔎 Every gate-passing pick is over your ${cap.toLocaleString()} cap.
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      Cheapest option:{" "}
                      <span className="mono font-semibold text-foreground">
                        {cheapestBlocked.row.symbol} ${cheapestBlocked.contract.strike}
                        {cheapestBlocked.contract.optionType === "call" ? "C" : "P"}
                      </span>{" "}
                      at ~<span className="mono font-semibold text-foreground">
                        ${cheapestBlocked.cost?.toLocaleString()}
                      </span>{" "}
                      total.{" "}
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2 text-primary"
                        onClick={() => setOpenSymbol(cheapestBlocked.row.symbol)}
                      >
                        Open to approve →
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              {showLoosen && !showBudgetMismatch && (
                <LoosenToSeePicks
                  budgetBlockedCount={budgetBlocked.length}
                  orbBlockedCount={preMarket.isPreMarket ? safetyBlocked.length : 0}
                  ivBlockedCount={safetyBlocked.filter((b) => /iv/i.test(b.reason)).length}
                />
              )}

              {preMarketPicks.length > 0 && (
                <CollapsibleBlockedSection
                  title="Pre-market opportunities"
                  count={preMarketPicks.length}
                  subtitle="LEAP · Deep-ITM · Gap plays — plan now, act at the open"
                  tone="approved"
                  defaultOpen
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {preMarketPicks.map((p) => (
                      <PreMarketPickCard key={`${p.symbol}|${p.kind}`} pick={p} onOpen={() => setOpenSymbol(p.symbol)} />
                    ))}
                  </div>
                </CollapsibleBlockedSection>
              )}

              {/* ── 4-Score Bucket Layout (BUY NOW / WATCHLIST / NEEDS RECHECK / AVOID) ── */}
              {/* Replaces the legacy "Approved" SetupCard grid. Driven by useScannerPicks
                  + finalClassifier — every card shows 4 score bars, classification badge,
                  contract grid, plain-English reason, upgrade path, live price check. */}
              <ScannerBucketsSection onOpen={setOpenSymbol} flashKey={flashKey} />

              {budgetBlocked.length > 0 && (
                <CollapsibleBlockedSection
                  title={`Budget blocked — over $${cap.toLocaleString()}/trade cap`}
                  count={budgetBlocked.length}
                  subtitle="Raise cap, scan cheaper tickers, or pick a smaller strike"
                  tone="budget"
                  defaultOpen={approvedRows.length === 0}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {budgetBlocked.map((info) => (
                      <BlockedPickCard
                        key={`b:${info.row.symbol}:${info.contract.strike}:${info.contract.expiry}`}
                        info={info}
                        onOpen={() => setOpenSymbol(info.row.symbol)}
                        onRaiseCap={() => setStrategyDrawerOpen(true)}
                        onSuggestCheaper={() => setOpenSymbol(info.row.symbol)}
                      />
                    ))}
                  </div>
                </CollapsibleBlockedSection>
              )}

              {safetyBlocked.length > 0 && (
                <CollapsibleBlockedSection
                  title="Safety blocked — gate failure"
                  count={safetyBlocked.length}
                  subtitle="Stale data · wide spread · IV trap · exhaustion"
                  tone="safety"
                  defaultOpen={safetyDefaultOpen}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {safetyBlocked.map((info) => (
                      <BlockedPickCard
                        key={`s:${info.row.symbol}:${info.contract.strike}:${info.contract.expiry}`}
                        info={info}
                        onOpen={() => setOpenSymbol(info.row.symbol)}
                      />
                    ))}
                  </div>
                </CollapsibleBlockedSection>
              )}
            </div>
          );
        })()}


        <StrategyEditDrawer open={strategyDrawerOpen} onOpenChange={setStrategyDrawerOpen} />

        <WatchlistPanel onOpenSymbol={setOpenSymbol} />

        <ScannerToolbar
          filters={filters}
          defaults={DEFAULT_FILTERS}
          onChange={setFilters}
          sectors={SECTORS as string[]}
          matchCount={filtered.length}
          totalCount={rows.length}
        />

        {/* Loading / Empty */}
        {isLoading && (
          <Card className="glass-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Scanning universe…
          </Card>
        )}
        {!isLoading && filtered.length === 0 && (
          <Card className="glass-card p-10 text-center space-y-2">
            <div className="text-sm font-medium">No setups match your filters.</div>
            <div className="text-xs text-muted-foreground">That's a valid outcome — loosen criteria or wait for a cleaner tape.</div>
            <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)} className="mt-2">Reset filters</Button>
          </Card>
        )}

        {/* Table view */}
        {!isLoading && effectiveView === "table" && filtered.length > 0 && (
          <Card className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-card text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0 z-30 shadow-[0_2px_4px_-2px_hsl(var(--background))] border-b border-border">
                  <tr>
                    {([
                      { k: "Ticker", sk: "symbol" as SortKey },
                      { k: "Last", sk: "price" as SortKey },
                      { k: "% Chg", sk: "changePct" as SortKey },
                      { k: "Rel Vol", sk: "relVol" as SortKey, tip: "Volume vs estimated avg" },
                      { k: "Trend" },
                      { k: "IVR", sk: "ivRank" as SortKey, tip: "IV Rank — green <30 (cheap premium), red >60 (rich premium)" },
                      { k: "RSI", sk: "rsi" as SortKey, tip: "Estimated — green 45–60 (healthy), red <30 or >70 (over-extended)" },
                      { k: "ATR%", sk: "atrPct" as SortKey, tip: "Estimated — green <2% (calm), red >4% (volatile)" },
                      { k: "Opt Liq", sk: "optionsLiquidity" as SortKey, tip: "Options liquidity proxy — green ≥60, red <30" },
                      { k: "Setup", sk: "setupScore" as SortKey, tip: "Weighted final score 0–100 — green ≥70, red <45" },
                      { k: "Action", sk: "finalRank" as SortKey, tip: "Unified verdict — BUY NOW / WATCHLIST / WAIT / AVOID / EXIT / BLOCKED. Combines Setup × Readiness × Options × Penalties × Guards into one call. Number = Final Rank 0–100." },
                      { k: "" },
                    ] as { k: string; sk?: SortKey; tip?: string }[]).map((h) => {
                      const active = h.sk && sort.key === h.sk;
                      const SortIcon = !h.sk ? null : active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                      // NOTE: TooltipTrigger renders a <button> by default. When the
                      // header is sortable we already wrap it in a <button>, and nested
                      // buttons silently break the outer onClick (sorting). Use asChild
                      // with a <span> so only one interactive element exists.
                      const inner = h.tip ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">{h.k}</span>
                          </TooltipTrigger>
                          <TooltipContent>{h.tip}</TooltipContent>
                        </Tooltip>
                      ) : h.k;
                      return (
                        <th key={h.k} className="text-left px-3 py-2.5 font-medium whitespace-nowrap bg-card">
                          {h.sk ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(h.sk!)}
                              className={cn(
                                "inline-flex items-center gap-1 hover:text-foreground transition-colors",
                                active && "text-foreground",
                              )}
                            >
                              {inner}
                              {SortIcon && <SortIcon className={cn("h-3 w-3", !active && "opacity-40")} />}
                            </button>
                          ) : inner}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const { cls: bcls, Icon: BIcon } = biasMeta(r.bias);
                    const isOpen = expanded === r.symbol;
                    const exp = expiryStatus.get(`scanner:${r.symbol}`);
                    // NOVA Guards — used for row tint + the guard chips inside the Action cell.
                    const guard = evaluateGuards({
                      symbol: r.symbol,
                      livePrice: r.price,
                      pickPrice: r.price,
                      optionType: r.bias === "bearish" ? "put" : "call",
                      direction: "long",
                      strike: r.price,
                      sma200: sma.map.get(r.symbol)?.sma200 ?? null,
                      riskBucket: r.crl.riskBadge?.toLowerCase() ?? null,
                    });
                    const blocked = guard.shouldBlockSignal;
                    return (
                      <Fragment key={r.symbol}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : r.symbol)}
                          className={cn(
                            "border-t border-border/60 hover:bg-surface/40 cursor-pointer transition-colors",
                            isOpen && "bg-surface/40",
                            r.readiness === "AVOID" && "opacity-70",
                            blocked && "bg-bearish/5",
                          )}
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-mono font-semibold">{r.symbol}</div>
                                <div className="text-[10px] text-muted-foreground truncate max-w-[140px]">{r.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 mono">${r.price.toFixed(2)}</td>
                          <td className={cn("px-3 py-3 mono", r.changePct >= 0 ? "text-bullish" : "text-bearish")}>
                            {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                          </td>
                          <td className="px-3 py-3 mono">{r.relVolume.toFixed(2)}×</td>
                          <td className="px-3 py-3">
                            <span className={`pill ${bcls} capitalize gap-1`}>
                              <BIcon className="h-3 w-3" />{r.bias}
                            </span>
                          </td>
                          <td className="px-3 py-3 mono"><EstNum n={r.ivRank} est={r.ivRankEst} className={ivrColor(r.ivRank)} /></td>
                          <td className="px-3 py-3 mono"><EstNum n={r.rsi} est={r.rsiEst} className={rsiColor(r.rsi)} /></td>
                          <td className="px-3 py-3 mono"><EstNum n={r.atrPct} est={r.atrPctEst} suffix="%" className={atrColor(r.atrPct)} /></td>
                          <td className={cn("px-3 py-3 mono font-semibold", liqColor(r.optionsLiquidity))}>{r.optionsLiquidity}</td>
                          <td className="px-3 py-3">
                            <div className={cn("mono font-semibold text-base", scoreColor(r.setupScore))}>{r.setupScore}</div>
                          </td>
                          <td className="px-3 py-3">
                            {(() => {
                              const rk = rankMap.get(r.symbol)?.rank;
                              const vr = verdictByRow.get(r.symbol);
                              if (!vr) return <span className="text-[11px] text-muted-foreground">…</span>;
                              return (
                                <div className="flex flex-col gap-1">
                                  <VerdictBadge verdict={vr.verdict} reason={vr.reason} />
                                  <span className={cn("text-[10px]", vr.timing === "Ready" ? "text-bullish" : vr.timing === "Too Late" ? "text-bearish" : "text-muted-foreground")}>
                                    {vr.timing}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">Risk: <span className="text-foreground font-semibold">{vr.risk}</span></span>
                                  {rk && (
                                    <span className={cn("mono text-xs font-semibold", scoreColor(rk.finalRank))}>Rank {rk.finalRank}</span>
                                  )}
                                  <NovaGuardBadges guard={guard} compact />
                                  <PickExpiryChips status={exp} compact />
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const c = deriveContractFromRow(r);
                                const isCall = c.optionType === "call";
                                const expDate = new Date(c.expiry + "T00:00:00");
                                const expShort = isNaN(expDate.getTime())
                                  ? c.expiry
                                  : expDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                const dte = isNaN(expDate.getTime())
                                  ? null
                                  : Math.max(0, Math.round((expDate.getTime() - Date.now()) / 86400000));
                                return (
                                  <Hint label={`BUY ${r.symbol} $${c.strike} ${isCall ? "CALL" : "PUT"} · expires ${c.expiry}${dte != null ? ` (${dte} DTE)` : ""}`}>
                                    <div className="flex flex-col items-start gap-0.5 cursor-help">
                                      <span
                                        className={cn(
                                          "mono text-sm font-bold px-2.5 py-1 rounded-md border-2 whitespace-nowrap shadow-sm",
                                          isCall
                                            ? "text-bullish border-bullish/60 bg-bullish/10"
                                            : "text-bearish border-bearish/60 bg-bearish/10",
                                        )}
                                      >
                                        ${c.strike}{isCall ? "C" : "P"}
                                      </span>
                                      <span className="mono text-[10px] text-muted-foreground whitespace-nowrap">
                                        exp {expShort}{dte != null && ` · ${dte}d`}
                                      </span>
                                    </div>
                                  </Hint>
                                );
                              })()}
                              <SaveToWatchlistButton
                                size="xs"
                                symbol={r.symbol}
                                direction={deriveContractFromRow(r).direction}
                                optionType={deriveContractFromRow(r).optionType}
                                strike={deriveContractFromRow(r).strike}
                                expiry={deriveContractFromRow(r).expiry}
                                bias={r.bias}
                                tier={r.readiness}
                                entryPrice={r.price}
                                thesis={r.warnings[0] ?? r.trendLabel}
                                source="scanner"
                                meta={{ setupScore: r.setupScore }}
                              />
                              <AddToPortfolioButton
                                size="xs"
                                spec={{
                                  symbol: r.symbol,
                                  optionType: deriveContractFromRow(r).optionType as "call" | "put",
                                  strike: deriveContractFromRow(r).strike,
                                  expiry: deriveContractFromRow(r).expiry,
                                  spot: r.price,
                                  ivRank: r.ivRank,
                                  bucket: rowBucket({ riskBadge: r.crl?.riskBadge, earningsInDays: r.earningsInDays, ivRank: r.ivRank }),
                                  initialScore: r.setupScore,
                                  thesis: r.warnings[0] ?? r.trendLabel,
                                  source: "scanner",
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7"
                                onClick={(e) => { e.stopPropagation(); setOpenSymbol(r.symbol); }}
                              >
                                Open
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t border-border/30 bg-surface/20">
                            <td colSpan={13} className="px-4 py-4">
                              <DetailPanel
                                row={r}
                                decision={rankMap.get(r.symbol)?.decision ?? null}
                                rank={rankMap.get(r.symbol)?.rank ?? null}
                                onOpen={() => setOpenSymbol(r.symbol)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Card view */}
        {!isLoading && effectiveView === "cards" && filtered.length > 0 && (
          isMobile ? (
            // Mobile: virtualized stack of compact cards. Only renders the ~5
            // rows currently visible — the full list of 50+ tickers never
            // mounts at once. Each card is React.memo'd so a single price
            // tick re-renders only that card.
            <MobileScannerList
              rows={filtered}
              verdictByRow={verdictByRow}
              buildContract={(r) => {
                const c = deriveContractFromRow(r);
                return {
                  symbol: c.symbol,
                  optionType: c.optionType as "call" | "put",
                  direction: c.direction,
                  strike: c.strike,
                  expiry: c.expiry,
                };
              }}
              onOpen={(s) => setOpenSymbol(s)}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((r) => (
                <SetupCard
                  key={r.symbol}
                  row={r}
                  rank={rankMap.get(r.symbol)?.rank ?? null}
                  closes={sma.map.get(r.symbol)?.closes ?? null}
                  onOpen={() => setOpenSymbol(r.symbol)}
                />
              ))}
            </div>
          )
        )}

        {/* 💰 Strong Setups — Over Budget */}
        {overBudgetPicks.length > 0 && (
          <Card className="glass-card p-4 border-orange-600/40 bg-orange-600/5 space-y-3">
            <div>
              <h3 className="text-base font-semibold text-orange-400">💰 Strong Setups — Over Budget</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                High-scoring picks outside your current per-trade cap (${cpScan.cap.toLocaleString()}). Track or raise your cap in Strategy.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {overBudgetPicks.slice(0, 12).map((p) => {
                const score = p.rank?.finalRank ?? p.row.setupScore;
                const needs = Math.ceil(p.estCost / 100) * 100;
                const isCall = p.contract.optionType === "call";
                return (
                  <Card key={p.key} className="p-3 space-y-2 border border-border/60 bg-card">
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold">{p.row.symbol}</span>
                        <span className="ml-2 mono text-sm">${p.row.price.toFixed(2)}</span>
                      </div>
                      <span className={cn("mono text-sm font-bold px-2 py-0.5 rounded border",
                        isCall ? "text-bullish border-bullish/60 bg-bullish/10" : "text-bearish border-bearish/60 bg-bearish/10",
                      )}>
                        ${p.contract.strike}{isCall ? "C" : "P"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <Badge variant="outline" className="bg-orange-600/20 text-orange-300 border-orange-600/40 font-mono">
                        Needs ~${needs.toLocaleString()}+ to enter
                      </Badge>
                      <span className="text-muted-foreground">Score <span className="font-semibold text-foreground">{Math.round(score)}</span></span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Cheapest rung: {p.rung} {isCall ? "call" : "put"} ${p.contract.strike} · ~${p.estCost.toLocaleString()}/contract
                    </div>
                    <a href="/strategy" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                      Raise budget in Strategy <ExternalLink className="h-3 w-3" />
                    </a>
                  </Card>
                );
              })}
            </div>
          </Card>
        )}

        <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
      </div>
    </TooltipProvider>
  );
}

// ─────────── Sub-components ───────────

function RangeSlider({ label, value, onChange, min, max, step = 1, display, estimated }: {
  label: string; value: number[]; onChange: (v: number[]) => void;
  min: number; max: number; step?: number; display: string; estimated?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground flex items-center gap-1">
          {label}
          {estimated && <span className="text-[9px] text-warning border border-warning/40 px-1 rounded">est</span>}
        </span>
        <span className="mono text-foreground">{display}</span>
      </div>
      <Slider min={min} max={max} step={step} value={value} onValueChange={onChange} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function EstNum({ n, est, suffix = "", className }: { n: number; est?: boolean; suffix?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-semibold", className)}>
      {n}{suffix}
      {est && <span className="text-[8px] text-warning/80 font-normal">·est</span>}
    </span>
  );
}

function ChartLinks({ symbol, className }: { symbol: string; className?: string }) {
  const links = [
    { href: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`, label: "Open chart on TradingView", Icon: CandlestickChart },
    { href: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, label: "Open quote on Yahoo Finance", Icon: ExternalLink },
  ];
  return (
    <div className={cn("inline-flex items-center gap-1", className)} onClick={(e) => e.stopPropagation()}>
      {links.map(({ href, label, Icon }) => (
        <Tooltip key={href}>
          <TooltipTrigger asChild>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border/60 bg-surface/40 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
            >
              <Icon className="h-3 w-3" />
            </a>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function DetailPanel({ row, decision, rank, onOpen }: {
  row: SetupRow;
  decision: StrategyDecision | null;
  rank: RankResult | null;
  onOpen: () => void;
}) {
  const [budget] = useBudget();
  // Fall back to recomputing if the parent didn't pass them in (defensive).
  const dec = decision ?? selectStrategy({
    symbol: row.symbol, bias: row.bias, price: row.price, changePct: row.changePct,
    ivRank: row.ivRank, atrPct: row.atrPct, rsi: row.rsi,
    optionsLiquidity: row.optionsLiquidity, earningsInDays: row.earningsInDays,
    setupScore: row.setupScore,
    maxLossBudget: budget,
  });
  return (
    <div className="space-y-4">
      {rank && <RankSummaryCard rank={rank} />}
      <StrategyPlaybookCard decision={dec} symbol={row.symbol} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Score breakdown */}
      <div className="lg:col-span-1 space-y-2">
        <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5" /> Score breakdown
        </div>
        <ScoreBar label="Liquidity"     value={row.breakdown.liquidity}    Icon={Activity} />
        <ScoreBar label="Technical"     value={row.breakdown.technical}    Icon={TrendingUp} />
        <ScoreBar label="Volatility"    value={row.breakdown.volatility}   Icon={Zap} />
        <ScoreBar label="Timing"        value={row.breakdown.timing}       Icon={Clock} />
        <ScoreBar label="Catalyst"      value={row.breakdown.catalyst}     Icon={Newspaper} />
        <ScoreBar label="Risk-adjusted" value={row.breakdown.riskAdjusted} Icon={Scale} />
      </div>

      {/* Why valid / weak */}
      <div className="lg:col-span-1 space-y-3">
        <div>
          <div className="text-xs font-medium text-bullish mb-1.5">What's valid</div>
          {row.whyValid.length === 0 ? (
            <div className="text-xs text-muted-foreground">No clear edge identified.</div>
          ) : (
            <ul className="text-xs space-y-1 text-foreground/85">
              {row.whyValid.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-bullish">•</span>{w}</li>)}
            </ul>
          )}
        </div>
        <div>
          <div className="text-xs font-medium text-warning mb-1.5">What's weak</div>
          {row.whyWeak.length === 0 ? (
            <div className="text-xs text-muted-foreground">No major weaknesses.</div>
          ) : (
            <ul className="text-xs space-y-1 text-foreground/85">
              {row.whyWeak.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-warning">•</span>{w}</li>)}
            </ul>
          )}
        </div>
      </div>

      {/* Warnings + actions */}
      <div className="lg:col-span-1 space-y-3">
        {row.warnings.length > 0 ? (
          <div>
            <div className="text-xs font-medium text-bearish mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> Warnings
            </div>
            <ul className="text-xs space-y-1">
              {row.warnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-bearish/90"><span>!</span>{w}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No warnings raised.</div>
        )}
        <div className="text-xs space-y-1 pt-2 border-t border-border/40">
          <div className="flex justify-between"><span className="text-muted-foreground">Trend</span><span>{row.trendLabel}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">EMA20 dist</span><span className="mono">{row.emaDist20 > 0 ? "+" : ""}{row.emaDist20}%</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">EMA50 dist</span><span className="mono">{row.emaDist50 > 0 ? "+" : ""}{row.emaDist50}%</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Avg vol (est)</span><span className="mono">{(row.avgVolume / 1e6).toFixed(1)}M</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Earnings</span><span>{row.earningsInDays != null ? `${row.earningsInDays}d` : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Data quality</span><span className={scoreColor(row.dataQuality)}>{row.dataQuality}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onOpen} className="flex-1 min-w-[140px]" size="sm">
            Open full research →
          </Button>
          <SaveToWatchlistButton
            size="sm"
            symbol={row.symbol}
            direction={deriveContractFromRow(row).direction}
            optionType={deriveContractFromRow(row).optionType}
            strike={deriveContractFromRow(row).strike}
            expiry={deriveContractFromRow(row).expiry}
            bias={row.bias}
            tier={row.readiness}
            entryPrice={row.price}
            thesis={row.warnings[0] ?? row.trendLabel}
            source="scanner"
            meta={{ setupScore: row.setupScore }}
          />
          <AddToPortfolioButton
            spec={{
              symbol: row.symbol,
              optionType: deriveContractFromRow(row).optionType as "call" | "put",
              strike: deriveContractFromRow(row).strike,
              expiry: deriveContractFromRow(row).expiry,
              spot: row.price,
              ivRank: row.ivRank,
              bucket: rowBucket({ riskBadge: row.crl?.riskBadge, earningsInDays: row.earningsInDays, ivRank: row.ivRank }),
              initialScore: row.setupScore,
              thesis: row.warnings[0] ?? row.trendLabel,
              source: "scanner",
            }}
          />
          
          <Button asChild variant="outline" size="sm" className="gap-1.5 flex-1 sm:flex-none min-w-[120px] sm:min-w-0">
            <a
              href={`https://robinhood.com/options/chains/${encodeURIComponent(row.symbol)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${row.symbol} options chain on Robinhood`}
            >
              <ExternalLink className="h-3 w-3" /> Robinhood
            </a>
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

function SetupCard({ row, rank, closes, onOpen }: { row: SetupRow; rank: RankResult | null; closes?: number[] | null; onOpen: () => void }) {
  const { cls: bcls, Icon: BIcon } = biasMeta(row.bias);
  const sparkValues = closes && closes.length >= 2 ? closes.slice(-20) : null;
  return (
    <Card className={cn("glass-card p-4 space-y-3 cursor-pointer hover:border-primary/40 transition-all", row.readiness === "AVOID" && "opacity-75")} onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono font-semibold text-lg">{row.symbol}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{row.name}</div>
        </div>
        <div className="text-right flex items-center gap-2">
          {sparkValues && <Sparkline values={sparkValues} width={64} height={22} ariaLabel={`${row.symbol} 20-day trend`} />}
          <div>
            {rank ? (
              <>
                <div className={cn("mono text-2xl font-semibold", scoreColor(rank.finalRank))}>{rank.finalRank}</div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wider", labelClasses(rank.label))}>
                  {rank.label}
                </span>
              </>
            ) : (
              <div className={cn("mono text-2xl font-semibold", scoreColor(row.setupScore))}>{row.setupScore}</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`pill ${bcls} capitalize gap-1`}><BIcon className="h-3 w-3" />{row.bias}</span>
        <span className="pill pill-neutral">{row.sector}</span>
        {row.relVolume >= 1.5 && <span className="pill pill-bullish">RV {row.relVolume.toFixed(1)}×</span>}
        {row.earningsInDays != null && row.earningsInDays <= 7 && (
          <span className="pill pill-bearish">ER in {row.earningsInDays}d</span>
        )}
      </div>

      {/* Score triplet — Setup / Readiness / Options — institutional view. */}
      {rank && (
        <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-border/40">
          <div><div className="text-muted-foreground">Setup</div><div className={cn("mono font-semibold", scoreColor(rank.setupScore))}>{rank.setupScore}</div></div>
          <div><div className="text-muted-foreground">Ready</div><div className={cn("mono font-semibold", scoreColor(rank.readinessScore))}>{rank.readinessScore}</div></div>
          <div><div className="text-muted-foreground">Options</div><div className={cn("mono font-semibold", scoreColor(rank.optionsScore))}>{rank.optionsScore}</div></div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted-foreground">Last</div><div className="mono">${row.price.toFixed(2)}</div></div>
        <div><div className="text-muted-foreground">Chg</div><div className={cn("mono", row.changePct >= 0 ? "text-bullish" : "text-bearish")}>{row.changePct >= 0 ? "+" : ""}{row.changePct.toFixed(2)}%</div></div>
        <div><div className="text-muted-foreground">Opt liq</div><div className="mono">{row.optionsLiquidity}</div></div>
      </div>

      {rank && rank.penalties.length > 0 && (
        <div className="text-[10px] text-bearish/90 pt-1 border-t border-border/40 space-y-0.5">
          {rank.penalties.slice(0, 2).map((p) => (
            <div key={p.code} className="flex gap-1.5"><span>−{Math.abs(p.points)}</span><span className="text-foreground/80">{p.reason}</span></div>
          ))}
        </div>
      )}

      {row.warnings[0] && (
        <div className="text-[11px] text-bearish/90 flex gap-1.5 pt-1 border-t border-border/40">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />{row.warnings[0]}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        {(() => {
          const c = deriveContractFromRow(row);
          const isCall = c.optionType === "call";
          const expDate = new Date(c.expiry + "T00:00:00");
          const expShort = isNaN(expDate.getTime())
            ? c.expiry
            : expDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
          const dte = isNaN(expDate.getTime())
            ? null
            : Math.max(0, Math.round((expDate.getTime() - Date.now()) / 86400000));
          return (
            <div className="text-[11px]">
              <span className={cn("mono font-semibold", isCall ? "text-bullish" : "text-bearish")}>
                ${c.strike}{isCall ? "C" : "P"}
              </span>
              <span className="text-muted-foreground"> · exp {expShort}{dte != null && ` (${dte}d)`}</span>
            </div>
          );
        })()}
        <SaveToWatchlistButton
          size="xs"
          symbol={row.symbol}
          direction={deriveContractFromRow(row).direction}
          optionType={deriveContractFromRow(row).optionType}
          strike={deriveContractFromRow(row).strike}
          expiry={deriveContractFromRow(row).expiry}
          bias={row.bias}
          tier={row.readiness}
          entryPrice={row.price}
          thesis={row.warnings[0] ?? row.trendLabel}
          source="scanner"
          meta={{ setupScore: row.setupScore }}
        />
        <AddToPortfolioButton
          size="xs"
          spec={{
            symbol: row.symbol,
            optionType: deriveContractFromRow(row).optionType as "call" | "put",
            strike: deriveContractFromRow(row).strike,
            expiry: deriveContractFromRow(row).expiry,
            spot: row.price,
            ivRank: row.ivRank,
            bucket: rowBucket({ riskBadge: row.crl?.riskBadge, earningsInDays: row.earningsInDays, ivRank: row.ivRank }),
            initialScore: row.setupScore,
            thesis: row.warnings[0] ?? row.trendLabel,
            source: "scanner",
          }}
        />
        
      </div>
    </Card>
  );
}

// ─────────── Rank Summary Card — shown above the playbook in DetailPanel ───────────
function RankSummaryCard({ rank }: { rank: RankResult }) {
  return (
    <Card className="glass-card p-4 space-y-3 border border-border/60">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] text-muted-foreground">FINAL RANK</div>
          <div className="flex items-baseline gap-3 mt-0.5">
            <span className={cn("mono text-3xl font-semibold", scoreColor(rank.finalRank))}>{rank.finalRank}</span>
            <span className={cn("text-xs font-bold tracking-wider px-2 py-0.5 rounded border", labelClasses(rank.label))}>
              {rank.label}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <ScorePill label="Setup" v={rank.setupScore} />
          <ScorePill label="Readiness" v={rank.readinessScore} />
          <ScorePill label="Options" v={rank.optionsScore} />
        </div>
      </div>

      {rank.penalties.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-1">
          <div className="text-[10px] font-bold tracking-wider text-bearish">PENALTIES</div>
          {rank.penalties.map((p) => (
            <div key={p.code} className="text-[11px] flex gap-2">
              <span className="mono text-bearish font-semibold w-8">{p.points}</span>
              <span className="text-foreground/85">{p.reason}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ScorePill({ label, v }: { label: string; v: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mono text-lg font-semibold", scoreColor(v))}>{v}</div>
    </div>
  );
}
