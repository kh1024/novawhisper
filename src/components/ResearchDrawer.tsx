import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, FileText, Youtube, TrendingUp, Newspaper, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Area, Line, ReferenceLine, ReferenceDot, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useLiveQuotes, useOptionsChain, statusMeta, type OptionContract } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { useBudget } from "@/lib/budget";
import { useSettings } from "@/lib/settings";
import { NovaVerdictCard, type NovaCard } from "@/components/NovaVerdictCard";
import { SaveToPortfolioButton } from "@/components/SaveToPortfolioButton";
import { useEventRiskSignals } from "@/lib/sentimentSignals";

type Props = {
  symbol: string | null;
  onClose: () => void;
};

const SYMPATHY_MAP: Record<string, string[]> = {
  NVDA: ["AMD", "TSM", "AVGO", "ARM", "SMH"],
  AMD: ["NVDA", "TSM", "AVGO", "SMH"],
  AAPL: ["MSFT", "GOOGL", "META", "QQQ"],
  TSLA: ["NVDA", "AMD", "QQQ"],
  SPY: ["QQQ", "DIA", "IWM"],
  XLK: ["QQQ", "AAPL", "MSFT", "NVDA"],
  MSFT: ["AAPL", "GOOGL", "QQQ"],
  META: ["GOOGL", "AAPL", "QQQ"],
  AMZN: ["GOOGL", "META", "QQQ"],
  GOOGL: ["META", "AAPL", "QQQ"],
};

function genSeries(symbol: string, base: number, n = 60) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const out: { d: number; v: number; sma?: number }[] = [];
  let v = base * 0.92;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    v += ((h % 1000) / 1000 - 0.48) * (base * 0.015);
    out.push({ d: i, v: +v.toFixed(2) });
  }
  // anchor end to current spot
  out[out.length - 1].v = +base.toFixed(2);
  // 20-period simple moving average — shown as a reference trend line
  const window = Math.min(20, Math.max(5, Math.floor(n / 3)));
  for (let i = 0; i < out.length; i++) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    for (let j = start; j <= i; j++) sum += out[j].v;
    out[i].sma = +(sum / (i - start + 1)).toFixed(2);
  }
  return out;
}

/** Min/max bookmarks so we can pin them on the chart. */
function seriesExtents(s: { d: number; v: number }[]) {
  if (!s.length) return null;
  let lo = s[0], hi = s[0];
  for (const p of s) {
    if (p.v < lo.v) lo = p;
    if (p.v > hi.v) hi = p;
  }
  return { lo, hi };
}

