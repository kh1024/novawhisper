import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, LayoutGrid, Table2, SlidersHorizontal, Bookmark, Loader2, RefreshCw } from "lucide-react";
import { useOptionsChain, useLiveQuotes, type OptionContract } from "@/lib/liveData";
import { ResearchDrawer } from "@/components/ResearchDrawer";

type View = "table" | "cards" | "heatmap";
type StrategyFilter = "all" | "csp" | "covered-call" | "long-call" | "long-put";

const POPULAR = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT", "AMD", "META", "AMZN", "GOOGL"];

interface ScoredContract extends OptionContract {
  premiumPct: number;     // mid / strike * 100
  annualized: number;     // premiumPct * 365 / dte
  score: number;          // 0-100
  confidence: "A" | "B" | "C";
  riskBucket: "safe" | "mild" | "aggressive";
  bias: "bullish" | "bearish" | "neutral";
  derivedStrategy: "csp" | "covered-call" | "long-call" | "long-put";
}

/** Score a contract: liquidity + tight spread + meaningful yield, penalize wide spreads / 0 OI. */
function scoreContract(c: OptionContract, spot: number | null): ScoredContract {
  const mid = c.mid > 0 ? c.mid : c.last;
  const premiumPct = c.strike > 0 && mid > 0 ? (mid / c.strike) * 100 : 0;
  const annualized = c.dte > 0 ? (premiumPct * 365) / c.dte : 0;

  // Liquidity score: log-scale OI + volume
  const liqScore = Math.min(40, Math.log10(Math.max(1, c.openInterest)) * 12 + Math.log10(Math.max(1, c.volume)) * 6);
  // Spread penalty: <5% great, >25% bad
  const spreadScore = c.spreadPct > 0 ? Math.max(0, 25 - c.spreadPct) : 10;
  // Yield score: capped at 30 points
  const yieldScore = Math.min(30, annualized * 0.6);

  const score = Math.max(0, Math.min(100, Math.round(liqScore + spreadScore + yieldScore)));
  const confidence: ScoredContract["confidence"] = score > 75 ? "A" : score > 55 ? "B" : "C";
  const riskBucket: ScoredContract["riskBucket"] = score > 70 ? "safe" : score > 50 ? "mild" : "aggressive";

  // Derive strategy classification by type + moneyness
  let derivedStrategy: ScoredContract["derivedStrategy"];
  const itm = spot ? (c.type === "call" ? c.strike < spot : c.strike > spot) : false;
  if (c.type === "put" && !itm) derivedStrategy = "csp";
  else if (c.type === "call" && itm) derivedStrategy = "covered-call";
  else if (c.type === "call") derivedStrategy = "long-call";
  else derivedStrategy = "long-put";

  const bias: ScoredContract["bias"] =
    derivedStrategy === "long-call" || derivedStrategy === "csp" ? "bullish"
    : derivedStrategy === "long-put" ? "bearish"
    : "neutral";

  return {
    ...c,
    premiumPct: +premiumPct.toFixed(2),
    annualized: +annualized.toFixed(1),
    score,
    confidence,
    riskBucket,
    bias,
    derivedStrategy,
  };
}

