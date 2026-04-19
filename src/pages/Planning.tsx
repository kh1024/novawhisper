// Planning ("Internet Talk") — synthesizes YouTube creator chatter + our quotes
// into a ranked next-session watchlist using Lovable AI.
import { useEffect, useMemo, useState } from "react";
import { Brain, Flame, Youtube, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Minus, Globe, Shield, Zap, Target, History, AlertTriangle } from "lucide-react";
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
import { useWebPicksHistory } from "@/lib/webPicksHistory";
import { SaveToPortfolioButton } from "@/components/SaveToPortfolioButton";
import { TickerPrice } from "@/components/TickerPrice";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/settings";
import { dispatchPickAlerts } from "@/lib/webhook";
import { useLiveQuotes } from "@/lib/liveData";
import { usePickExpiration, type PickInputs, type PickStatus } from "@/lib/pickExpiration";
import { PickExpiryChips } from "@/components/PickExpiryChips";
import { evaluateGuards, type GuardEval } from "@/lib/novaGuards";
import { useSma200 } from "@/lib/sma200";
import { NovaGuardBadges } from "@/components/NovaGuardBadges";
import { PickMetaChips } from "@/components/PickMetaChips";
import { NovaFilterBar } from "@/components/NovaFilterBar";
import { useNovaFilter, pickMatchesFilter } from "@/lib/novaFilter";

// Parse a premium-estimate string ("$2.50", "$1.20–$1.50", "≈$3") down to the
// lowest dollar value so the budget gate (premium × 100 ≤ budget) is generous.
function parsePremiumEstimate(s?: string | null): number | null {
  if (!s) return null;
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const v = Math.min(...nums.map(Number));
  return Number.isFinite(v) ? v : null;
}

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
          {/* AI Picks grid — fixed slots: 3 Safe + 2 Mild + 1 Aggressive */}
          <SlottedPicks picks={picks} />

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

// ── Risk classification + slotted layout ─────────────────────────────────
type RiskTier = "safe" | "mild" | "aggressive";

/**
 * Classify a pick into Safe / Mild / Aggressive using a "fund-manager" rubric:
 *
 *   Safe       → Deep ITM (≥3%) single-leg with ≥21 DTE, OR a high-conviction spread (defined risk).
 *                Stock-replacement style: high delta, low decay, lots of runway.
 *
 *   Mild       → Near-the-money (within ±3%) single-leg with reasonable DTE (≥14),
 *                OR a B-conviction spread.
 *
 *   Aggressive → ATM single-leg (|moneyness| < 1%) for max gamma without paying for deep premium,
 *                OR any spread that didn't qualify above (defined-risk leverage),
 *                OR a clearly OTM (≤−3%) directional bet,
 *                OR a very short-dated (<7 DTE) play.
 *
 * Volatility-trap heuristic (no live IVP/RSI yet, so we proxy):
 *   - Aggressive single-leg that is actually DEEP ITM (≥10%) → leveraged-at-the-top trap.
 *   - Aggressive call/put with conviction C and DTE < 7 → "lotto on weak conviction" trap.
 *   - Aggressive single-leg that is far OTM (≤−7%) on short DTE (<14) → premium-burn trap.
 */
function evalRisk(p: PlanningPick): { tier: RiskTier; volatilityTrap: boolean; trapReason?: string } {
  const dte = Math.max(0, Math.round((new Date(p.expiry + "T16:00:00Z").getTime() - Date.now()) / 86_400_000));
  const isCall = p.optionType.includes("call") || p.optionType === "straddle" || p.optionType === "strangle";
  const isPut = p.optionType.includes("put");
  const playAt = Number(p.playAt) || 0;
  const strike = Number(p.strike) || 0;
  let itmPct = 0;
  if (playAt > 0 && strike > 0) {
    if (isCall) itmPct = ((playAt - strike) / strike) * 100;
    else if (isPut) itmPct = ((strike - playAt) / strike) * 100;
  }
  const isSpread = p.optionType.includes("spread");
  const absMoney = Math.abs(itmPct);

  let tier: RiskTier;
  if (!isSpread && itmPct >= 3 && dte >= 21) {
    tier = "safe"; // Deep ITM stock-replacement
  } else if (isSpread && p.conviction === "A" && dte >= 14) {
    tier = "safe"; // High-conviction defined-risk spread
  } else if (!isSpread && absMoney <= 3 && dte >= 14 && p.conviction !== "C") {
    tier = "mild"; // Near-the-money, decent DTE, decent conviction
  } else if (isSpread && p.conviction === "B") {
    tier = "mild";
  } else {
    tier = "aggressive";
  }

  // Volatility-trap detection (only meaningful for the Aggressive tier).
  let volatilityTrap = false;
  let trapReason: string | undefined;
  if (tier === "aggressive" && !isSpread) {
    if (itmPct >= 10) {
      volatilityTrap = true;
      trapReason = `Deep ITM (+${itmPct.toFixed(1)}%) on a single leg — paying intrinsic at the top. Prefer a vertical spread.`;
    } else if (p.conviction === "C" && dte < 7) {
      volatilityTrap = true;
      trapReason = `Low conviction + <7 DTE — lotto ticket, premium will decay fast.`;
    } else if (itmPct <= -7 && dte < 14) {
      volatilityTrap = true;
      trapReason = `Far OTM (${itmPct.toFixed(1)}%) with <2 weeks to expiry — high IV burn risk.`;
    }
  }

  return { tier, volatilityTrap, trapReason };
}

