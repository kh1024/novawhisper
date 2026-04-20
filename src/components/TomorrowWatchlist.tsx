// Tomorrow's Watchlist — aggregates every internet-sourced pick we already
// fetch (Firecrawl options scout, YouTube creator chatter via planning-synthesis,
// Reddit + news feeds that flow into web_picks_runs) into a single ranked list
// of "what to watch when the bell rings tomorrow".
//
// Three guarantees, in order:
//   1. Strike snapping — every contract is verified against the live option
//      chain via usePickStrikeSnap. Picks whose suggested strike doesn't match
//      a real listed strike (within 5%) are dropped. Solves the "$100 call
//      that doesn't exist" bug.
//   2. Budget enforcement — picks where premium × 100 > Settings per-trade
//      budget are filtered out entirely.
//   3. Mention-count ranking — symbols surfaced by multiple sources rank
//      higher; conviction A/B/C breaks ties.
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, AlertTriangle, ShieldCheck } from "lucide-react";
import { TickerPrice } from "@/components/TickerPrice";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { useOptionsScout, type ScoutPick } from "@/lib/optionsScout";
import { usePlanning, type PlanningPick } from "@/lib/planning";
import { useBudget } from "@/lib/budget";
import { usePickStrikeSnap } from "@/lib/chainStrikes";
import { useLiveQuotes } from "@/lib/liveData";
import { cn } from "@/lib/utils";

interface UnifiedPick {
  key: string;
  symbol: string;
  optionType: "call" | "put";
  direction: "long" | "short";
  strategy: string;
  suggestedStrike: number;
  expiry: string;
  playAt: number | null;
  premiumEstimate?: string;
  bias?: string;
  thesis: string;
  conviction: number; // 3=A, 2=B, 1=C
  sources: Set<string>;
}

function parsePremium(s?: string | null): number | null {
  if (!s) return null;
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const v = Math.min(...nums.map(Number));
  return Number.isFinite(v) ? v : null;
}

function fromScout(p: ScoutPick, src: string): UnifiedPick {
  return {
    key: `scout:${p.symbol}:${p.optionType}:${p.strike}:${p.expiry}`,
    symbol: p.symbol,
    optionType: p.optionType,
    direction: p.direction,
    strategy: p.strategy,
    suggestedStrike: p.strike,
    expiry: p.expiry,
    playAt: p.playAt ?? null,
    premiumEstimate: p.premiumEstimate,
    bias: p.bias,
    thesis: p.thesis,
    conviction: p.grade === "A" ? 3 : p.grade === "B" ? 2 : 1,
    sources: new Set([src]),
  };
}

function fromPlanning(p: PlanningPick): UnifiedPick {
  return {
    key: `plan:${p.symbol}:${p.optionType}:${p.strike}:${p.expiry}`,
    symbol: p.symbol,
    optionType: p.optionType,
    direction: p.direction,
    strategy: `${p.direction} ${p.optionType}`,
    suggestedStrike: p.strike,
    expiry: p.expiry,
    playAt: p.playAt,
    premiumEstimate: p.premiumEstimate,
    bias: p.bias,
    thesis: p.thesis,
    conviction: p.conviction === "A" ? 3 : p.conviction === "B" ? 2 : 1,
    sources: new Set(p.sources),
  };
}