export default function Scanner() {
  const [underlying, setUnderlying] = useState("AAPL");
  const [view, setView] = useState<View>("table");
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState<string>("all");
  const [strategy, setStrategy] = useState<StrategyFilter>("all");
  const [dteRange, setDteRange] = useState<number[]>([0, 90]);
  const [minScore, setMinScore] = useState<number[]>([40]);
  const [minOI, setMinOI] = useState<number[]>([10]);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  const { data: chain, isLoading, isFetching, refetch } = useOptionsChain(underlying, 250);
  const { data: quotes = [] } = useLiveQuotes([underlying], { refetchMs: 60_000 });
  const spot = quotes[0]?.price ?? null;

  const scored: ScoredContract[] = useMemo(() => {
    if (!chain?.contracts) return [];
    return chain.contracts.map((c) => scoreContract(c, spot)).sort((a, b) => b.score - a.score);
  }, [chain, spot]);

  const filtered = scored.filter((p) => {
    if (bucket !== "all" && p.riskBucket !== bucket) return false;
    if (strategy !== "all" && p.derivedStrategy !== strategy) return false;
    if (p.dte < dteRange[0] || p.dte > dteRange[1]) return false;
    if (p.score < minScore[0]) return false;
    if (p.openInterest < minOI[0]) return false;
    return true;
  });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = search.trim().toUpperCase();
    if (v) { setUnderlying(v); setSearch(""); }
  };

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live ranked contracts for{" "}
            <span className="text-foreground font-semibold">{underlying}</span>
            {spot && <> · spot <span className="mono text-foreground">${spot.toFixed(2)}</span></>}
            {" "}· {scored.length} scored
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList className="bg-surface/60 h-9">
              <TabsTrigger value="table" className="h-7"><Table2 className="h-3.5 w-3.5 mr-1.5" />Table</TabsTrigger>
              <TabsTrigger value="cards" className="h-7"><LayoutGrid className="h-3.5 w-3.5 mr-1.5" />Cards</TabsTrigger>
              <TabsTrigger value="heatmap" className="h-7">Heatmap</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="h-3.5 w-3.5" /> Save preset
          </Button>
        </div>
      </div>

      {/* Underlying chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {POPULAR.map((sym) => (
          <button
            key={sym}
            onClick={() => setUnderlying(sym)}
            className={`pill ${sym === underlying ? "pill-bullish" : "pill-neutral"} cursor-pointer`}
          >
            {sym}
          </button>
        ))}
      </div>

      <Card className="glass-card p-5 space-y-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <form onSubmit={submitSearch} className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search underlying…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-surface/60"
            />
          </form>

          <Select value={bucket} onValueChange={setBucket}>
            <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Risk profile" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              <SelectItem value="safe">Safe</SelectItem>
              <SelectItem value="mild">Mild</SelectItem>
              <SelectItem value="aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={strategy} onValueChange={(v) => setStrategy(v as StrategyFilter)}>
            <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Strategy" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All strategies</SelectItem>
              <SelectItem value="csp">Cash-Secured Put</SelectItem>
              <SelectItem value="covered-call">Covered Call</SelectItem>
              <SelectItem value="long-call">Long Call</SelectItem>
              <SelectItem value="long-put">Long Put</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between rounded-md border border-border bg-surface/40 px-3 py-2">
            <div>
              <div className="text-xs">Min Open Interest</div>
              <div className="text-[10px] text-muted-foreground mono">{minOI[0]}+</div>
            </div>
            <div className="w-24"><Slider min={0} max={1000} step={10} value={minOI} onValueChange={setMinOI} /></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>DTE range</span>
              <span className="mono text-foreground">{dteRange[0]} – {dteRange[1]}d</span>
            </div>
            <Slider min={0} max={365} step={1} value={dteRange} onValueChange={setDteRange} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Min score</span>
              <span className="mono text-foreground">{minScore[0]}</span>
            </div>
            <Slider min={0} max={100} step={1} value={minScore} onValueChange={setMinScore} />
          </div>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <span className="mono text-foreground">{filtered.length}</span> contracts match filters
        <span className="pill pill-live"><span className="live-dot" /> Live · Massive</span>
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      {isLoading && (
        <Card className="glass-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {underlying} chain…
        </Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="glass-card p-8 text-center text-sm text-muted-foreground">
          No contracts match your filters. Try lowering the min score or OI.
        </Card>
      )}

      {view === "table" && filtered.length > 0 && (
        <Card className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {["Type", "Strike", "Exp", "DTE", "Mid", "Yield %", "Annualized", "OI", "Vol", "Spread", "Δ", "IV", "Score", "Bias"].map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 60).map((p) => (
                  <tr
                    key={p.ticker}
                    onClick={() => setOpenSymbol(p.underlying)}
                    className="border-t border-border/60 hover:bg-surface/40 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-3">
                      <span className={`pill ${p.type === "call" ? "pill-bullish" : "pill-bearish"} uppercase`}>
                        {p.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 mono">${p.strike}</td>
                    <td className="px-3 py-3 mono text-xs">{p.expiration.slice(5)}</td>
                    <td className="px-3 py-3 mono">{p.dte}d</td>
                    <td className="px-3 py-3 mono">${p.mid.toFixed(2)}</td>
                    <td className="px-3 py-3 mono">{p.premiumPct}%</td>
                    <td className="px-3 py-3 mono text-bullish">{p.annualized}%</td>
                    <td className="px-3 py-3 mono">{p.openInterest.toLocaleString()}</td>
                    <td className="px-3 py-3 mono">{p.volume.toLocaleString()}</td>
                    <td className="px-3 py-3 mono text-xs">{p.spreadPct > 0 ? `${p.spreadPct}%` : "—"}</td>
                    <td className="px-3 py-3 mono">{p.delta?.toFixed(2) ?? "—"}</td>
                    <td className="px-3 py-3 mono">{p.iv ? (p.iv * 100).toFixed(0) + "%" : "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`mono font-semibold ${p.score > 75 ? "text-bullish" : p.score > 55 ? "text-foreground" : "text-muted-foreground"}`}>
                        {p.score}
                      </span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{p.confidence}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`pill ${p.bias === "bullish" ? "pill-bullish" : p.bias === "bearish" ? "pill-bearish" : "pill-neutral"} capitalize`}>
                        {p.bias}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === "cards" && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.slice(0, 24).map((p) => (
            <Card
              key={p.ticker}
              onClick={() => setOpenSymbol(p.underlying)}
              className="glass-card p-5 cursor-pointer hover:border-primary/40 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono font-semibold text-lg">{p.underlying} ${p.strike} {p.type.toUpperCase()}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {p.derivedStrategy.replace("-", " ")} · {p.expiration} · {p.dte}d
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-2xl font-semibold">{p.score}</div>
                  <div className="text-[10px] text-muted-foreground">Grade {p.confidence}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div><div className="text-muted-foreground">Mid</div><div className="mono">${p.mid.toFixed(2)}</div></div>
                <div><div className="text-muted-foreground">Yield</div><div className="mono">{p.premiumPct}%</div></div>
                <div><div className="text-muted-foreground">Ann.</div><div className="mono text-bullish">{p.annualized}%</div></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div><div className="text-muted-foreground">OI</div><div className="mono">{p.openInterest.toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">Δ</div><div className="mono">{p.delta?.toFixed(2) ?? "—"}</div></div>
                <div><div className="text-muted-foreground">IV</div><div className="mono">{p.iv ? (p.iv * 100).toFixed(0) + "%" : "—"}</div></div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`pill ${p.bias === "bullish" ? "pill-bullish" : p.bias === "bearish" ? "pill-bearish" : "pill-neutral"} capitalize`}>{p.bias}</span>
                <span className={`pill ${p.riskBucket === "safe" ? "pill-bullish" : p.riskBucket === "aggressive" ? "pill-bearish" : "pill-neutral"} capitalize`}>{p.riskBucket}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === "heatmap" && filtered.length > 0 && (
        <Card className="glass-card p-5">
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-2">
            {filtered.slice(0, 80).map((p) => {
              const intensity = Math.min(1, p.score / 100);
              const bg = p.bias === "bullish"
                ? `hsl(var(--bullish) / ${0.15 + intensity * 0.5})`
                : p.bias === "bearish"
                ? `hsl(var(--bearish) / ${0.15 + intensity * 0.5})`
                : `hsl(var(--muted) / ${0.4 + intensity * 0.3})`;
              return (
                <button
                  key={p.ticker}
                  onClick={() => setOpenSymbol(p.underlying)}
                  className="aspect-square rounded-lg border border-border/60 hover:border-primary p-2 flex flex-col justify-between text-left transition-all"
                  style={{ background: bg }}
                  title={`${p.underlying} ${p.strike}${p.type[0].toUpperCase()} ${p.expiration}`}
                >
                  <span className="font-mono text-[10px] font-semibold">${p.strike}{p.type[0].toUpperCase()}</span>
                  <div>
                    <div className="mono text-sm font-semibold">{p.score}</div>
                    <div className="text-[9px] text-muted-foreground">{p.annualized}%</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