function classifyRisk(p: PlanningPick): RiskTier {
  return evalRisk(p).tier;
}


const TIER_META: Record<RiskTier, { label: string; icon: typeof Shield; cls: string; chipCls: string }> = {
  safe:       { label: "Safe",       icon: Shield, cls: "border-bullish/30 bg-bullish/5",   chipCls: "text-bullish border-bullish/40 bg-bullish/10" },
  mild:       { label: "Mild",       icon: Target, cls: "border-warning/30 bg-warning/5",   chipCls: "text-warning border-warning/40 bg-warning/10" },
  aggressive: { label: "Aggressive", icon: Zap,    cls: "border-bearish/30 bg-bearish/5",   chipCls: "text-bearish border-bearish/40 bg-bearish/10" },
};

const SLOTS: { tier: RiskTier; index: number }[] = [
  { tier: "safe", index: 1 }, { tier: "safe", index: 2 }, { tier: "safe", index: 3 },
  { tier: "mild", index: 1 }, { tier: "mild", index: 2 },
  { tier: "aggressive", index: 1 },
];

function rankPick(p: PlanningPick): number {
  // Higher = better. Conviction A=3, B=2, C=1.
  const conv = p.conviction === "A" ? 3 : p.conviction === "B" ? 2 : 1;
  return conv * 10 + (p.sources?.length ?? 0);
}

function SlottedPicks({ picks }: { picks: PlanningPick[] }) {
  // Bucket + rank
  const buckets: Record<RiskTier, PlanningPick[]> = { safe: [], mild: [], aggressive: [] };
  for (const p of picks) buckets[classifyRisk(p)].push(p);
  (Object.keys(buckets) as RiskTier[]).forEach((k) => buckets[k].sort((a, b) => rankPick(b) - rankPick(a)));
  const cursors: Record<RiskTier, number> = { safe: 0, mild: 0, aggressive: 0 };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Flame className="h-3.5 w-3.5" /> AI Picks · next session
        <span className="font-mono normal-case tracking-normal text-[10px] text-muted-foreground/70">
          · 3 Safe + 2 Mild + 1 Aggressive
        </span>
      </div>
      {picks.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No synthesized picks yet. Try Re-synthesize, or check that the YOUTUBE_API_KEY is valid.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SLOTS.map((slot, i) => {
            const pick = buckets[slot.tier][cursors[slot.tier]++];
            return pick
              ? <PickCard key={`${slot.tier}-${slot.index}-${pick.symbol}`} pick={pick} tier={slot.tier} slotIndex={slot.index} />
              : <EmptySlot key={`empty-${i}`} tier={slot.tier} slotIndex={slot.index} />;
          })}
        </div>
      )}
    </div>
  );
}

function EmptySlot({ tier, slotIndex }: { tier: RiskTier; slotIndex: number }) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <Card className={cn("flex flex-col items-center justify-center p-6 text-center border-dashed", meta.cls)}>
      <span className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", meta.chipCls)}>
        <Icon className="h-3 w-3" /> {meta.label} #{slotIndex}
      </span>
      <div className="mt-3 text-sm font-semibold text-foreground/90">No qualifying setup</div>
      <p className="mt-1 text-xs text-muted-foreground max-w-[18rem]">
        Nova didn't find a {meta.label.toLowerCase()} candidate that clears the bar for tomorrow. Best move: <span className="text-foreground font-medium">sit this slot out.</span>
      </p>
    </Card>
  );
}