export function TomorrowWatchlist() {
  const [budget] = useBudget();
  const scout = useOptionsScout(true);
  const planning = usePlanning({ includeYouTube: true });

  // Combine and dedupe by symbol+optionType+strike+expiry, merging sources.
  const merged = useMemo<UnifiedPick[]>(() => {
    const all: UnifiedPick[] = [];
    for (const p of scout.data?.conservative ?? []) all.push(fromScout(p, "scout-safe"));
    for (const p of scout.data?.moderate ?? [])     all.push(fromScout(p, "scout-mild"));
    for (const p of scout.data?.aggressive ?? [])   all.push(fromScout(p, "scout-agg"));
    for (const p of scout.data?.lottery ?? [])      all.push(fromScout(p, "scout-lotto"));
    for (const p of planning.data?.synthesis?.picks ?? []) all.push(fromPlanning(p));

    // Group by symbol-only for ranking (mention count = how many sources hit it)
    // but keep distinct contracts per group.
    const byKey = new Map<string, UnifiedPick>();
    for (const p of all) {
      const existing = byKey.get(p.key);
      if (existing) {
        p.sources.forEach((s) => existing.sources.add(s));
        existing.conviction = Math.max(existing.conviction, p.conviction);
      } else {
        byKey.set(p.key, p);
      }
    }
    return Array.from(byKey.values());
  }, [scout.data, planning.data]);

  // Pull live underlying prices so the grid fallback in usePickStrikeSnap has
  // a sane reference, AND so we can show price next to each pick.
  const symbols = useMemo(
    () => Array.from(new Set(merged.map((p) => p.symbol))),
    [merged],
  );
  const { data: quotes = [] } = useLiveQuotes(
    symbols.length ? symbols : undefined,
    { refetchMs: 60_000 },
  );
  const priceMap = useMemo(() => new Map(quotes.map((q) => [q.symbol, q.price])), [quotes]);

  // Snap strikes to real chain values.
  const snapInputs = useMemo(
    () => merged.map((p) => ({
      key: p.key,
      symbol: p.symbol,
      expiry: p.expiry,
      optionType: p.optionType,
      strike: p.suggestedStrike,
      underlyingPrice: priceMap.get(p.symbol) ?? null,
    })),
    [merged, priceMap],
  );
  const snaps = usePickStrikeSnap(snapInputs);

  // Apply all three filters: snap result, budget, then rank by mentions × conviction.
  const final = useMemo(() => {
    return merged
      .map((p) => {
        const snap = snaps.get(p.key);
        const realStrike = snap?.snapped ?? null;
        const premium = parsePremium(p.premiumEstimate);
        const cost = premium != null ? premium * 100 : null;
        return { pick: p, realStrike, verified: snap?.verified ?? false, cost };
      })
      .filter((x) => x.realStrike !== null)
      .filter((x) => x.cost == null || x.cost <= budget)
      .sort((a, b) => {
        const sa = a.pick.sources.size * 10 + a.pick.conviction;
        const sb = b.pick.sources.size * 10 + b.pick.conviction;
        return sb - sa;
      })
      .slice(0, 12);
  }, [merged, snaps, budget]);

  const isLoading = scout.isLoading || planning.isLoading;
  const hidden = merged.length - final.length;

  if (isLoading && merged.length === 0) {
    return (
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Tomorrow's Watchlist · pulled from across the web</h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-bullish" /> chain-verified strikes</span>
          <span>·</span>
          <span>budget ≤ ${budget.toLocaleString()}/trade</span>
          {hidden > 0 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3 w-3" /> {hidden} hidden (over budget or no real strike)
              </span>
            </>
          )}
        </div>
      </div>

      {final.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
          No picks fit your per-trade budget right now. Raise it in Settings or wait for the next refresh.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {final.map(({ pick, realStrike, verified }) => {
            const drift = Math.abs(realStrike! - pick.suggestedStrike);
            const driftPct = pick.suggestedStrike > 0 ? (drift / pick.suggestedStrike) * 100 : 0;
            const wasSnapped = drift > 0.01;
            const tone = pick.optionType === "call" ? "text-bullish" : "text-bearish";
            return (
              <div key={pick.key} className="rounded-md border border-border/60 bg-surface/40 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-sm font-semibold">{pick.symbol}</span>
                    <TickerPrice symbol={pick.symbol} showChange />
                  </div>
                  <Badge variant="outline" className="text-[10px]">{pick.sources.size}× src</Badge>
                </div>
                <div className={cn("mt-1.5 font-mono text-xs font-semibold", tone)}>
                  {pick.direction.toUpperCase()} ${realStrike} {pick.optionType.toUpperCase()} · {pick.expiry}
                </div>
                {wasSnapped && (
                  <div className="mt-0.5 text-[10px] text-warning">
                    snapped from ${pick.suggestedStrike} ({driftPct.toFixed(1)}% off, not listed)
                  </div>
                )}
                {!verified && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">grid-estimated · live chain unavailable</div>
                )}
                <p className="mt-1 text-[11px] text-foreground/80 line-clamp-2">{pick.thesis}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted-foreground">
                    {pick.premiumEstimate ? `≈ ${pick.premiumEstimate}` : "premium TBD"}
                  </span>
                  <SaveToWatchlistButton
                    size="xs"
                    symbol={pick.symbol}
                    direction={pick.direction}
                    optionType={pick.optionType}
                    strike={realStrike!}
                    expiry={pick.expiry}
                    entryPrice={pick.playAt ?? undefined}
                    thesis={pick.thesis}
                    source="tomorrow-watchlist"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
