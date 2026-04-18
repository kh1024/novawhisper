// Planning ("Internet Talk") — synthesizes YouTube creator chatter + our quotes
// into a ranked next-session watchlist using Lovable AI.
import { useState } from "react";
import { Brain, Flame, Youtube, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Minus, Globe, Shield, Zap, Target, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePlanning, type PlanningPick, type SourceTicker } from "@/lib/planning";
import { useOptionsScout, type ScoutPick } from "@/lib/optionsScout";
import { useWebPicksHistory, type HistoryRun } from "@/lib/webPicksHistory";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

function biasIcon(b: string) {
  if (b === "bullish" || b === "bull") return <TrendingUp className="h-3.5 w-3.5" />;
  if (b === "bearish" || b === "bear" || b === "fade") return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}
function biasClass(b: string) {
  if (b === "bullish" || b === "bull") return "text-bullish border-bullish/40 bg-bullish/10";
  if (b === "bearish" || b === "bear" || b === "fade") return "text-bearish border-bearish/40 bg-bearish/10";
  return "text-muted-foreground border-border bg-muted/30";
}

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function Planning() {
  const [includeYouTube, setIncludeYouTube] = useState(true);
  const [ytQuery, setYtQuery] = useState("stock market today options unusual activity");
  const [pendingQuery, setPendingQuery] = useState(ytQuery);
  const qc = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = usePlanning({ includeYouTube, ytQuery });

  const picks = data?.synthesis?.picks ?? [];
  const tone = data?.synthesis?.marketTone ?? "";
  const ytTickers = data?.sources?.youtube?.tickers ?? [];
  const ytVideos = data?.sources?.youtube?.videos ?? [];
  const quotes = data?.sources?.quotes ?? [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Brain className="h-3.5 w-3.5" /> Planning · Internet Talk
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Tomorrow's Watchlist</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            YouTube creator chatter + our verified quotes, synthesized by Nova AI into a ranked next-session plan.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <Switch id="yt" checked={includeYouTube} onCheckedChange={setIncludeYouTube} />
            <Label htmlFor="yt" className="text-xs">YouTube</Label>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="ytq" className="text-[10px] uppercase tracking-widest text-muted-foreground">YT Query</Label>
              <Input id="ytq" value={pendingQuery} onChange={(e) => setPendingQuery(e.target.value)} className="h-9 w-72" />
            </div>
            <Button variant="secondary" size="sm" onClick={() => setYtQuery(pendingQuery)} disabled={pendingQuery === ytQuery}>Apply</Button>
          </div>
          <Button size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["planning"] }); refetch(); }} disabled={isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Re-synthesize
          </Button>
        </div>
      </div>

      {/* Market tone banner */}
      {tone && (
        <Card className="border-primary/30 bg-gradient-glow p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/20 p-2"><Brain className="h-4 w-4 text-primary" /></div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Market tone · Nova</div>
              <p className="mt-0.5 text-sm text-foreground">{tone}</p>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-bearish/40 bg-bearish/5 p-4 text-sm text-bearish">
          Failed to synthesize: {(error as Error).message}. Try Re-synthesize.
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : (
        <>
          {/* AI Picks grid */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Flame className="h-3.5 w-3.5" /> AI Picks · next session
            </div>
            {picks.length === 0 ? (
              <Card className="p-6 text-sm text-muted-foreground">
                No synthesized picks yet. Try Re-synthesize, or check that the YOUTUBE_API_KEY is valid.
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {picks.map((p) => <PickCard key={p.symbol} pick={p} />)}
              </div>
            )}
          </div>

          {/* Sources tabs */}
          <Tabs defaultValue="webpicks" className="mt-2">
            <TabsList>
              <TabsTrigger value="webpicks"><Globe className="mr-1.5 h-3.5 w-3.5" /> Web Picks</TabsTrigger>
              <TabsTrigger value="history"><History className="mr-1.5 h-3.5 w-3.5" /> History</TabsTrigger>
              <TabsTrigger value="youtube" disabled={!includeYouTube || !data?.sources?.youtube}><Youtube className="mr-1.5 h-3.5 w-3.5" /> YouTube</TabsTrigger>
              <TabsTrigger value="quotes"><Flame className="mr-1.5 h-3.5 w-3.5" /> Quotes</TabsTrigger>
            </TabsList>

            <TabsContent value="webpicks" className="mt-3">
              <WebPicksPanel />
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              <HistoryPanel />
            </TabsContent>

            <TabsContent value="youtube" className="mt-3">
              {data?.sources?.youtube ? (
                <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                  <Card className="p-4">
                    <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">Top tickers · creators</div>
                    <div className="space-y-1.5">
                      {ytTickers.slice(0, 15).map((t) => <TickerRow key={t.symbol} t={t} />)}
                    </div>
                  </Card>
                  <Card className="p-0">
                    <ScrollArea className="h-[520px]">
                      <div className="divide-y divide-border/60">
                        {ytVideos.map((v) => (
                          <div key={v.id} className="p-3">
                            <a href={v.url} target="_blank" rel="noreferrer" className="flex gap-3 hover:bg-accent/30 -m-1 p-1 rounded">
                              {v.thumbnail && <img src={v.thumbnail} alt="" className="h-16 w-28 flex-none rounded object-cover" />}
                              <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{v.channel} · {compact(v.views)} views</div>
                                <div className="mt-0.5 text-sm text-foreground line-clamp-2">{v.title}</div>
                                {v.tickers.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {v.tickers.slice(0, 6).map((s) => <Badge key={s} variant="secondary" className="text-[10px] font-mono">{s}</Badge>)}
                                  </div>
                                )}
                              </div>
                            </a>
                            {v.comments.length > 0 && (
                              <div className="mt-2 ml-2 space-y-1 border-l border-border/60 pl-3">
                                {v.comments.slice(0, 3).map((c, i) => (
                                  <div key={i} className="text-xs text-muted-foreground line-clamp-2">
                                    <span className="font-medium text-foreground/80">{c.author}:</span> {c.text}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </Card>
                </div>
              ) : (
                <Card className="p-4 text-sm text-muted-foreground">YouTube disabled.</Card>
              )}
            </TabsContent>

            <TabsContent value="quotes" className="mt-3">
              <Card className="p-4">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {quotes.map((q) => (
                    <div key={q.symbol} className="flex items-center justify-between rounded-md border border-border/60 bg-surface/40 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{q.symbol}</span>
                        <span className="text-xs text-muted-foreground">${q.price?.toFixed(2)}</span>
                      </div>
                      <span className={cn("text-xs", q.changePct >= 0 ? "text-bullish" : "text-bearish")}>
                        {q.changePct >= 0 ? "+" : ""}{q.changePct?.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: PlanningPick }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-lg font-semibold">{pick.symbol}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge variant="outline" className={cn("text-[10px]", biasClass(pick.bias))}>
              {biasIcon(pick.bias)} <span className="ml-1 capitalize">{pick.bias}</span>
            </Badge>
            <Badge variant="secondary" className="text-[10px]">Conviction {pick.conviction}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {pick.sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] capitalize">{s}</Badge>
          ))}
        </div>
      </div>
      <p className="mt-3 text-sm text-foreground/90">{pick.thesis}</p>

      <OptionContract
        symbol={pick.symbol}
        optionType={pick.optionType}
        direction={pick.direction}
        strike={pick.strike}
        strikeShort={pick.strikeShort}
        expiry={pick.expiry}
        playAt={pick.playAt}
        premiumEstimate={pick.premiumEstimate}
      />

      {pick.catalysts.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Catalysts</div>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
            {pick.catalysts.map((c, i) => <li key={i} className="flex gap-1.5"><span className="text-bullish">▸</span> {c}</li>)}
          </ul>
        </div>
      )}
      {pick.risks.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Risks</div>
          <ul className="mt-1 space-y-0.5 text-xs text-foreground/80">
            {pick.risks.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-bearish">▸</span> {r}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function OptionContract({ symbol, optionType, direction, strike, strikeShort, expiry, playAt, premiumEstimate }: {
  symbol: string;
  optionType: string;
  direction: string;
  strike: number;
  strikeShort?: number;
  expiry: string;
  playAt: number;
  premiumEstimate?: string;
}) {
  const isCall = optionType.includes("call") || optionType === "straddle" || optionType === "strangle";
  const tone = direction === "long" && isCall ? "text-bullish" : direction === "long" && optionType.includes("put") ? "text-bearish" : "text-foreground";
  const typeLabel = optionType.replace("_", " ");
  const strikeLabel = strikeShort ? `${strike}/${strikeShort}` : String(strike);
  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Contract</div>
      <div className={cn("mt-0.5 font-mono text-sm font-semibold", tone)}>
        {direction.toUpperCase()} {symbol} ${strikeLabel} {typeLabel.toUpperCase()} · {expiry}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div><span className="text-muted-foreground">Play at: </span><span className="font-mono text-foreground/90">${playAt?.toFixed(2)}</span></div>
        {premiumEstimate && <div><span className="text-muted-foreground">Premium: </span><span className="font-mono text-foreground/90">{premiumEstimate}</span></div>}
      </div>
    </div>
  );
}


function TickerRow({ t }: { t: SourceTicker }) {
  const top = t.topPost ?? t.topVideo;
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-surface/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-sm font-semibold">{t.symbol}</span>
        <span className={cn("rounded-sm border px-1.5 py-0.5 text-[10px]", biasClass(t.bias))}>{biasIcon(t.bias)}</span>
        <span className="text-[10px] text-muted-foreground">{t.mentions}× · heat {t.heat}</span>
      </div>
      {top && (
        <a href={"url" in top ? top.url : "#"} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function WebPicksPanel() {
  const { data, isLoading, isFetching, error, refetch } = useOptionsScout(true);
  const qc = useQueryClient();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-bearish/40 bg-bearish/5 p-4 text-sm text-bearish">
        Couldn't scrape options ideas: {(error as Error).message}.
        <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>Retry</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Live web scout · Firecrawl + Nova</div>
          <p className="mt-0.5 text-sm text-foreground/90">{data?.marketRead}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => { qc.invalidateQueries({ queryKey: ["options-scout"] }); refetch(); }} disabled={isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
          Re-scrape
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <BucketColumn title="Safe" tone="bullish" icon={<Shield className="h-3.5 w-3.5" />} blurb="Income & hedging" picks={data?.safe ?? []} />
        <BucketColumn title="Mild" tone="neutral" icon={<Target className="h-3.5 w-3.5" />} blurb="Defined-risk directional" picks={data?.mild ?? []} />
        <BucketColumn title="Aggressive" tone="bearish" icon={<Zap className="h-3.5 w-3.5" />} blurb="High risk / high reward" picks={data?.aggressive ?? []} />
      </div>

      {data?.sources && data.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span className="uppercase tracking-widest">Sources scraped:</span>
          {data.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 hover:text-foreground">
              {s.name} <ExternalLink className="h-2.5 w-2.5" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function BucketColumn({ title, tone, icon, blurb, picks }: { title: string; tone: "bullish" | "neutral" | "bearish"; icon: React.ReactNode; blurb: string; picks: ScoutPick[] }) {
  const toneClass =
    tone === "bullish" ? "border-bullish/40 bg-bullish/5" :
    tone === "bearish" ? "border-bearish/40 bg-bearish/5" :
    "border-border bg-surface/40";
  const chipClass =
    tone === "bullish" ? "text-bullish bg-bullish/10 border-bullish/40" :
    tone === "bearish" ? "text-bearish bg-bearish/10 border-bearish/40" :
    "text-foreground bg-muted/40 border-border";
  return (
    <Card className={cn("p-3", toneClass)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-widest", chipClass)}>
            {icon} {title}
          </span>
          <span className="text-[10px] text-muted-foreground">{blurb}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{picks.length}</span>
      </div>
      <div className="mt-3 space-y-2">
        {picks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">No ideas in this bucket right now.</div>
        ) : picks.map((p, i) => (
          <div key={i} className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-semibold">{p.symbol}</span>
              <Badge variant="outline" className="text-[10px]">{p.strategy}</Badge>
            </div>
            <p className="mt-1.5 text-xs text-foreground/90">{p.thesis}</p>
            <OptionContract
              symbol={p.symbol}
              optionType={p.optionType}
              direction={p.direction}
              strike={p.strike}
              strikeShort={p.strikeShort}
              expiry={p.expiry}
              playAt={p.playAt}
              premiumEstimate={p.premiumEstimate}
            />
            <div className="mt-2 space-y-1 text-[11px]">
              <div><span className="text-muted-foreground">Risk: </span><span className="text-foreground/80">{p.risk}</span></div>
              <div className="text-[10px] text-muted-foreground italic">via {p.source}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

