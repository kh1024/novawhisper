import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Sparkles, FileText, Youtube, TrendingUp, Newspaper } from "lucide-react";
import { getMockQuotes, getMockPicks } from "@/lib/mockData";
import { useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

type Props = {
  symbol: string | null;
  onClose: () => void;
};

function genSeries(symbol: string, n = 60) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const out = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    v += ((h % 1000) / 1000 - 0.48) * 3;
    out.push({ d: i, v: +v.toFixed(2) });
  }
  return out;
}

const SYMPATHY_MAP: Record<string, string[]> = {
  NVDA: ["AMD", "TSM", "AVGO", "ARM", "SMH"],
  AMD: ["NVDA", "TSM", "AVGO", "SMH"],
  AAPL: ["MSFT", "GOOGL", "META", "QQQ"],
  TSLA: ["NVDA", "AMD", "QQQ"],
  SPY: ["QQQ", "DIA", "IWM"],
  XLK: ["QQQ", "AAPL", "MSFT", "NVDA"],
};

export function ResearchDrawer({ symbol, onClose }: Props) {
  const quotes = useMemo(() => getMockQuotes(), []);
  const picks = useMemo(() => getMockPicks(120), []);
  const q = symbol ? quotes.find((x) => x.symbol === symbol) : null;
  const series = useMemo(() => (symbol ? genSeries(symbol) : []), [symbol]);
  const sympathies = symbol ? (SYMPATHY_MAP[symbol] ?? []).map((s) => quotes.find((x) => x.symbol === s)).filter(Boolean) : [];
  const symbolPicks = symbol ? picks.filter((p) => p.symbol === symbol).slice(0, 4) : [];

  const fundamentals = useMemo(
    () => [
      { label: "Q1", revenue: 22, debt: 8, cash: 35 },
      { label: "Q2", revenue: 26, debt: 8, cash: 38 },
      { label: "Q3", revenue: 31, debt: 7, cash: 42 },
      { label: "Q4", revenue: 35, debt: 7, cash: 48 },
    ],
    []
  );

  return (
    <Sheet open={!!symbol} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-background border-l-border p-0">
        {q && (
          <div className="flex flex-col">
            <SheetHeader className="p-6 border-b border-border bg-gradient-surface">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <SheetTitle className="text-2xl font-mono">{q.symbol}</SheetTitle>
                    <Badge variant="outline" className="text-[10px]">{q.sector}</Badge>
                    <span className="pill pill-live"><span className="live-dot" /> Verified</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{q.name}</div>
                </div>
                <div className="text-right">
                  <div className="mono text-3xl font-semibold">${q.price.toFixed(2)}</div>
                  <div className={`mono text-sm ${q.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({q.change >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%)
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="p-6 space-y-5">
              {/* Chart */}
              <Card className="glass-card p-4">
                <div className="text-xs text-muted-foreground mb-2">60-day price</div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <XAxis dataKey="d" hide />
                      <YAxis hide domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Indicators row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: "RSI", v: q.rsi },
                  { k: "IV", v: `${q.iv}%` },
                  { k: "IVR", v: q.ivRank },
                  { k: "Trend", v: q.trend },
                ].map((m) => (
                  <Card key={m.k} className="glass-card p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.k}</div>
                    <div className="mono text-sm font-semibold mt-1 capitalize">{m.v}</div>
                  </Card>
                ))}
              </div>

              <Tabs defaultValue="why">
                <TabsList className="bg-surface/60 w-full justify-start">
                  <TabsTrigger value="why">Why this surfaced</TabsTrigger>
                  <TabsTrigger value="picks">Picks</TabsTrigger>
                  <TabsTrigger value="fund">Fundamentals</TabsTrigger>
                  <TabsTrigger value="sym">Sympathy</TabsTrigger>
                </TabsList>

                <TabsContent value="why" className="mt-4">
                  <Card className="glass-card p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Sparkles className="h-4 w-4 text-primary" /> AI Explanation
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {q.symbol} is in a <span className="text-bullish">{q.trend}</span> regime. Price is{" "}
                      {q.trend === "bullish" ? "above" : "below"} key 20/50 EMAs and IV rank of {q.ivRank} suggests
                      {q.ivRank! > 50 ? " elevated premium-selling opportunities." : " cheaper long-vol exposure."}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded-md bg-surface/60 border border-border/60">
                        <div className="text-muted-foreground">Technicals</div>
                        <div className="mt-1">Trend {q.trend}, RSI {q.rsi}</div>
                      </div>
                      <div className="p-2 rounded-md bg-surface/60 border border-border/60">
                        <div className="text-muted-foreground">Options</div>
                        <div className="mt-1">IV {q.iv}%, IVR {q.ivRank}</div>
                      </div>
                      <div className="p-2 rounded-md bg-surface/60 border border-border/60">
                        <div className="text-muted-foreground">Event risk</div>
                        <div className="mt-1">No earnings within 7d</div>
                      </div>
                      <div className="p-2 rounded-md bg-surface/60 border border-border/60">
                        <div className="text-muted-foreground">Regime</div>
                        <div className="mt-1">Risk-On, breadth 68%</div>
                      </div>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="picks" className="mt-4 space-y-2">
                  {symbolPicks.length === 0 && (
                    <div className="text-sm text-muted-foreground p-4 text-center">No active picks for this symbol.</div>
                  )}
                  {symbolPicks.map((p) => (
                    <Card key={p.id} className="glass-card p-3 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-sm capitalize font-medium">{p.strategy.replace("-", " ")}</div>
                        <div className="text-[11px] text-muted-foreground">${p.strike} • {p.dte}d • Δ{p.delta}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="mono text-bullish">{p.annualized}% ann.</div>
                        <div className="text-muted-foreground">${p.premium} premium</div>
                      </div>
                      <div className="mono text-lg font-semibold w-10 text-right">{p.score}</div>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="fund" className="mt-4">
                  <Card className="glass-card p-4">
                    <div className="text-xs text-muted-foreground mb-2">Revenue / Debt / Cash trend</div>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={fundamentals}>
                          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                          <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="revenue" fill="hsl(var(--bullish))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="cash" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="debt" fill="hsl(var(--bearish))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="sym" className="mt-4 space-y-2">
                  <div className="text-xs text-muted-foreground mb-2">
                    Related plays moving with {q.symbol}
                  </div>
                  {sympathies.length === 0 && (
                    <div className="text-sm text-muted-foreground p-4 text-center">No sympathy mapping for this symbol yet.</div>
                  )}
                  {sympathies.map((s) => s && (
                    <Card key={s.symbol} className="glass-card p-3 flex items-center gap-3">
                      <div className="font-mono font-semibold w-16">{s.symbol}</div>
                      <div className="flex-1 text-xs text-muted-foreground">{s.name}</div>
                      <div className="mono text-sm">${s.price.toFixed(2)}</div>
                      <div className={`mono text-xs w-16 text-right ${s.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {s.change >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                      </div>
                    </Card>
                  ))}
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button variant="outline" size="sm" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" />TradingView</Button>
                <Button variant="outline" size="sm" className="gap-1.5"><Newspaper className="h-3.5 w-3.5" />News</Button>
                <Button variant="outline" size="sm" className="gap-1.5"><Youtube className="h-3.5 w-3.5" />YouTube</Button>
                <Button variant="outline" size="sm" className="gap-1.5"><FileText className="h-3.5 w-3.5" />SEC</Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
