// Market — wide market overview: indices, top movers, sector heatmap, top crypto, global ticker search.
import { useMemo, useState } from "react";
import { Globe, TrendingUp, TrendingDown, Activity, RefreshCw, Search, Bitcoin, Layers3, Zap, ArrowUp, ArrowDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveQuotes, type VerifiedQuote } from "@/lib/liveData";
import { useTopCoins } from "@/lib/cryptoData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { ResearchDrawer } from "@/components/ResearchDrawer";
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
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface/60 transition-colors text-left"
    >
      <div className="font-mono font-semibold text-sm w-14">{q.symbol}</div>
      <div className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{q.name ?? "—"}</div>
      <div className="mono text-sm">${fmtNum(q.price)}</div>
      <div className={cn("mono text-sm font-semibold w-20 text-right", up ? "text-bullish" : "text-bearish")}>
        {up ? "+" : ""}{q.changePct.toFixed(2)}%
      </div>
    </button>
  );
}

export default function Market() {
  const universe = useMemo(() => TICKER_UNIVERSE.map((u) => u.symbol), []);
  const watch = useMemo(() => Array.from(new Set([...INDICES, ...universe])), [universe]);
  const { data: quotes = [], isLoading, isFetching } = useLiveQuotes(watch);
  const { data: coins = [], isLoading: coinsLoading } = useTopCoins(10);
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

  // Search suggestions
  const searchResults = search.trim().length >= 1
    ? TICKER_UNIVERSE.filter((u) =>
        u.symbol.toLowerCase().includes(search.toLowerCase()) ||
        u.name?.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" /> Market
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Live wide-market overview. Click any ticker to open research.
          </p>
        </div>
        <Button
          size="sm" variant="ghost" className="gap-1.5"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["live-quotes"] });
            qc.invalidateQueries({ queryKey: ["top-coins"] });
          }}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Global search */}
      <Card className="glass-card p-3 relative">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any ticker — e.g. NVDA, AAPL, SPY…"
            className="h-9 border-0 focus-visible:ring-0 px-0 text-sm font-mono bg-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchResults[0]) {
                setFocused(searchResults[0].symbol);
                setSearch("");
              }
            }}
          />
          {search && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSearch("")}>Clear</Button>
          )}
        </div>
        {searchResults.length > 0 && (
          <div className="absolute left-3 right-3 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
            {searchResults.map((u) => (
              <button
                key={u.symbol}
                onClick={() => { setFocused(u.symbol); setSearch(""); }}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface/60 transition-colors text-left first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="font-mono font-semibold text-sm w-14">{u.symbol}</div>
                <div className="flex-1 truncate text-xs text-muted-foreground">{u.name}</div>
                {u.sector && <Badge variant="outline" className="text-[9px]">{u.sector}</Badge>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Indices strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(isLoading && indexQuotes.length === 0 ? INDICES : indexQuotes.map((q) => q.symbol)).map((sym, i) => {
          const q = indexQuotes.find((x) => x.symbol === sym);
          if (!q) return <Skeleton key={i} className="h-20 rounded-lg" />;
          const up = q.changePct >= 0;
          return (
            <Card
              key={q.symbol}
              onClick={() => setFocused(q.symbol)}
              className="glass-card p-3 cursor-pointer hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-sm">{q.symbol}</span>
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{INDEX_LABELS[q.symbol] ?? ""}</span>
              </div>
              <div className="mono text-lg font-semibold mt-1">${fmtNum(q.price)}</div>
              <div className={cn("mono text-xs font-semibold", up ? "text-bullish" : "text-bearish")}>
                {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
              </div>
            </Card>
          );
        })}
      </div>

      {/* Movers grid */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* Gainers */}
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-bullish">
              <TrendingUp className="h-3.5 w-3.5" /> Top Gainers
            </div>
            <Badge variant="outline" className="text-[9px]">{gainers.length}</Badge>
          </div>
          {isLoading ? (
            <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
          ) : gainers.length === 0 ? (
            <div className="text-xs text-muted-foreground p-3 text-center">No movers yet.</div>
          ) : (
            <div className="space-y-0.5">
              {gainers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}
            </div>
          )}
        </Card>

        {/* Losers */}
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-bearish">
              <TrendingDown className="h-3.5 w-3.5" /> Top Losers
            </div>
            <Badge variant="outline" className="text-[9px]">{losers.length}</Badge>
          </div>
          {isLoading ? (
            <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
          ) : losers.length === 0 ? (
            <div className="text-xs text-muted-foreground p-3 text-center">No movers yet.</div>
          ) : (
            <div className="space-y-0.5">
              {losers.map((q) => <MoverRow key={q.symbol} q={q} onClick={() => setFocused(q.symbol)} />)}
            </div>
          )}
        </Card>

        {/* Most Active */}
        <Card className="glass-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5 text-primary">
              <Zap className="h-3.5 w-3.5" /> Most Active
            </div>
            <Badge variant="outline" className="text-[9px]">{mostActive.length}</Badge>
          </div>
          {isLoading ? (
            <div className="space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <div className="space-y-0.5">
              {mostActive.map((q) => (
                <button
                  key={q.symbol}
                  onClick={() => setFocused(q.symbol)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface/60 transition-colors text-left"
                >
                  <div className="font-mono font-semibold text-sm w-14">{q.symbol}</div>
                  <div className="flex-1 mono text-xs text-muted-foreground">{(q.volume / 1_000_000).toFixed(1)}M</div>
                  <div className={cn("mono text-xs", q.changePct >= 0 ? "text-bullish" : "text-bearish")}>
                    {q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Sector heatmap */}
      <Card className="glass-card p-4">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-3">
          <Layers3 className="h-3.5 w-3.5 text-primary" /> Sector Heatmap
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">avg change · {stockQuotes.length} stocks</span>
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
                  className="rounded-md border border-border p-3 transition-colors"
                  style={{ backgroundColor: bg }}
                >
                  <div className="text-[11px] font-semibold truncate">{s.sector}</div>
                  <div className={cn("mono text-base font-semibold mt-0.5", up ? "text-bullish" : "text-bearish")}>
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
      <Card className="glass-card p-4">
        <div className="text-xs font-semibold flex items-center gap-1.5 mb-3">
          <Bitcoin className="h-3.5 w-3.5 text-warning" /> Top 10 Crypto
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">via CoinGecko · 24h</span>
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
                  className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-surface/60 transition-colors"
                >
                  <span className="text-[10px] mono text-muted-foreground w-6">#{c.market_cap_rank}</span>
                  <img src={c.image} alt={c.name} className="h-5 w-5 rounded-full" loading="lazy" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {c.name} <span className="text-muted-foreground font-mono text-[10px] uppercase ml-1">{c.symbol}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground hidden sm:block w-24 text-right mono">
                    {fmtCompact(c.market_cap)}
                  </div>
                  <div className="mono text-sm w-20 text-right">${fmtNum(c.current_price, c.current_price < 1 ? 4 : 2)}</div>
                  <div className={cn("mono text-sm font-semibold w-16 text-right flex items-center justify-end gap-0.5", up ? "text-bullish" : "text-bearish")}>
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
