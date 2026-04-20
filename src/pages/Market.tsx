// Market — wide market overview: indices, top movers, sector heatmap, top crypto,
// hottest options picks, global ticker search. Mobile-first layout.
import { useMemo, useState } from "react";
import { Globe, TrendingUp, TrendingDown, RefreshCw, Search, Bitcoin, Layers3, Zap, ArrowUp, ArrowDown, Flame } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLiveQuotes, useOptionsChain, type VerifiedQuote } from "@/lib/liveData";
import { useTopCoins } from "@/lib/cryptoData";
import { useOptionsScout, type ScoutPick } from "@/lib/optionsScout";
import { useOptionInterest, pickInterestKey, fmtOI } from "@/lib/optionInterest";
import { useSma200, type SymbolSma } from "@/lib/sma200";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { PickMetaRow } from "@/components/PickMetaRow";
import { GateValidationDashboard } from "@/components/GateValidationDashboard";
import { BudgetImpactPill } from "@/components/BudgetImpactPill";
import { validatePick } from "@/lib/gates";
import { useResolvedIvp } from "@/lib/gates/useResolvedIvp";
import { useCapitalSettings } from "@/lib/budget";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { useSettings } from "@/lib/settings";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const INDICES = ["SPY", "QQQ", "DIA", "IWM", "VIX"];
const INDEX_LABELS: Record<string, string> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  DIA: "Dow 30",
  IWM: "Russell 2000",
  VIX: "Volatility",
};

function fmtNum(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtCompact(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}

function MoverRow({ q, onClick }: { q: VerifiedQuote; onClick: () => void }) {
  const up = q.changePct >= 0;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface/60 active:bg-surface/80 transition-colors text-left"
    >
      <div className="font-mono font-semibold text-xs sm:text-sm w-12 sm:w-14 shrink-0">{q.symbol}</div>
      <div className="flex-1 min-w-0 truncate text-[10px] sm:text-xs text-muted-foreground hidden sm:block">{q.name ?? "—"}</div>
      <div className="mono text-xs sm:text-sm shrink-0">${fmtNum(q.price)}</div>
      <div className={cn("mono text-xs sm:text-sm font-semibold w-16 sm:w-20 text-right shrink-0", up ? "text-bullish" : "text-bearish")}>
        {up ? "+" : ""}{q.changePct.toFixed(2)}%
      </div>
    </button>
  );
}

