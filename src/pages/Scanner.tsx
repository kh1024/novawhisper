import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, LayoutGrid, Table2, SlidersHorizontal, Bookmark } from "lucide-react";
import { getMockPicks, getMockQuotes } from "@/lib/mockData";
import { ResearchDrawer } from "@/components/ResearchDrawer";

type View = "table" | "cards" | "heatmap";

export default function Scanner() {
  const allPicks = useMemo(() => getMockPicks(80), []);
  const quoteBySymbol = useMemo(() => Object.fromEntries(getMockQuotes().map((q) => [q.symbol, q])), []);
  const [view, setView] = useState<View>("table");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [bucket, setBucket] = useState<string>("all");
  const [strategy, setStrategy] = useState<string>("all");
  const [dteRange, setDteRange] = useState<number[]>([0, 365]);
  const [minScore, setMinScore] = useState<number[]>([50]);
  const [avoidEarnings, setAvoidEarnings] = useState(false);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  const filtered = allPicks.filter((p) => {
    const q = quoteBySymbol[p.symbol];
    if (search && !p.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    if (sector !== "all" && q?.sector !== sector) return false;
    if (bucket !== "all" && p.riskBucket !== bucket) return false;
    if (strategy !== "all" && p.strategy !== strategy) return false;
    if (p.dte < dteRange[0] || p.dte > dteRange[1]) return false;
    if (p.score < minScore[0]) return false;
    if (avoidEarnings && p.earningsInDays !== undefined && p.earningsInDays <= 7) return false;
    return true;
  });

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">Multi-factor scoring across {allPicks.length} contracts.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList className="bg-surface/60 h-9">
              <TabsTrigger value="table" className="h-7"><Table2 className="h-3.5 w-3.5 mr-1.5" />Table</TabsTrigger>
              <TabsTrigger value="cards" className="h-7"><LayoutGrid className="h-3.5 w-3.5 mr-1.5" />Cards</TabsTrigger>
              <TabsTrigger value="heatmap" className="h-7">Heatmap</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Bookmark className="h-3.5 w-3.5" /> Save preset
          </Button>
        </div>
      </div>

      {/* View tabs (universe) */}
      <Tabs defaultValue="all">
        <TabsList className="bg-surface/60 h-9 flex-wrap">
          {["all", "ETF", "Tech", "Semis", "Financials", "Energy", "Healthcare", "Watchlist"].map((u) => (
            <TabsTrigger key={u} value={u.toLowerCase()} className="h-7 text-xs">{u}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="glass-card p-5 space-y-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search ticker..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-surface/60"
            />
          </div>

          <Select value={sector} onValueChange={setSector}>
            <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Sector" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sectors</SelectItem>
              <SelectItem value="ETF">ETFs</SelectItem>
              <SelectItem value="Tech">Tech</SelectItem>
              <SelectItem value="Semis">Semis</SelectItem>
              <SelectItem value="Financials">Financials</SelectItem>
              <SelectItem value="Energy">Energy</SelectItem>
              <SelectItem value="Healthcare">Healthcare</SelectItem>
            </SelectContent>
          </Select>

          <Select value={bucket} onValueChange={setBucket}>
            <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Risk profile" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              <SelectItem value="safe">Safe</SelectItem>
              <SelectItem value="mild">Mild</SelectItem>
              <SelectItem value="aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={strategy} onValueChange={setStrategy}>
            <SelectTrigger className="bg-surface/60"><SelectValue placeholder="Strategy" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All strategies</SelectItem>
              <SelectItem value="covered-call">Covered Call</SelectItem>
              <SelectItem value="csp">Cash-Secured Put</SelectItem>
              <SelectItem value="long-call">Long Call</SelectItem>
              <SelectItem value="long-put">Long Put</SelectItem>
              <SelectItem value="wheel">Wheel</SelectItem>
              <SelectItem value="leaps">LEAPS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          <div className="flex items-center justify-between rounded-md border border-border bg-surface/40 px-3 py-2">
            <div>
              <div className="text-xs">Avoid earnings ≤ 7d</div>
              <div className="text-[10px] text-muted-foreground">Filter event-risk plays</div>
            </div>
            <Switch checked={avoidEarnings} onCheckedChange={setAvoidEarnings} />
          </div>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <span className="mono text-foreground">{filtered.length}</span> opportunities match filters
        <span className="pill pill-live"><span className="live-dot" /> Live scan</span>
      </div>

      {view === "table" && (
        <Card className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {["Symbol", "Strategy", "Strike", "DTE", "Premium", "Yield %", "Annualized", "IV Rank", "Δ Delta", "Score", "Bias"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 40).map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setOpenSymbol(p.symbol)}
                    className="border-t border-border/60 hover:bg-surface/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-semibold">{p.symbol}</td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{p.strategy.replace("-", " ")}</td>
                    <td className="px-4 py-3 mono">${p.strike}</td>
                    <td className="px-4 py-3 mono">{p.dte}d</td>
                    <td className="px-4 py-3 mono">${p.premium.toFixed(2)}</td>
                    <td className="px-4 py-3 mono">{p.premiumPct}%</td>
                    <td className="px-4 py-3 mono text-bullish">{p.annualized}%</td>
                    <td className="px-4 py-3 mono">{p.ivRank}</td>
                    <td className="px-4 py-3 mono">{p.delta}</td>
                    <td className="px-4 py-3">
                      <span className={`mono font-semibold ${p.score > 80 ? "text-bullish" : p.score > 65 ? "text-foreground" : "text-muted-foreground"}`}>
                        {p.score}
                      </span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground">{p.confidence}</span>
                    </td>
                    <td className="px-4 py-3">
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

      {view === "cards" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.slice(0, 24).map((p) => (
            <Card
              key={p.id}
              onClick={() => setOpenSymbol(p.symbol)}
              className="glass-card p-5 cursor-pointer hover:border-primary/40 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono font-semibold text-lg">{p.symbol}</div>
                  <div className="text-xs text-muted-foreground capitalize">{p.strategy.replace("-", " ")} • {p.dte}d</div>
                </div>
                <div className="text-right">
                  <div className="mono text-2xl font-semibold">{p.score}</div>
                  <div className="text-[10px] text-muted-foreground">Grade {p.confidence}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div><div className="text-muted-foreground">Strike</div><div className="mono">${p.strike}</div></div>
                <div><div className="text-muted-foreground">Premium</div><div className="mono">${p.premium}</div></div>
                <div><div className="text-muted-foreground">Ann.</div><div className="mono text-bullish">{p.annualized}%</div></div>
              </div>
              <div className="text-xs text-foreground/80 mb-3 line-clamp-2">{p.reason}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`pill ${p.bias === "bullish" ? "pill-bullish" : p.bias === "bearish" ? "pill-bearish" : "pill-neutral"} capitalize`}>{p.bias}</span>
                <span className={`pill ${p.riskBucket === "safe" ? "pill-bullish" : p.riskBucket === "aggressive" ? "pill-bearish" : "pill-neutral"} capitalize`}>{p.riskBucket}</span>
                {p.earningsInDays !== undefined && (
                  <span className="pill pill-bearish">Earn {p.earningsInDays}d</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === "heatmap" && (
        <Card className="glass-card p-5">
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-2">
            {filtered.slice(0, 60).map((p) => {
              const intensity = Math.min(1, p.score / 100);
              const bg = p.bias === "bullish"
                ? `hsl(var(--bullish) / ${0.15 + intensity * 0.5})`
                : p.bias === "bearish"
                ? `hsl(var(--bearish) / ${0.15 + intensity * 0.5})`
                : `hsl(var(--muted) / ${0.4 + intensity * 0.3})`;
              return (
                <button
                  key={p.id}
                  onClick={() => setOpenSymbol(p.symbol)}
                  className="aspect-square rounded-lg border border-border/60 hover:border-primary p-2 flex flex-col justify-between text-left transition-all"
                  style={{ background: bg }}
                >
                  <span className="font-mono text-xs font-semibold">{p.symbol}</span>
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
