import { Fragment, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useLiveQuotes } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { computeSetups, type SetupRow, type Bias, type Readiness } from "@/lib/setupScore";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";
import { dispatchPickAlerts } from "@/lib/webhook";
import { SaveToPortfolioButton } from "@/components/SaveToPortfolioButton";
import { Hint } from "@/components/Hint";
import { usePickExpiration, type PickInputs } from "@/lib/pickExpiration";
import { PickExpiryChips } from "@/components/PickExpiryChips";
import { evaluateGuards } from "@/lib/novaGuards";
import { useSma200 } from "@/lib/sma200";
import { NovaGuardBadges } from "@/components/NovaGuardBadges";
import { NovaFilterBar } from "@/components/NovaFilterBar";
import { useNovaFilter, pickMatchesFilter } from "@/lib/novaFilter";

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
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const universe = useMemo(() => TICKER_UNIVERSE.map((t) => t.symbol), []);
  const { data: quotes = [], isLoading, isFetching, refetch, dataUpdatedAt } = useLiveQuotes(universe, {
    refetchMs: 60_000,
  });

  const rows: SetupRow[] = useMemo(() => computeSetups(quotes).sort((a, b) => b.setupScore - a.setupScore), [quotes]);

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

  // 200-day SMA gate — pulled once per session, cached 24h.
  const sma = useSma200(rows.map((r) => r.symbol));

  const [novaSpec] = useNovaFilter();

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const exp = expiryStatus.get(`scanner:${r.symbol}`);
      if (exp?.isTimedOut) return false;          // remove old setups
      if (filters.search && !r.symbol.includes(filters.search.toUpperCase()) && !r.name.toUpperCase().includes(filters.search.toUpperCase())) return false;
      if (filters.sector !== "all" && r.sector !== filters.sector) return false;
      if (filters.bias !== "all" && r.bias !== filters.bias) return false;
      if (filters.readiness !== "all" && r.readiness !== filters.readiness) return false;
      if (filters.hideAvoid && r.readiness === "AVOID") return false;
      if (r.setupScore < filters.minScore[0]) return false;
      if (r.relVolume < filters.minRelVol[0]) return false;
      if (r.ivRank < filters.ivrRange[0] || r.ivRank > filters.ivrRange[1]) return false;
      if (r.rsi < filters.rsiRange[0] || r.rsi > filters.rsiRange[1]) return false;
      if (r.changePct < filters.changeRange[0] || r.changePct > filters.changeRange[1]) return false;
      if (r.optionsLiquidity < filters.minOptionsLiq[0]) return false;
      if (filters.excludeEarnings && r.earningsInDays != null && r.earningsInDays <= 7) return false;

      // NOVA natural-language filter — applied on top of UI filters.
      // Scanner rows don't carry per-contract premium so the budget gate
      // is skipped here; symbol/bias/optionType/score still apply.
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
  }, [rows, filters, expiryStatus, novaSpec]);

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

  const counts = useMemo(() => ({
    now: rows.filter((r) => r.readiness === "NOW").length,
    wait: rows.filter((r) => r.readiness === "WAIT").length,
    avoid: rows.filter((r) => r.readiness === "AVOID").length,
    warnings: rows.filter((r) => r.warnings.length > 0).length,
  }), [rows]);

  const freshness = dataUpdatedAt
    ? `${Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000))}s ago`
    : "—";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-4 sm:p-6 md:p-8 max-w-[1700px] mx-auto space-y-6">
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

        {/* NOVA AI filter — natural-language pick filter */}
        <NovaFilterBar />

        {/* Readiness summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: "NOW",      v: counts.now,      sub: "high-conviction setups", cls: "border-bullish/40 text-bullish",   Icon: Zap },
            { k: "WAIT",     v: counts.wait,     sub: "thesis valid, timing off", cls: "border-warning/40 text-warning",   Icon: Clock },
            { k: "AVOID",    v: counts.avoid,    sub: "blocked or weak",        cls: "border-bearish/40 text-bearish",   Icon: ShieldAlert },
            { k: "Warnings", v: counts.warnings, sub: "data / risk flags",      cls: "border-border text-foreground",    Icon: AlertTriangle },
          ].map((c) => (
            <Card key={c.k} className={cn("glass-card p-4 border", c.cls)}>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.k}</div>
                <c.Icon className="h-4 w-4 opacity-70" />
              </div>
              <div className="mono text-3xl font-semibold mt-1">{c.v}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</div>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="glass-card p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              <Badge variant="outline" className="text-[10px] ml-1">
                {filtered.length} / {rows.length} match
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)} className="h-7 gap-1.5 text-xs">
              <RotateCcw className="h-3 w-3" /> Reset
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Ticker or name…"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="pl-9 bg-surface/60"
              />
            </div>

            <Select value={filters.sector} onValueChange={(v) => setFilters({ ...filters, sector: v })}>
              <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Sector" /></SelectTrigger>
              <SelectContent>
                {SECTORS.map((s) => <SelectItem key={s} value={s as string}>{s === "all" ? "All sectors" : s}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.bias} onValueChange={(v) => setFilters({ ...filters, bias: v as any })}>
              <SelectTrigger className="bg-surface/60"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BIAS_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.readiness} onValueChange={(v) => setFilters({ ...filters, readiness: v as any })}>
              <SelectTrigger className="bg-surface/60"><SelectValue /></SelectTrigger>
              <SelectContent>
                {READINESS_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}><span className={o.cls}>{o.label}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <RangeSlider label="Min Setup Score" value={filters.minScore} onChange={(v) => setFilters({ ...filters, minScore: v })} min={0} max={100} display={`${filters.minScore[0]}+`} />
            <RangeSlider label="Min Relative Volume" value={filters.minRelVol} onChange={(v) => setFilters({ ...filters, minRelVol: v })} min={0} max={5} step={0.1} display={`${filters.minRelVol[0].toFixed(1)}×`} />
            <RangeSlider label="Min Options Liquidity" value={filters.minOptionsLiq} onChange={(v) => setFilters({ ...filters, minOptionsLiq: v })} min={0} max={100} display={`${filters.minOptionsLiq[0]}+`} />
            <RangeSlider label="IV Rank" value={filters.ivrRange} onChange={(v) => setFilters({ ...filters, ivrRange: v })} min={0} max={100} display={`${filters.ivrRange[0]} – ${filters.ivrRange[1]}`} estimated />
            <RangeSlider label="RSI" value={filters.rsiRange} onChange={(v) => setFilters({ ...filters, rsiRange: v })} min={0} max={100} display={`${filters.rsiRange[0]} – ${filters.rsiRange[1]}`} estimated />
            <RangeSlider label="Daily % change" value={filters.changeRange} onChange={(v) => setFilters({ ...filters, changeRange: v })} min={-15} max={15} step={0.5} display={`${filters.changeRange[0]}% – ${filters.changeRange[1]}%`} />
          </div>

          <div className="flex items-center gap-5 flex-wrap pt-2 border-t border-border/40">
            <Toggle label="Exclude earnings ≤ 7d" checked={filters.excludeEarnings} onChange={(v) => setFilters({ ...filters, excludeEarnings: v })} />
            <Toggle label="Hide AVOID" checked={filters.hideAvoid} onChange={(v) => setFilters({ ...filters, hideAvoid: v })} />
            <span className="text-[10px] text-muted-foreground ml-auto">
              IVR · RSI · ATR · EMA distance are <span className="text-warning">estimated</span> until live indicators wired in.
            </span>
          </div>
        </Card>

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
        {!isLoading && view === "table" && filtered.length > 0 && (
          <Card className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface/60 text-[11px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    {[
                      { k: "Ticker" }, { k: "Last" }, { k: "% Chg" },
                      { k: "Rel Vol", tip: "Volume vs estimated avg" },
                      { k: "Trend" },
                      { k: "IVR", tip: "IV Rank — green <30 (cheap premium), red >60 (rich premium)" },
                      { k: "RSI", tip: "Estimated — green 45–60 (healthy), red <30 or >70 (over-extended)" },
                      { k: "ATR%", tip: "Estimated — green <2% (calm), red >4% (volatile)" },
                      { k: "Opt Liq", tip: "Options liquidity proxy — green ≥60, red <30" },
                      { k: "Setup", tip: "Weighted final score 0–100 — green ≥70, red <45" },
                      { k: "CRL", tip: "Conflict Resolution: GO / WAIT / NO / EXIT + Risk badge" },
                      { k: "Readiness" }, { k: "" },
                    ].map((h) => (
                      <th key={h.k} className="text-left px-3 py-2.5 font-medium whitespace-nowrap">
                        {h.tip ? (
                          <Tooltip><TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">{h.k}</TooltipTrigger><TooltipContent>{h.tip}</TooltipContent></Tooltip>
                        ) : h.k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const { cls: bcls, Icon: BIcon } = biasMeta(r.bias);
                    const ready = readinessMeta(r.readiness);
                    const isOpen = expanded === r.symbol;
                    const exp = expiryStatus.get(`scanner:${r.symbol}`);
                    const baseVerdict = (exp?.effectiveVerdict ?? r.crl.verdict) as typeof r.crl.verdict;
                    // NOVA Guards — 200-SMA gate is the relevant one for scanner long-call setups.
                    const guard = evaluateGuards({
                      symbol: r.symbol,
                      livePrice: r.price,
                      pickPrice: r.price,                          // live = pick price in scanner
                      optionType: r.bias === "bearish" ? "put" : "call",
                      direction: "long",
                      strike: r.price,                              // ATM for the gate
                      sma200: sma.map.get(r.symbol)?.sma200 ?? null,
                      riskBucket: r.crl.riskBadge?.toLowerCase() ?? null,
                    });
                    // If guard blocks, downgrade GO → BLOCKED so the user can't act.
                    const verdict = guard.shouldBlockSignal && baseVerdict === "GO" ? "EXIT" : baseVerdict;
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
                          <td className="px-3 py-3 mono"><EstNum n={r.ivRank} est className={ivrColor(r.ivRank)} /></td>
                          <td className="px-3 py-3 mono"><EstNum n={r.rsi} est className={rsiColor(r.rsi)} /></td>
                          <td className="px-3 py-3 mono"><EstNum n={r.atrPct} est suffix="%" className={atrColor(r.atrPct)} /></td>
                          <td className={cn("px-3 py-3 mono font-semibold", liqColor(r.optionsLiquidity))}>{r.optionsLiquidity}</td>
                          <td className="px-3 py-3">
                            <div className={cn("mono font-semibold text-base", scoreColor(r.setupScore))}>{r.setupScore}</div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <Hint label="NOVA — verdict engine reconciling technicals, Greeks & risk">
                                  <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border w-fit bg-primary/10 text-primary border-primary/40 cursor-help">
                                    NOVA
                                  </span>
                                </Hint>
                                <span className={cn(
                                  "text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border w-fit",
                                  verdict === "GO" && "bg-bullish/15 text-bullish border-bullish/40",
                                  verdict === "WAIT" && "bg-warning/15 text-warning border-warning/40",
                                  (verdict === "NO" || verdict === "EXIT") && "bg-bearish/15 text-bearish border-bearish/40",
                                  verdict === "NEUTRAL" && "bg-muted/30 text-muted-foreground border-border",
                                )}>{blocked ? "BLOCKED" : verdict}</span>
                              </div>
                              {r.crl.riskBadge && (
                                <span className={cn(
                                  "text-[9px] px-1.5 py-0 rounded border w-fit",
                                  r.crl.riskBadge === "Safe" && "text-bullish border-bullish/30",
                                  r.crl.riskBadge === "Mild" && "text-warning border-warning/30",
                                  r.crl.riskBadge === "Aggressive" && "text-bearish border-bearish/30",
                                )}>{r.crl.riskBadge}</span>
                              )}
                              <NovaGuardBadges guard={guard} compact />
                              <PickExpiryChips status={exp} compact />
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn("text-[10px] px-2 py-1 rounded border font-semibold tracking-wider", ready.cls)}>
                              {ready.label}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              {(() => {
                                const c = deriveContractFromRow(r);
                                const isCall = c.optionType === "call";
                                return (
                                  <Hint label={`BUY ${r.symbol} $${c.strike} ${isCall ? "CALL" : "PUT"} · exp ${c.expiry}`}>
                                    <span
                                      className={cn(
                                        "mono text-sm font-bold px-2.5 py-1 rounded-md border-2 whitespace-nowrap cursor-help shadow-sm",
                                        isCall
                                          ? "text-bullish border-bullish/60 bg-bullish/10"
                                          : "text-bearish border-bearish/60 bg-bearish/10",
                                      )}
                                    >
                                      ${c.strike}{isCall ? "C" : "P"}
                                    </span>
                                  </Hint>
                                );
                              })()}
                              <SaveToPortfolioButton {...deriveContractFromRow(r)} size="xs" />
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
                              <DetailPanel row={r} onOpen={() => setOpenSymbol(r.symbol)} />
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
        {!isLoading && view === "cards" && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((r) => <SetupCard key={r.symbol} row={r} onOpen={() => setOpenSymbol(r.symbol)} />)}
          </div>
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

function DetailPanel({ row, onOpen }: { row: SetupRow; onOpen: () => void }) {
  return (
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
          <SaveToPortfolioButton {...deriveContractFromRow(row)} size="sm" />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
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
  );
}

function SetupCard({ row, onOpen }: { row: SetupRow; onOpen: () => void }) {
  const ready = readinessMeta(row.readiness);
  const { cls: bcls, Icon: BIcon } = biasMeta(row.bias);
  return (
    <Card className={cn("glass-card p-4 space-y-3 cursor-pointer hover:border-primary/40 transition-all", row.readiness === "AVOID" && "opacity-75")} onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono font-semibold text-lg">{row.symbol}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">{row.name}</div>
        </div>
        <div className="text-right">
          <div className={cn("mono text-2xl font-semibold", scoreColor(row.setupScore))}>{row.setupScore}</div>
          <span className={cn("text-[10px] px-2 py-0.5 rounded border font-semibold tracking-wider", ready.cls)}>{ready.label}</span>
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

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted-foreground">Last</div><div className="mono">${row.price.toFixed(2)}</div></div>
        <div><div className="text-muted-foreground">Chg</div><div className={cn("mono", row.changePct >= 0 ? "text-bullish" : "text-bearish")}>{row.changePct >= 0 ? "+" : ""}{row.changePct.toFixed(2)}%</div></div>
        <div><div className="text-muted-foreground">Opt liq</div><div className="mono">{row.optionsLiquidity}</div></div>
      </div>

      <div className="space-y-1.5 pt-1">
        <ScoreBar label="Liquidity"  value={row.breakdown.liquidity}  Icon={Activity} />
        <ScoreBar label="Technical"  value={row.breakdown.technical}  Icon={TrendingUp} />
        <ScoreBar label="Timing"     value={row.breakdown.timing}     Icon={Clock} />
      </div>

      {row.warnings[0] && (
        <div className="text-[11px] text-bearish/90 flex gap-1.5 pt-1 border-t border-border/40">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />{row.warnings[0]}
        </div>
      )}

      <div className="flex justify-end pt-1" onClick={(e) => e.stopPropagation()}>
        <SaveToPortfolioButton {...deriveContractFromRow(row)} size="xs" />
      </div>
    </Card>
  );
}
