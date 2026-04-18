import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Flame, ShieldCheck, TrendingUp, Sparkles } from "lucide-react";
import { getMockQuotes, getMockPicks, MARKET_REGIME, TOP_SECTORS, UPCOMING_EVENTS } from "@/lib/mockData";
import { useMemo, useState } from "react";
import { ResearchDrawer } from "@/components/ResearchDrawer";

const fade = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.4, ease: [0.25, 1, 0.5, 1] } }),
};

export default function Dashboard() {
  const quotes = useMemo(() => getMockQuotes(), []);
  const picks = useMemo(() => getMockPicks(20), []);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  const etfs = quotes.filter((q) => q.sector === "ETF");

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Hero strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Market Regime", value: MARKET_REGIME.regime, sub: MARKET_REGIME.trend, icon: TrendingUp, tone: "bullish" as const },
          { label: "Volatility (VIX)", value: MARKET_REGIME.vix.toFixed(2), sub: `${MARKET_REGIME.vixChange > 0 ? "+" : ""}${MARKET_REGIME.vixChange} today`, icon: Activity, tone: "neutral" as const },
          { label: "Breadth", value: `${MARKET_REGIME.breadth}%`, sub: "Stocks above 50DMA", icon: ShieldCheck, tone: "bullish" as const },
          { label: "Event Risk", value: "Elevated", sub: "FOMC + 2 earnings this week", icon: AlertTriangle, tone: "bearish" as const },
        ].map((c, i) => (
          <motion.div key={c.label} variants={fade} initial="hidden" animate="show" custom={i}>
            <Card className="glass-card-elevated p-5 relative overflow-hidden group">
              <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-primary opacity-10 blur-2xl group-hover:opacity-20 transition-opacity" />
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">{c.label}</span>
                <c.icon className={`h-4 w-4 ${c.tone === "bullish" ? "text-bullish" : c.tone === "bearish" ? "text-bearish" : "text-primary"}`} />
              </div>
              <div className="text-2xl font-semibold mono">{c.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ETF strip */}
      <Card className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide">Sector ETFs</h2>
          <span className="text-[11px] text-muted-foreground">8 instruments</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {etfs.map((e) => {
            const up = e.change >= 0;
            return (
              <button
                key={e.symbol}
                onClick={() => setOpenSymbol(e.symbol)}
                className="text-left p-3 rounded-lg border border-border bg-surface/40 hover:border-primary/40 hover:bg-surface transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{e.symbol}</span>
                  <span className={`text-[10px] mono ${up ? "text-bullish" : "text-bearish"}`}>
                    {up ? "+" : ""}{e.changePct.toFixed(2)}%
                  </span>
                </div>
                <div className="mono text-sm mt-1">${e.price.toFixed(2)}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top opportunities */}
        <Card className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-wide">Top Opportunities Today</h2>
            </div>
            <Tabs defaultValue="safe" className="w-auto">
              <TabsList className="h-8 bg-surface/60">
                <TabsTrigger value="safe" className="text-xs h-6">Safe</TabsTrigger>
                <TabsTrigger value="mild" className="text-xs h-6">Mild</TabsTrigger>
                <TabsTrigger value="aggressive" className="text-xs h-6">Aggressive</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            {picks.slice(0, 6).map((p) => (
              <button
                key={p.id}
                onClick={() => setOpenSymbol(p.symbol)}
                className="w-full flex items-center gap-4 p-3 rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all text-left"
              >
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-mono text-xs font-bold ${p.bias === "bullish" ? "bg-bullish/15 text-bullish" : p.bias === "bearish" ? "bg-bearish/15 text-bearish" : "bg-muted text-muted-foreground"}`}>
                  {p.symbol.slice(0, 4)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{p.symbol}</span>
                    <Badge variant="outline" className="h-5 text-[10px] capitalize border-border/60">
                      {p.strategy.replace("-", " ")}
                    </Badge>
                    <span className={`pill ${p.riskBucket === "safe" ? "pill-bullish" : p.riskBucket === "mild" ? "pill-neutral" : "pill-bearish"} capitalize`}>
                      {p.riskBucket}
                    </span>
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
              </button>
            ))}
          </div>
        </Card>

        {/* Right column */}
        <div className="space-y-6">
          <Card className="glass-card p-5">
            <h2 className="text-sm font-semibold tracking-wide mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI Summary of the Day
            </h2>
            <p className="text-sm text-foreground/80 leading-relaxed">
              Risk-on regime continues with semis leading. <span className="text-bullish font-medium">SMH +2.4%</span> dragged tech higher. IV remains compressed across mega caps — <span className="text-foreground">favor premium-selling on quality</span>. Caution: <span className="text-bearish font-medium">NVDA earnings Thursday</span>; consider closing short-dated short premium before AMC.
            </p>
          </Card>

          <Card className="glass-card p-5">
            <h2 className="text-sm font-semibold tracking-wide mb-3">Top Sectors</h2>
            <div className="space-y-2">
              {TOP_SECTORS.map((s) => {
                const up = s.change >= 0;
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="text-xs flex-1">{s.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={up ? "h-full bg-bullish" : "h-full bg-bearish"}
                        style={{ width: `${Math.min(100, Math.abs(s.change) * 30)}%` }}
                      />
                    </div>
                    <span className={`mono text-xs w-12 text-right ${up ? "text-bullish" : "text-bearish"}`}>
                      {up ? "+" : ""}{s.change}%
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

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
        </div>
      </div>

      <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
