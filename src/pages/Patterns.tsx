// Patterns — chart pattern scanner + seasonality stats across the universe.
import { useMemo, useState } from "react";
import { Activity, CalendarRange, Loader2, RefreshCw, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { detectPatterns, computeSeasonality, useHistories, type DetectedPattern, type SeasonalityStat } from "@/lib/patternDetection";
import { useQueryClient } from "@tanstack/react-query";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { cn } from "@/lib/utils";

const SYMBOLS = TICKER_UNIVERSE.map((u) => u.symbol).slice(0, 25);

function biasColor(bias: "bullish" | "bearish" | "neutral") {
  if (bias === "bullish") return "text-bullish border-bullish/40 bg-bullish/10";
  if (bias === "bearish") return "text-bearish border-bearish/40 bg-bearish/10";
  return "text-muted-foreground border-border bg-muted/30";
}
function biasIcon(bias: "bullish" | "bearish" | "neutral") {
  if (bias === "bullish") return <TrendingUp className="h-3 w-3" />;
  if (bias === "bearish") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

export default function Patterns() {
  const qc = useQueryClient();
  const { data: histories = [], isLoading, isFetching } = useHistories(SYMBOLS, 180);
  const [filter, setFilter] = useState("");
  const [biasFilter, setBiasFilter] = useState<"all" | "bullish" | "bearish">("all");
  const [focused, setFocused] = useState<string | null>(null);

  const allPatterns: DetectedPattern[] = useMemo(() => {
    const out: DetectedPattern[] = [];
    for (const h of histories) {
      if (h.error || !h.bars?.length) continue;
      out.push(...detectPatterns(h.symbol, h.bars));
    }
    return out.sort((a, b) => b.confidence - a.confidence);
  }, [histories]);

  const allSeasonality: SeasonalityStat[] = useMemo(() => {
    const out: SeasonalityStat[] = [];
    for (const h of histories) {
      if (h.error || !h.bars?.length) continue;
      out.push(...computeSeasonality(h.symbol, h.bars));
    }
    return out;
  }, [histories]);

  const filteredPatterns = allPatterns.filter((p) => {
    if (filter && !p.symbol.toLowerCase().includes(filter.toLowerCase())) return false;
    if (biasFilter !== "all" && p.bias !== biasFilter) return false;
    return true;
  });
  const filteredSeasonality = allSeasonality.filter((s) => {
    if (filter && !s.symbol.toLowerCase().includes(filter.toLowerCase())) return false;
    if (biasFilter !== "all" && s.bias !== biasFilter) return false;
    return true;
  });

  const counts = {
    bullish: allPatterns.filter((p) => p.bias === "bullish").length,
    bearish: allPatterns.filter((p) => p.bias === "bearish").length,
    total: allPatterns.length,
    coverage: histories.filter((h) => !h.error && h.bars?.length).length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Patterns
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Daily chart-pattern detection + behavioral seasonality on {counts.coverage} symbols. Updates every 10 min.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 border-bullish/40 text-bullish">
            <TrendingUp className="h-3 w-3" /> {counts.bullish} bullish
          </Badge>
          <Badge variant="outline" className="gap-1 border-bearish/40 text-bearish">
            <TrendingDown className="h-3 w-3" /> {counts.bearish} bearish
          </Badge>
          <Button
            size="sm" variant="ghost" className="gap-1.5"
            onClick={() => qc.invalidateQueries({ queryKey: ["pattern-histories"] })}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="glass-card p-3 flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by symbol…"
          className="h-8 max-w-[180px] text-sm font-mono"
        />
        <div className="flex gap-1">
          {(["all", "bullish", "bearish"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBiasFilter(b)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded border capitalize transition-colors",
                biasFilter === b ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground hover:bg-surface"
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </Card>

      <Tabs defaultValue="charts">
        <TabsList className="bg-surface/60">
          <TabsTrigger value="charts">
            <Activity className="h-3.5 w-3.5 mr-1.5" /> Chart Patterns
          </TabsTrigger>
          <TabsTrigger value="seasonality">
            <CalendarRange className="h-3.5 w-3.5 mr-1.5" /> Seasonality
          </TabsTrigger>
        </TabsList>

        {/* CHART PATTERNS */}
        <TabsContent value="charts" className="mt-4 space-y-2">
          {isLoading && (
            <div className="grid gap-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          )}
          {!isLoading && filteredPatterns.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No patterns match your filters. Try clearing them.
            </Card>
          )}
          {!isLoading && filteredPatterns.map((p, i) => (
            <Card
              key={`${p.symbol}-${p.pattern}-${i}`}
              onClick={() => setFocused(p.symbol)}
              className="glass-card p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
            >
              <div className="font-mono font-semibold w-16 text-sm">{p.symbol}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{p.pattern}</span>
                  <Badge variant="outline" className={cn("text-[10px] gap-1", biasColor(p.bias))}>
                    {biasIcon(p.bias)} {p.bias}
                  </Badge>
                  <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                    {p.severity}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.description}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="mono text-sm font-semibold">{Math.round(p.confidence)}%</div>
                <div className="text-[10px] text-muted-foreground">conf</div>
              </div>
            </Card>
          ))}
          {isFetching && !isLoading && (
            <div className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 pt-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
            </div>
          )}
        </TabsContent>

        {/* SEASONALITY */}
        <TabsContent value="seasonality" className="mt-4 space-y-2">
          {isLoading && (
            <div className="grid gap-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          )}
          {!isLoading && filteredSeasonality.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Not enough history to detect seasonality. Try a wider universe.
            </Card>
          )}
          {!isLoading && filteredSeasonality.map((s, i) => (
            <Card
              key={`${s.symbol}-${s.bucket}-${i}`}
              onClick={() => setFocused(s.symbol)}
              className="glass-card p-3 flex items-center gap-3 cursor-pointer hover:border-primary/50 transition-colors"
            >
              <div className="font-mono font-semibold w-16 text-sm">{s.symbol}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{s.bucket}</span>
                  <Badge variant="outline" className={cn("text-[10px] gap-1", biasColor(s.bias))}>
                    {biasIcon(s.bias)} {s.bias}
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Up <span className="font-mono text-foreground">{Math.round(s.hitRate * 100)}%</span> of the time
                  · avg <span className={cn("font-mono", s.avgReturnPct >= 0 ? "text-bullish" : "text-bearish")}>
                    {s.avgReturnPct >= 0 ? "+" : ""}{s.avgReturnPct.toFixed(2)}%
                  </span>
                  · {s.sampleSize} samples
                </div>
              </div>
              {/* Hit rate bar */}
              <div className="w-24 hidden sm:block">
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden flex">
                  <div className="bg-bullish" style={{ width: `${s.hitRate * 100}%` }} />
                  <div className="bg-bearish" style={{ width: `${(1 - s.hitRate) * 100}%` }} />
                </div>
                <div className="flex justify-between text-[9px] mono text-muted-foreground mt-0.5">
                  <span>{Math.round(s.hitRate * 100)}↑</span>
                  <span>{Math.round((1 - s.hitRate) * 100)}↓</span>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <ResearchDrawer symbol={focused} onClose={() => setFocused(null)} />
    </div>
  );
}
