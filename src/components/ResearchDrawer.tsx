import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, FileText, Youtube, TrendingUp, Newspaper, RefreshCw, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { useLiveQuotes, useOptionsChain, statusMeta, type OptionContract } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const out: { d: number; v: number }[] = [];
  let v = base * 0.92;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    v += ((h % 1000) / 1000 - 0.48) * (base * 0.015);
    out.push({ d: i, v: +v.toFixed(2) });
  }
  // anchor end to current spot
  out[out.length - 1].v = +base.toFixed(2);
  return out;
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

  const series = useMemo(
    () => (symbol && q ? genSeries(symbol, q.price) : []),
    [symbol, q]
  );

  // Ask Nova AI explanation
  const [novaText, setNovaText] = useState<string>("");
  const [novaLoading, setNovaLoading] = useState(false);

  const generateNova = async () => {
    if (!symbol || !q) return;
    setNovaLoading(true);
    setNovaText("");
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
          topPicks: topPicks.map((p) => ({
            type: p.c.type,
            strike: p.c.strike,
            expiration: p.c.expiration,
            dte: p.c.dte,
            mid: p.mid,
            annualized: p.annualized,
            score: p.score,
            delta: p.c.delta,
            iv: p.c.iv,
          })),
        },
      });
      if (error) throw error;
      setNovaText(data?.explanation ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to reach Nova";
      toast.error(msg);
    } finally {
      setNovaLoading(false);
    }
  };

  // Auto-generate Nova when drawer opens with live data ready
  useEffect(() => {
    if (symbol && q && !novaText && !novaLoading) {
      generateNova();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, q?.symbol, topPicks.length]);

  // Reset Nova when symbol changes
  useEffect(() => {
    setNovaText("");
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
              {/* Chart */}
              <Card className="glass-card p-4">
                <div className="text-xs text-muted-foreground mb-2">Price (60d, anchored to live spot)</div>
                <div className="h-40">
                  {q ? (
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
                  ) : (
                    <Skeleton className="h-full w-full" />
                  )}
                </div>
              </Card>

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
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" /> Nova — AI analyst note
                      </div>
                      <Button size="sm" variant="ghost" onClick={generateNova} disabled={novaLoading || !q} className="gap-1.5 h-7">
                        <RefreshCw className={`h-3 w-3 ${novaLoading ? "animate-spin" : ""}`} />
                        Regenerate
                      </Button>
                    </div>
                    {novaLoading && !novaText && (
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-[92%]" />
                        <Skeleton className="h-3 w-[78%]" />
                        <Skeleton className="h-3 w-[85%]" />
                      </div>
                    )}
                    {novaText && (
                      <div className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
                        {novaText}
                      </div>
                    )}
                    {!novaLoading && !novaText && q && (
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
                  {topPicks.map(({ c, mid, annualized, score }) => (
                    <Card key={c.ticker} className="glass-card p-3 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="text-sm font-medium capitalize">
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
                    </Card>
                  ))}
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

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