function PickCard({ pick, tier, slotIndex }: { pick: PlanningPick; tier?: RiskTier; slotIndex?: number }) {
  const tierMeta = tier ? TIER_META[tier] : null;
  const TierIcon = tierMeta?.icon;
  const { volatilityTrap, trapReason } = evalRisk(pick);
  return (
    <Card className={cn("flex flex-col p-4", tierMeta?.cls, volatilityTrap && "ring-1 ring-warning/50")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {tierMeta && TierIcon && (
              <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", tierMeta.chipCls)}>
                <TierIcon className="h-3 w-3" /> {tierMeta.label}{slotIndex ? ` #${slotIndex}` : ""}
              </span>
            )}
            <span className="font-mono text-lg font-semibold">{pick.symbol}</span>
            <TickerPrice symbol={pick.symbol} showChange />
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn("text-[10px]", biasClass(pick.bias))}>
              {biasIcon(pick.bias)} <span className="ml-1 capitalize">{pick.bias}</span>
            </Badge>
            <Badge variant="secondary" className="text-[10px]">Conviction {pick.conviction}</Badge>
            {volatilityTrap && (
              <Badge
                variant="outline"
                className="text-[10px] border-warning/50 bg-warning/10 text-warning gap-1"
                title={trapReason}
              >
                <AlertTriangle className="h-2.5 w-2.5" /> Volatility Trap
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1 shrink-0">
          {pick.sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] capitalize">{s}</Badge>
          ))}
        </div>
      </div>
      {volatilityTrap && trapReason && (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning leading-snug">
          <span className="font-semibold">⚠ Volatility Trap · </span>{trapReason}
        </div>
      )}
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
      <div className="mt-3 flex justify-end">
        <SaveToPortfolioButton
          symbol={pick.symbol}
          optionType={pick.optionType}
          direction={pick.direction}
          strike={pick.strike}
          strikeShort={pick.strikeShort}
          expiry={pick.expiry}
          entryUnderlying={pick.playAt}
          thesis={pick.thesis}
          source="planning"
        />
      </div>
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
        <TickerPrice symbol={t.symbol} />
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

function pickKey(p: ScoutPick): string {
  return `webpick:${p.symbol}:${p.strategy}:${p.optionType}:${p.strike}:${p.strikeShort ?? "_"}:${p.expiry}`;
}

function WebPicksPanel() {
  const { data, isLoading, isFetching, error, refetch } = useOptionsScout(true);
  const qc = useQueryClient();
  const [settings] = useSettings();

  // Collect every pick across tiers + their stable keys so the expiration
  // engine has a single flat list to chew on.
  const allPicks = useMemo(() => {
    if (!data) return [] as { tier: "safe" | "mild" | "aggressive"; pick: ScoutPick }[];
    return [
      ...(data.safe ?? []).map((p) => ({ tier: "safe" as const, pick: p })),
      ...(data.mild ?? []).map((p) => ({ tier: "mild" as const, pick: p })),
      ...(data.aggressive ?? []).map((p) => ({ tier: "aggressive" as const, pick: p })),
    ];
  }, [data]);

  // Pull live quotes so the engine can compute price-drift since the pick was
  // first surfaced (the playAt baseline is captured per-pick on first sight).
  const symbols = useMemo(() => Array.from(new Set(allPicks.map((x) => x.pick.symbol))), [allPicks]);
  const { data: quotes = [] } = useLiveQuotes(symbols.length ? symbols : undefined, { refetchMs: 60_000 });
  const quoteMap = useMemo(() => new Map(quotes.map((q) => [q.symbol, q])), [quotes]);

  const expiryInputs = useMemo<PickInputs[]>(() => allPicks.map(({ pick: p }) => ({
    key: pickKey(p),
    price: quoteMap.get(p.symbol)?.price ?? p.playAt ?? null,
    rsi: null,             // scout doesn't surface RSI yet — RSI flip is no-op here
    verdict: null,
    theta: null,
    confidence: null,
  })), [allPicks, quoteMap]);
  const expiryStatus = usePickExpiration(expiryInputs);

  // Fire a GO webhook for each fresh pick the scout returns. Skip stale or
  // timed-out picks so we don't push old setups to the webhook.
  useEffect(() => {
    if (allPicks.length === 0) return;
    const live = allPicks.filter(({ pick }) => {
      const s = expiryStatus.get(pickKey(pick));
      return !(s?.isStale || s?.isTimedOut);
    });
    if (live.length === 0) return;
    dispatchPickAlerts({
      settings,
      picks: live.map(({ tier, pick: p }) => ({
        key: pickKey(p),
        symbol: p.symbol,
        source: "web-pick",
        reason: p.thesis,
        strategy: p.strategy,
        optionType: p.optionType,
        direction: p.direction,
        strike: p.strike,
        expiry: p.expiry,
        risk: tier,
      })),
    });
  }, [allPicks, settings, expiryStatus]);

  // 200-day SMA cache for the long-term trend gate.
  // MUST be called before any early returns to preserve hook order.
  const sma = useSma200(symbols);

  // NOVA AI filter (must also live above early returns).
  const [novaSpec] = useNovaFilter();

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

  // Build per-pick guard evaluation (stale price, intrinsic audit, 200-SMA, etc.)
  const guardForPick = (p: ScoutPick, tier: "safe" | "mild" | "aggressive"): GuardEval =>
    evaluateGuards({
      symbol: p.symbol,
      pickPrice: p.playAt ?? null,
      livePrice: quoteMap.get(p.symbol)?.price ?? null,
      riskBucket: tier,
      optionType: p.optionType,
      direction: p.direction,
      strike: p.strike,
      sma200: sma.map.get(p.symbol)?.sma200 ?? null,
    });

  // NOVA filter spec already pulled above (must live before early returns).
  const todayMs = Date.now();
  const dteOf = (iso?: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00Z").getTime();
    if (Number.isNaN(d)) return null;
    return Math.max(0, Math.round((d - todayMs) / 86_400_000));
  };

  // Hide timed-out picks per tier + apply NOVA AI filter.
  const tierPicks = (tier: "safe" | "mild" | "aggressive"): ScoutPick[] => {
    const src = tier === "safe" ? data?.safe : tier === "mild" ? data?.mild : data?.aggressive;
    return (src ?? []).filter((p) => {
      if (expiryStatus.get(pickKey(p))?.isTimedOut) return false;
      const premium = parsePremiumEstimate(p.premiumEstimate);
      return pickMatchesFilter({
        symbol: p.symbol,
        strategy: p.strategy,
        riskBucket: tier,
        bias: p.bias,
        optionType: p.optionType as "call" | "put",
        expiration: p.expiry,
        dte: dteOf(p.expiry),
        premium,
      }, novaSpec);
    });
  };

  return (
    <div className="space-y-4">
      <NovaFilterBar />

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
        <BucketColumn title="Safe" tone="bullish" icon={<Shield className="h-3.5 w-3.5" />} blurb="Income & hedging" picks={tierPicks("safe")} expiryStatus={expiryStatus} guardFor={(p) => guardForPick(p, "safe")} />
        <BucketColumn title="Mild" tone="neutral" icon={<Target className="h-3.5 w-3.5" />} blurb="Defined-risk directional" picks={tierPicks("mild")} expiryStatus={expiryStatus} guardFor={(p) => guardForPick(p, "mild")} />
        <BucketColumn title="Aggressive" tone="bearish" icon={<Zap className="h-3.5 w-3.5" />} blurb="High risk / high reward" picks={tierPicks("aggressive")} expiryStatus={expiryStatus} guardFor={(p) => guardForPick(p, "aggressive")} />
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

function BucketColumn({ title, tone, icon, blurb, picks, expiryStatus, guardFor }: {
  title: string;
  tone: "bullish" | "neutral" | "bearish";
  icon: React.ReactNode;
  blurb: string;
  picks: ScoutPick[];
  expiryStatus?: Map<string, PickStatus>;
  guardFor?: (p: ScoutPick) => GuardEval;
}) {
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
        ) : picks.map((p, i) => {
          const exp = expiryStatus?.get(pickKey(p));
          const guard = guardFor?.(p);
          const blocked = guard?.shouldBlockSignal ?? false;
          return (
          <div
            key={i}
            className={cn(
              "rounded-md border p-2.5",
              blocked ? "border-bearish/50 bg-bearish/10" : "border-border/60 bg-background/40",
              exp?.isStale && "opacity-70",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-sm font-semibold">{p.symbol}</span>
                <TickerPrice symbol={p.symbol} showChange />
              </div>
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
            {guard && guard.flags.length > 0 && (
              <div className="mt-2"><NovaGuardBadges guard={guard} /></div>
            )}
            <div className="mt-2 space-y-1 text-[11px]">
              <div><span className="text-muted-foreground">Risk: </span><span className="text-foreground/80">{p.risk}</span></div>
              <div className="flex items-center justify-between gap-2">
                <SourceBadge source={p.source} />
                {blocked ? (
                  <span className="text-[10px] font-bold tracking-wider px-2 py-1 rounded border border-bearish/50 bg-bearish/15 text-bearish">
                    BLOCKED
                  </span>
                ) : (
                  <SaveToPortfolioButton
                    size="xs"
                    symbol={p.symbol}
                    optionType={p.optionType}
                    direction={p.direction}
                    strike={p.strike}
                    strikeShort={p.strikeShort}
                    expiry={p.expiry}
                    entryUnderlying={p.playAt}
                    thesis={p.thesis}
                    source="web-pick"
                  />
                )}
              </div>
              {exp && (exp.isStale || exp.rsiFlipped || exp.thetaAccelerating) && (
                <div className="mt-1.5"><PickExpiryChips status={exp} compact /></div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </Card>
  );
}

function HistoryPanel() {
  const { data, isLoading, error } = useWebPicksHistory(15);
  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (error) {
    return <Card className="border-bearish/40 bg-bearish/5 p-4 text-sm text-bearish">Failed to load history: {(error as Error).message}</Card>;
  }
  const runs = data ?? [];
  if (runs.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No saved runs yet — hit Re-scrape on Web Picks to record one.</Card>;
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <Card key={run.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{new Date(run.fetched_at).toLocaleString()}</div>
              <p className="mt-0.5 text-sm text-foreground/90 line-clamp-2">{run.market_read || "—"}</p>
            </div>
            <div className="flex gap-1.5 text-[10px]">
              <Badge variant="outline">{run.pick_count} picks</Badge>
              <Badge variant="outline">{run.source_count} sources</Badge>
            </div>
          </div>
          {run.picks.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {run.picks.map((p) => {
                const tierClass = p.tier === "safe" ? "border-bullish/40 bg-bullish/5" : p.tier === "aggressive" ? "border-bearish/40 bg-bearish/5" : "border-border bg-surface/40";
                const isCall = p.option_type.includes("call");
                const tone = p.direction === "long" && isCall ? "text-bullish" : p.direction === "long" && p.option_type.includes("put") ? "text-bearish" : "text-foreground";
                const strikeLabel = p.strike_short ? `${p.strike}/${p.strike_short}` : String(p.strike);
                return (
                  <div key={p.id} className={cn("rounded-md border p-2.5", tierClass)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-sm font-semibold">{p.symbol}</span>
                        <TickerPrice symbol={p.symbol} />
                      </div>
                      <Badge variant="outline" className="text-[10px] capitalize">{p.tier}</Badge>
                    </div>
                    <div className={cn("mt-1 font-mono text-xs font-semibold", tone)}>
                      {p.direction.toUpperCase()} ${strikeLabel} {p.option_type.replace("_", " ").toUpperCase()} · {p.expiry}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Play at ${Number(p.play_at).toFixed(2)}{p.premium_estimate ? ` · ${p.premium_estimate}` : ""}</div>
                    <p className="mt-1 text-[11px] text-foreground/80 line-clamp-2">{p.thesis}</p>
                    {p.outcome && p.outcome !== "open" && (
                      <Badge variant="secondary" className="mt-1.5 text-[10px] capitalize">{p.outcome}{p.pnl_pct != null ? ` · ${p.pnl_pct >= 0 ? "+" : ""}${Number(p.pnl_pct).toFixed(1)}%` : ""}</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return <span className="text-[10px] text-muted-foreground italic">unknown source</span>;
  let domain = source;
  let href: string | null = null;
  try {
    const u = new URL(source.startsWith("http") ? source : `https://${source}`);
    domain = u.hostname.replace(/^www\./, "");
    href = u.href;
  } catch {
    domain = source.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
  const className = "inline-flex max-w-[60%] items-center gap-1 truncate rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:border-border";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className} onClick={(e) => e.stopPropagation()}>
        <Globe className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{domain}</span>
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      </a>
    );
  }
  return (
    <span className={className}>
      <Globe className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{domain}</span>
    </span>
  );
}