function OptionPickRow({ p, onClick, oi, quote, sma, accountBalance }: {
  p: ScoutPick; onClick: () => void; oi?: number;
  quote?: VerifiedQuote | null; sma?: SymbolSma | null;
  accountBalance: number;
}) {
  const isBull = p.bias === "bullish" || p.optionType === "call";
  const gradeTone = p.grade === "A" ? "text-bullish border-bullish/40 bg-bullish/10"
    : p.grade === "B" ? "text-warning border-warning/40 bg-warning/10"
    : "text-muted-foreground border-border bg-surface/50";
  // Lazy-load the live options chain for THIS pick so Gate 6 (IVP Guard)
  // runs on a real ATM IV vs. the chain's IV envelope instead of a PRNG.
  const { data: chainData } = useOptionsChain(p.symbol, 150);
  const chain = chainData?.contracts ?? null;
  // True 52-week IVP from iv_history (returns null until ≥60 samples exist;
  // adapter then falls back to the chain envelope automatically).
  const resolvedIvp = useResolvedIvp(p.symbol, chain, quote?.price ?? p.playAt, p.optionType);
  const validation = useMemo(
    () => validatePick({
      pick: p, quote, sma, accountBalance, chain,
      ivPercentile: resolvedIvp?.ivp ?? null,
    }),
    [p, quote, sma, accountBalance, chain, resolvedIvp?.ivp],
  );
  const blocked = validation.finalStatus === "BLOCKED";
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex flex-col gap-1.5 p-2.5 rounded-md border transition-colors text-left",
        blocked ? "border-bearish/40 bg-bearish/5 hover:border-bearish/60" : "border-border/60 hover:border-primary/40 active:bg-surface/60",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-bold text-sm">{p.symbol}</span>
        {p.grade && (
          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", gradeTone)}>
            {p.grade}
          </span>
        )}
      </div>
      <PickMetaRow
        inputs={{
          symbol: p.symbol,
          rawBias: p.bias ?? (isBull ? "bullish" : "bearish"),
          optionType: p.optionType,
          strike: p.strikeShort ? `${p.strike}/${p.strikeShort}` : p.strike,
          riskBucket: p.risk,
          budget: accountBalance,
          isHardBlocked: blocked,
        }}
        expiry={p.expiry}
      />
      <div className="text-[11px] text-muted-foreground line-clamp-2">{p.thesis}</div>
      <div className="flex items-center gap-2 text-[10px] flex-wrap">
        {oi != null && oi > 0 && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 mono"
            title="Open interest — total outstanding contracts at this strike/expiry"
          >
            OI {fmtOI(oi)}
          </span>
        )}
        {p.expectedReturn && <span className="text-bullish font-semibold">+{p.expectedReturn}</span>}
        {p.probability && <span className="text-muted-foreground">{p.probability} prob</span>}
        {p.premiumEstimate && <span className="text-muted-foreground mono">{p.premiumEstimate}</span>}
        <BudgetImpactPill result={validation} />
      </div>
      <GateValidationDashboard result={validation} compact className="pt-1" />
      <div
        className="pt-1.5 flex justify-end"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <AddToPortfolioButton
          size="xs"
          variant="outline"
          spec={{
            symbol: p.symbol,
            optionType: p.optionType,
            strike: p.strike,
            expiry: p.expiry,
            spot: quote?.price ?? p.playAt ?? null,
            ivRank: null,
            bucket: p.risk,
            initialScore: typeof p.score === "number" ? p.score : null,
            thesis: p.thesis,
            source: "market-hottest",
          }}
        />
      </div>
    </button>
  );
}