/** Pick top scored contracts for the drawer's "Picks" tab. */
function pickTopContracts(contracts: OptionContract[], spot: number | null, limit = 4) {
  const scored = contracts
    .map((c) => {
      const mid = c.mid > 0 ? c.mid : c.last;
      const premiumPct = c.strike > 0 && mid > 0 ? (mid / c.strike) * 100 : 0;
      const annualized = c.dte > 0 ? (premiumPct * 365) / c.dte : 0;
      const liq = Math.min(40, Math.log10(Math.max(1, c.openInterest)) * 12 + Math.log10(Math.max(1, c.volume)) * 6);
      const spread = c.spreadPct > 0 ? Math.max(0, 25 - c.spreadPct) : 10;
      const yld = Math.min(30, annualized * 0.6);
      const score = Math.max(0, Math.min(100, Math.round(liq + spread + yld)));
      return { c, mid, annualized, score };
    })
    .filter((x) => x.c.dte >= 7 && x.c.dte <= 60 && x.score > 30);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function ResearchDrawer({ symbol, onClose }: Props) {
  // Live quote for the focused symbol + sympathies
  const sympathySymbols = symbol ? SYMPATHY_MAP[symbol] ?? [] : [];
  const watch = useMemo(
    () => (symbol ? Array.from(new Set([symbol, ...sympathySymbols])) : []),
    [symbol, sympathySymbols]
  );
  const { data: quotes = [], isLoading: quotesLoading } = useLiveQuotes(watch.length ? watch : undefined, {
    refetchMs: 60_000,
  });

  const q = symbol ? quotes.find((x) => x.symbol === symbol) : null;
  const meta = symbol ? TICKER_UNIVERSE.find((t) => t.symbol === symbol) : null;
  const sympathyQuotes = sympathySymbols
    .map((s) => quotes.find((x) => x.symbol === s))
    .filter(Boolean);

  // Live options chain → top picks
  const { data: chain, isLoading: chainLoading } = useOptionsChain(symbol, 200);
  const topPicks = useMemo(
    () => (chain && q ? pickTopContracts(chain.contracts, q.price) : []),
    [chain, q]
  );

  // Detect stale option data: chain loaded with contracts but every mid/last is 0
  const optionsStale = useMemo(() => {
    if (!chain || chainLoading) return false;
    if (!chain.contracts || chain.contracts.length === 0) return false;
    return chain.contracts.every((c) => (c.mid ?? 0) <= 0 && (c.last ?? 0) <= 0);
  }, [chain, chainLoading]);

  const series = useMemo(
    () => (symbol && q ? genSeries(symbol, q.price) : []),
    [symbol, q]
  );

  // Ask Nova AI explanation
  const [novaText, setNovaText] = useState<string>("");
  const [novaCard, setNovaCard] = useState<NovaCard | null>(null);
  const [novaLoading, setNovaLoading] = useState(false);
  const [budget, setBudget] = useBudget();
  const [settings] = useSettings();
  const { all: eventRiskAll } = useEventRiskSignals();

  const generateNova = async () => {
    if (!symbol || !q) return;
    if (optionsStale) {
      toast.error("Option quotes look stale — skipping Nova until live data returns.");
      return;
    }
    setNovaLoading(true);
    setNovaText("");
    setNovaCard(null);
    try {
      const { data, error } = await supabase.functions.invoke("ask-nova", {
        body: {
          symbol: q.symbol,
          name: q.name,
          sector: q.sector,
          price: q.price,
          change: q.change,
          changePct: q.changePct,
          status: q.status,
          budget,
          model: settings.aiModel,
          riskProfile: settings.riskProfile,
          eventRisk: eventRiskAll.map((e) => ({
            key: e.key,
            label: e.label,
            status: e.status,
            tone: e.tone,
            hits: e.hits,
            topHeadline: e.topHeadline ?? null,
          })),
          topPicks: topPicks.map((p) => ({
            type: p.c.type,
            strike: p.c.strike,
            expiration: p.c.expiration,
            dte: p.c.dte,
            bid: p.c.bid,
            ask: p.c.ask,
            mid: p.mid,
            last: p.c.last,
            spreadPct: p.c.spreadPct,
            volume: p.c.volume,
            openInterest: p.c.openInterest,
            annualized: p.annualized,
            score: p.score,
            delta: p.c.delta,
            iv: p.c.iv,
            theta: p.c.theta,
          })),
        },
      });
      if (error) throw error;
      setNovaCard((data?.card as NovaCard) ?? null);
      setNovaText(data?.explanation ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reach Nova";
      toast.error(msg);
    } finally {
      setNovaLoading(false);
    }
  };

  // Auto-generate Nova when drawer opens with live data ready (skip if stale)
  useEffect(() => {
    if (symbol && q && !optionsStale && !novaText && !novaCard && !novaLoading) {
      generateNova();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, q?.symbol, topPicks.length, optionsStale]);

  // Reset Nova when symbol changes
  useEffect(() => {
    setNovaText("");
    setNovaCard(null);
  }, [symbol]);

  const status = q ? statusMeta(q.status) : null;

  return (
    <Sheet open={!!symbol} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-background border-l-border p-0">
        {symbol && (
          <div className="flex flex-col">
            <SheetHeader className="p-6 border-b border-border bg-gradient-surface">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <SheetTitle className="text-2xl font-mono">{symbol}</SheetTitle>
                    {meta?.sector && <Badge variant="outline" className="text-[10px]">{meta.sector}</Badge>}
                    {status && <span className={`pill ${status.cls}`}><span className="live-dot" /> {status.label}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{q?.name ?? meta?.name ?? "Loading…"}</div>
                </div>
                <div className="text-right">
                  {quotesLoading && !q ? (
                    <Skeleton className="h-9 w-28 ml-auto" />
                  ) : q ? (
                    <>
                      <div className="mono text-3xl font-semibold">${q.price.toFixed(2)}</div>
                      <div className={`mono text-sm ${q.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({q.change >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%)
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No quote</div>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="p-6 space-y-5">
              {optionsStale && (
                <Alert variant="destructive" className="border-warning/50 bg-warning/10 text-warning">
                  <AlertTriangle className="h-4 w-4 !text-warning" />
                  <AlertTitle className="text-warning">Stale option data</AlertTitle>
                  <AlertDescription className="text-warning/90">
                    Every contract in the chain has a $0 mid/last. Skipping Nova — these prices aren't tradeable. Try again during market hours or once the feed refreshes.
                  </AlertDescription>
                </Alert>
              )}
              {/* Chart — gradient area + 20-period MA + hi/lo bookmarks */}
              {(() => {
                const ext = seriesExtents(series);
                const isUp = q ? (q.changePct ?? 0) >= 0 : true;
                const stroke = isUp ? "hsl(var(--bullish))" : "hsl(var(--bearish))";
                const gradId = `priceFill-${symbol}-${isUp ? "up" : "dn"}`;
                const last = q?.price ?? series[series.length - 1]?.v ?? 0;
                const change = q?.change ?? 0;
                const changePct = q?.changePct ?? 0;
                return (
                  <Card className="glass-card p-4 overflow-hidden">
                    <div className="flex items-end justify-between mb-3 gap-2 flex-wrap">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Price · 60d</div>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="mono text-2xl font-semibold">${last.toFixed(2)}</span>
                          <span className={`mono text-xs font-semibold ${isUp ? "text-bullish" : "text-bearish"}`}>
                            {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({Math.abs(changePct).toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 text-[10px]">
                        {ext && (
                          <>
                            <span className="px-1.5 py-0.5 rounded border border-bullish/40 bg-bullish/10 text-bullish font-mono">
                              H ${ext.hi.v.toFixed(2)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border border-bearish/40 bg-bearish/10 text-bearish font-mono">
                              L ${ext.lo.v.toFixed(2)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded border border-border bg-surface/60 text-muted-foreground font-mono">
                              SMA20
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="h-48">
                      {q ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.35} />
                            <XAxis dataKey="d" hide />
                            <YAxis
                              domain={["auto", "auto"]}
                              orientation="right"
                              width={48}
                              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                              tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--popover))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                              labelFormatter={(d) => `Day ${Number(d) + 1}`}
                              formatter={(value: number, name) =>
                                [`$${Number(value).toFixed(2)}`, name === "sma" ? "SMA20" : "Price"]
                              }
                            />
                            <ReferenceLine y={last} stroke={stroke} strokeDasharray="4 4" strokeOpacity={0.55} />
                            <Area
                              type="monotone"
                              dataKey="v"
                              stroke="none"
                              fill={`url(#${gradId})`}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="sma"
                              stroke="hsl(var(--muted-foreground))"
                              strokeWidth={1}
                              strokeDasharray="3 3"
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="v"
                              stroke={stroke}
                              strokeWidth={2.25}
                              dot={false}
                              isAnimationActive={false}
                            />
                            {ext && (
                              <>
                                <ReferenceDot x={ext.hi.d} y={ext.hi.v} r={3} fill="hsl(var(--bullish))" stroke="hsl(var(--background))" strokeWidth={1.5} />
                                <ReferenceDot x={ext.lo.d} y={ext.lo.v} r={3} fill="hsl(var(--bearish))" stroke="hsl(var(--background))" strokeWidth={1.5} />
                              </>
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <Skeleton className="h-full w-full" />
                      )}
                    </div>
                  </Card>
                );
              })()}

              {/* Live indicators row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: "Volume", v: q ? (q.volume / 1_000_000).toFixed(1) + "M" : "—" },
                  { k: "Sources", v: q ? `${Object.values(q.sources).filter(Boolean).length}/2` : "—" },
                  { k: "Consensus", v: q?.consensusSource ?? "—" },
                  { k: "Diff", v: q?.diffPct != null ? q.diffPct.toFixed(2) + "%" : "—" },
                ].map((m) => (
                  <Card key={m.k} className="glass-card p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.k}</div>
                    <div className="mono text-sm font-semibold mt-1 capitalize truncate">{m.v}</div>
                  </Card>
                ))}
              </div>

              <Tabs defaultValue="why">
                <TabsList className="bg-surface/60 w-full justify-start">
                  <TabsTrigger value="why">Ask Nova</TabsTrigger>
                  <TabsTrigger value="picks">Live Picks</TabsTrigger>
                  <TabsTrigger value="sym">Sympathy</TabsTrigger>
                </TabsList>

                <TabsContent value="why" className="mt-4">
                  <Card className="glass-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" /> Nova — AI analyst note
                      </div>
                      <Button size="sm" variant="ghost" onClick={generateNova} disabled={novaLoading || !q} className="gap-1.5 h-7">
                        <RefreshCw className={`h-3 w-3 ${novaLoading ? "animate-spin" : ""}`} />
                        Regenerate
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-surface/40 border border-border/50 flex-wrap">
                      <label htmlFor="nova-budget" className="text-xs text-muted-foreground whitespace-nowrap">
                        💰 Your budget
                      </label>
                      <div className="relative flex-1 min-w-[110px] max-w-[160px]">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <input
                          id="nova-budget"
                          type="number"
                          min={50}
                          max={1000000}
                          step={50}
                          value={budget}
                          onChange={(e) => setBudget(Math.max(50, Number(e.target.value) || 0))}
                          className="w-full h-7 pl-5 pr-2 text-sm font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {[250, 500, 1000, 2500].map((v) => (
                          <button
                            key={v}
                            onClick={() => setBudget(v)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                              budget === v
                                ? "bg-primary/20 border-primary text-primary"
                                : "border-border text-muted-foreground hover:bg-surface"
                            }`}
                          >
                            ${v >= 1000 ? `${v / 1000}k` : v}
                          </button>
                        ))}
                      </div>
                    </div>
                    {novaLoading && !novaCard && (
                      <div className="space-y-2">
                        <Skeleton className="h-24 w-full rounded-lg" />
                        <Skeleton className="h-16 w-full rounded-lg" />
                      </div>
                    )}
                    {novaCard && (
                      <NovaVerdictCard card={{ ...novaCard, full_analysis_md: novaCard.full_analysis_md ?? novaText }} />
                    )}
                    {!novaLoading && !novaCard && novaText && (
                      <div className="text-sm text-foreground/90 leading-relaxed space-y-2 [&_strong]:text-foreground [&_strong]:font-semibold [&_p]:my-1.5 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:list-disc [&_li]:my-0.5 [&_code]:bg-surface/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_em]:text-muted-foreground [&_em]:not-italic">
                        <ReactMarkdown>{novaText}</ReactMarkdown>
                      </div>
                    )}
                    {!novaLoading && !novaCard && !novaText && q && (
                      <div className="text-xs text-muted-foreground">Click Regenerate to ask Nova.</div>
                    )}
                  </Card>
                </TabsContent>

                <TabsContent value="picks" className="mt-4 space-y-2">
                  {chainLoading && (
                    <div className="text-sm text-muted-foreground p-4 text-center flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading live chain…
                    </div>
                  )}
                  {!chainLoading && topPicks.length === 0 && (
                    <div className="text-sm text-muted-foreground p-4 text-center">No qualifying contracts in 7–60 DTE window.</div>
                  )}
                  {topPicks.map(({ c, mid, annualized, score }) => {
                    const absDelta = c.delta != null ? Math.abs(c.delta) : null;
                    const risk =
                      absDelta == null
                        ? { label: "?", cls: "bg-muted text-muted-foreground border-border", tip: "No delta data" }
                        : absDelta >= 0.7
                        ? { label: "🟢 Safe", cls: "bg-bullish/15 text-bullish border-bullish/40", tip: "Deep ITM · Δ ≥ 0.70 · acts like the stock" }
                        : absDelta >= 0.4
                        ? { label: "🟡 Mild", cls: "bg-warning/15 text-warning border-warning/40", tip: "Balanced · Δ 0.40–0.69 · 2–5 day swing" }
                        : { label: "🔴 Aggressive", cls: "bg-bearish/15 text-bearish border-bearish/40", tip: "OTM · Δ < 0.40 · high theta decay" };
                    const cost = mid * 100;
                    const inBudget = cost <= budget;
                    return (
                    <Card key={c.ticker} className="glass-card p-3 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${risk.cls}`} title={risk.tip}>
                            {risk.label}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${inBudget ? "bg-bullish/10 text-bullish border-bullish/30" : "bg-bearish/10 text-bearish border-bearish/30"}`} title={inBudget ? `Affords ${Math.floor(budget / cost)}x at $${budget}` : `Over your $${budget} budget`}>
                            ${cost.toFixed(0)}{inBudget ? ` · ${Math.floor(budget / cost)}x` : " 🚫"}
                          </span>
                        </div>
                        <div className="text-sm font-medium capitalize mt-1">
                          {c.type} ${c.strike} <span className="text-muted-foreground text-xs">· exp {c.expiration.slice(5)} · {c.dte}d</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mono">
                          mid ${mid.toFixed(2)}
                          {c.delta != null && ` · Δ${c.delta.toFixed(2)}`}
                          {c.iv != null && ` · IV ${(c.iv * 100).toFixed(0)}%`}
                          · OI {c.openInterest.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="mono text-bullish">{annualized.toFixed(1)}% ann.</div>
                        <div className="text-muted-foreground">spread {c.spreadPct.toFixed(1)}%</div>
                      </div>
                      <div className="mono text-lg font-semibold w-10 text-right">{score}</div>
                      <SaveToPortfolioButton
                        size="xs"
                        symbol={symbol}
                        optionType={c.type}
                        direction="long"
                        strike={c.strike}
                        expiry={c.expiration}
                        contracts={1}
                        entryPremium={mid > 0 ? mid : null}
                        entryUnderlying={q?.price ?? null}
                        thesis={`Drawer pick · score ${score} · ${annualized.toFixed(0)}% ann.`}
                        source="research-drawer"
                      />
                    </Card>
                    );
                  })}
                </TabsContent>

                <TabsContent value="sym" className="mt-4 space-y-2">
                  <div className="text-xs text-muted-foreground mb-2">
                    Related plays moving with {symbol}
                  </div>
                  {sympathyQuotes.length === 0 && (
                    <div className="text-sm text-muted-foreground p-4 text-center">No sympathy mapping for this symbol yet.</div>
                  )}
                  {sympathyQuotes.map((s) => s && (
                    <Card key={s.symbol} className="glass-card p-3 flex items-center gap-3">
                      <div className="font-mono font-semibold w-16">{s.symbol}</div>
                      <div className="flex-1 text-xs text-muted-foreground truncate">{s.name}</div>
                      <div className="mono text-sm">${s.price.toFixed(2)}</div>
                      <div className={`mono text-xs w-16 text-right ${s.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {s.change >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
                      </div>
                    </Card>
                  ))}
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`https://robinhood.com/options/chains/${symbol}`} target="_blank" rel="noreferrer">
                    <TrendingUp className="h-3.5 w-3.5" />Robinhood
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`https://www.tradingview.com/symbols/${symbol}/`} target="_blank" rel="noreferrer">
                    <TrendingUp className="h-3.5 w-3.5" />TradingView
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`https://finance.yahoo.com/quote/${symbol}/news`} target="_blank" rel="noreferrer">
                    <Newspaper className="h-3.5 w-3.5" />News
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`https://www.youtube.com/results?search_query=${symbol}+stock`} target="_blank" rel="noreferrer">
                    <Youtube className="h-3.5 w-3.5" />YouTube
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${symbol}&type=10-K&dateb=&owner=include&count=40`} target="_blank" rel="noreferrer">
                    <FileText className="h-3.5 w-3.5" />SEC
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