export default function Market() {
  const { portfolio: accountBalance } = useCapitalSettings();
  const [settings] = useSettings();
  const universe = useMemo(
    () => Array.from(new Set([...TICKER_UNIVERSE.map((u) => u.symbol), ...(settings.customTickers ?? [])])),
    [settings.customTickers],
  );
  const watch = useMemo(() => Array.from(new Set([...INDICES, ...universe])), [universe]);
  const { data: quotes = [], isLoading, isFetching } = useLiveQuotes(watch);
  const { data: coins = [], isLoading: coinsLoading } = useTopCoins(10);
  const { data: scout, isLoading: scoutLoading } = useOptionsScout();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState<string | null>(null);

  const indexQuotes = INDICES.map((s) => quotes.find((q) => q.symbol === s)).filter(Boolean) as VerifiedQuote[];
  const stockQuotes = quotes.filter((q) => !INDICES.includes(q.symbol));

  const sorted = [...stockQuotes].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.slice(0, 10);
  const losers = sorted.slice(-10).reverse();
  const mostActive = [...stockQuotes].sort((a, b) => b.volume - a.volume).slice(0, 10);

  // Sector heatmap
  const sectorMap = new Map<string, { count: number; sumChange: number }>();
  for (const q of stockQuotes) {
    const s = q.sector ?? "Other";
    const cur = sectorMap.get(s) ?? { count: 0, sumChange: 0 };
    cur.count++;
    cur.sumChange += q.changePct;
    sectorMap.set(s, cur);
  }
  const sectors = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, count: v.count, avgChange: v.sumChange / v.count }))
    .sort((a, b) => b.avgChange - a.avgChange);

  // Hottest options — combine all buckets, prioritize Grade A, then by playAt
  const hotOptions = useMemo(() => {
    if (!scout) return [];
    const all = [
      ...(scout.safe ?? []),
      ...(scout.moderate ?? []),
      ...(scout.aggressive ?? []),
      ...(scout.swing ?? []),
    ];
    const gradeRank = { A: 3, B: 2, C: 1 } as const;
    return all
      .sort((a, b) => {
        const ga = gradeRank[a.grade ?? "C"] ?? 0;
        const gb = gradeRank[b.grade ?? "C"] ?? 0;
        if (gb !== ga) return gb - ga;
        return (b.playAt ?? 0) - (a.playAt ?? 0);
      })
      .slice(0, 8);
  }, [scout]);

  // Live open interest per pick
  const interestMap = useOptionInterest(hotOptions);
  // Re-rank by OI when available — falls back to grade order otherwise
  const hotOptionsRanked = useMemo(() => {
    return [...hotOptions].sort((a, b) => {
      const oa = interestMap.get(pickInterestKey(a))?.oi ?? -1;
      const ob = interestMap.get(pickInterestKey(b))?.oi ?? -1;
      return ob - oa;
    });
  }, [hotOptions, interestMap]);

  // 200-SMA + quote maps for the gate validator on each Hottest Options card.
  const hotSymbols = useMemo(() => Array.from(new Set(hotOptionsRanked.map((p) => p.symbol))), [hotOptionsRanked]);
  const { map: smaMap } = useSma200(hotSymbols);
  const quoteMap = useMemo(() => new Map(quotes.map((q) => [q.symbol, q])), [quotes]);

  // Search suggestions
  const searchResults = search.trim().length >= 1
    ? TICKER_UNIVERSE.filter((u) =>
        u.symbol.toLowerCase().includes(search.toLowerCase()) ||
        u.name?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4 sm:h-5 sm:w-5 text-primary" /> Market
          </h1>
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
            Live overview. Tap any ticker to research.
          </p>
        </div>
        <Button
          size="sm" variant="ghost" className="gap-1.5 h-8"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["live-quotes"] });
            qc.invalidateQueries({ queryKey: ["top-coins"] });
            qc.invalidateQueries({ queryKey: ["options-scout"] });
          }}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Global search */}
      <Card className="glass-card p-2.5 sm:p-3 relative">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
            placeholder="Search ticker — NVDA, MSTR, COIN…"
            className="h-9 border-0 focus-visible:ring-0 px-0 text-sm font-mono bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const sym = (searchResults[0]?.symbol ?? search.trim().toUpperCase());
                if (sym) { setFocused(sym); setSearch(""); }
              }
            }}
          />
          {search && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSearch("")}>Clear</Button>
          )}
        </div>
        {search.trim().length >= 1 && (
          <div className="absolute left-2 right-2 sm:left-3 sm:right-3 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
            {searchResults.map((u) => (
              <button
                key={u.symbol}
                onClick={() => { setFocused(u.symbol); setSearch(""); }}
                className="w-full flex items-center gap-2 sm:gap-3 px-3 py-2 hover:bg-surface/60 active:bg-surface/80 transition-colors text-left"
              >
                <div className="font-mono font-semibold text-sm w-14 sm:w-16">{u.symbol}</div>
                <div className="flex-1 truncate text-xs text-muted-foreground">{u.name}</div>
                {u.sector && <Badge variant="outline" className="text-[9px] hidden sm:inline-flex">{u.sector}</Badge>}
              </button>
            ))}
            {(() => {
              const typed = search.trim().toUpperCase();
              const inList = searchResults.some((u) => u.symbol === typed);
              if (!typed || inList) return null;
              return (
                <button
                  onClick={() => { setFocused(typed); setSearch(""); }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary/10 border-t border-border transition-colors text-left"
                >
                  <Search className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span className="text-xs">
                    Open <span className="font-mono font-semibold text-foreground">{typed}</span> in Research
                  </span>
                </button>
              );
            })()}
          </div>
        )}
      </Card>

      {/* Indices strip — 2 cols mobile, 5 desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {(isLoading && indexQuotes.length === 0 ? INDICES : indexQuotes.map((q) => q.symbol)).map((sym, i) => {
          const q = indexQuotes.find((x) => x.symbol === sym);
          if (!q) return <Skeleton key={i} className="h-[72px] sm:h-20 rounded-lg" />;
          const up = q.changePct >= 0;
          return (
            <Card
              key={q.symbol}
              onClick={() => setFocused(q.symbol)}
              className="glass-card p-2.5 sm:p-3 cursor-pointer hover:border-primary/50 active:scale-[0.98] transition-all"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono font-semibold text-xs sm:text-sm">{q.symbol}</span>
                <span className="text-[8px] sm:text-[9px] uppercase tracking-wider text-muted-foreground truncate">{INDEX_LABELS[q.symbol] ?? ""}</span>
              </div>
              <div className="mono text-base sm:text-lg font-semibold mt-0.5 sm:mt-1">${fmtNum(q.price)}</div>
              <div className={cn("mono text-[11px] sm:text-xs font-semibold", up ? "text-bullish" : "text-bearish")}>
                {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
              </div>
            </Card>
          );
        })}
      </div>

      {/* Hottest Options — NEW */}
      <Card className="glass-card p-3 sm:p-4">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-2.5">
          <Flame className="h-3.5 w-3.5 text-warning" /> Hottest Options
          <Badge variant="outline" className="text-[9px] ml-1">most interest</Badge>
          <span className="text-[10px] font-normal text-muted-foreground ml-auto truncate">
            {scout?.regime ? `regime · ${scout.regime}` : "live picks"}
          </span>
        </div>
        {scoutLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : hotOptionsRanked.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">No high-interest options right now.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {hotOptionsRanked.map((p, i) => (
              <OptionPickRow
                key={`${p.symbol}-${i}`}
                p={p}
                oi={interestMap.get(pickInterestKey(p))?.oi}
                quote={quoteMap.get(p.symbol) ?? null}
                sma={smaMap.get(p.symbol) ?? null}
                accountBalance={accountBalance}
                onClick={() => setFocused(p.symbol)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Movers — Tabs on mobile, 3-col grid on desktop */}
      <div className="lg:hidden">
        <Tabs defaultValue="gainers">
          <TabsList className="grid grid-cols-3 w-full h-9">
            <TabsTrigger value="gainers" className="text-xs gap-1">
              <TrendingUp className="h-3 w-3 text-bullish" /> Gainers
            </TabsTrigger>
            <TabsTrigger value="losers" className="text-xs gap-1">
              <TrendingDown className="h-3 w-3 text-bearish" /> Losers
            </TabsTrigger>
            <TabsTrigger value="active" className="text-xs gap-1">
              <Zap className="h-3 w-3 text-primary" /> Active
            </TabsTrigger>
          </TabsList>
          <TabsContent value="gainers" className="mt-2">
            <Card className="glass-card p-2">
              {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
                : <div className="space-y-0.5">{gainers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}</div>}
            </Card>
          </TabsContent>
          <TabsContent value="losers" className="mt-2">
            <Card className="glass-card p-2">
              {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
                : <div className="space-y-0.5">{losers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}</div>}
            </Card>
          </TabsContent>
          <TabsContent value="active" className="mt-2">
            <Card className="glass-card p-2">
              {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
                : <div className="space-y-0.5">
                  {mostActive.map((q) => (
                    <button key={q.symbol} onClick={() => setFocused(q.symbol)}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface/60 active:bg-surface/80 transition-colors text-left">
                      <div className="font-mono font-semibold text-xs w-12">{q.symbol}</div>
                      <div className="flex-1 mono text-[11px] text-muted-foreground">{(q.volume / 1_000_000).toFixed(1)}M</div>
                      <div className={cn("mono text-xs", q.changePct >= 0 ? "text-bullish" : "text-bearish")}>
                        {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
                      </div>
                    </button>
                  ))}
                </div>}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Movers desktop grid */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-3">
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-bullish">
              <TrendingUp className="h-3.5 w-3.5" /> Top Gainers
            </div>
            <Badge variant="outline" className="text-[9px]">{gainers.length}</Badge>
          </div>
          {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
            : <div className="space-y-0.5">{gainers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}</div>}
        </Card>
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-bearish">
              <TrendingDown className="h-3.5 w-3.5" /> Top Losers
            </div>
            <Badge variant="outline" className="text-[9px]">{losers.length}</Badge>
          </div>
          {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
            : <div className="space-y-0.5">{losers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}</div>}
        </Card>
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-primary">
              <Zap className="h-3.5 w-3.5" /> Most Active
            </div>
            <Badge variant="outline" className="text-[9px]">{mostActive.length}</Badge>
          </div>
          {isLoading ? <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
            : <div className="space-y-0.5">
              {mostActive.map((q) => (
                <button key={q.symbol} onClick={() => setFocused(q.symbol)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface/60 transition-colors text-left">
                  <div className="font-mono font-semibold text-sm w-14">{q.symbol}</div>
                  <div className="flex-1 mono text-xs text-muted-foreground">{(q.volume / 1_000_000).toFixed(1)}M</div>
                  <div className={cn("mono text-xs", q.changePct >= 0 ? "text-bullish" : "text-bearish")}>
                    {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
                  </div>
                </button>
              ))}
            </div>}
        </Card>
      </div>

      {/* Sector heatmap — 2 cols mobile, 4 desktop */}
      <Card className="glass-card p-3 sm:p-4">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-3 flex-wrap">
          <Layers3 className="h-3.5 w-3.5 text-primary" /> Sector Heatmap
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">{stockQuotes.length} stocks</span>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {sectors.map((s) => {
              const intensity = Math.min(1, Math.abs(s.avgChange) / 3);
              const up = s.avgChange >= 0;
              const bg = up
                ? `hsl(var(--bullish) / ${0.1 + intensity * 0.4})`
                : `hsl(var(--bearish) / ${0.1 + intensity * 0.4})`;
              return (
                <div
                  key={s.sector}
                  className="rounded-md border border-border p-2.5 sm:p-3 transition-colors"
                  style={{ backgroundColor: bg }}
                >
                  <div className="text-[10px] sm:text-[11px] font-semibold truncate">{s.sector}</div>
                  <div className={cn("mono text-sm sm:text-base font-semibold mt-0.5", up ? "text-bullish" : "text-bearish")}>
                    {up ? "+" : ""}{s.avgChange.toFixed(2)}%
                  </div>
                  <div className="text-[9px] text-muted-foreground">{s.count} stocks</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Top Crypto */}
      <Card className="glass-card p-3 sm:p-4">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-3 flex-wrap">
          <Bitcoin className="h-3.5 w-3.5 text-warning" /> Top 10 Crypto
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">CoinGecko · 24h</span>
        </div>
        {coinsLoading ? (
          <div className="space-y-1">{[1,2,3,4,5,6,7,8,9,10].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : coins.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">Crypto feed unavailable.</div>
        ) : (
          <div className="space-y-0.5">
            {coins.map((c) => {
              const up = (c.price_change_percentage_24h ?? 0) >= 0;
              return (
                <a
                  key={c.id}
                  href={`https://www.coingecko.com/en/coins/${c.id}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 sm:gap-3 px-1.5 sm:px-2 py-2 rounded-md hover:bg-surface/60 active:bg-surface/80 transition-colors"
                >
                  <span className="text-[9px] sm:text-[10px] mono text-muted-foreground w-5 sm:w-6 shrink-0">#{c.market_cap_rank}</span>
                  <img src={c.image} alt={c.name} className="h-5 w-5 rounded-full shrink-0" loading="lazy" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs sm:text-sm font-semibold truncate">
                      {c.name}
                      <span className="text-muted-foreground font-mono text-[9px] sm:text-[10px] uppercase ml-1">{c.symbol}</span>
                    </div>
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground hidden md:block w-24 text-right mono">
                    {fmtCompact(c.market_cap)}
                  </div>
                  <div className="mono text-xs sm:text-sm w-16 sm:w-20 text-right shrink-0">${fmtNum(c.current_price, c.current_price < 1 ? 4 : 2)}</div>
                  <div className={cn("mono text-xs sm:text-sm font-semibold w-14 sm:w-16 text-right flex items-center justify-end gap-0.5 shrink-0", up ? "text-bullish" : "text-bearish")}>
                    {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {Math.abs(c.price_change_percentage_24h ?? 0).toFixed(2)}%
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </Card>

      <ResearchDrawer symbol={focused} onClose={() => setFocused(null)} />
    </div>
  );
}
