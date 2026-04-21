// Tomorrow's Game Plan — appears on /scanner whenever the regular session is
// not OPEN. Shows the top 10 picks from today's closing data with a
// "what it needs" checklist, a live countdown to the next 9:30 AM ET open,
// and a watchlist quick-add. Display-only — does not affect verdicts.
import { useEffect, useMemo, useState } from "react";
import { Moon, Clock, AlertTriangle, ChevronDown, ChevronUp, Bell, TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useScannerPicks, type ApprovedPick } from "@/lib/useScannerPicks";
import { getMarketState, getNextMarketOpen, getTomorrowET } from "@/lib/marketHours";
import { getEventWarning } from "@/lib/signals/eventCalendar";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ALERT_STORAGE_KEY = "nova_price_alerts_v1";
const PLAN_CACHE_KEY = "nova_game_plan_cache_v1";

interface SavedAlert {
  id: string;
  symbol: string;
  price: number;
  direction: "above" | "below";
  createdAt: string;
}

function readAlerts(): SavedAlert[] {
  try {
    return JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) ?? "[]") as SavedAlert[];
  } catch { return []; }
}
function writeAlerts(arr: SavedAlert[]) {
  localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(arr));
}

// ─── Live countdown to next 9:30 AM ET open ────────────────────────────────
function MarketOpenCountdown({ compact }: { compact?: boolean }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      const diff = getNextMarketOpen().getTime() - Date.now();
      if (diff <= 0) { setLabel("Market is open"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setLabel(compact ? `${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s until 9:30 AM ET open`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [compact]);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <Clock className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

// ─── Inline alert form ──────────────────────────────────────────────────────
function AlertForm({ symbol, defaultPrice, onClose }: { symbol: string; defaultPrice: number; onClose: () => void }) {
  const [price, setPrice] = useState<string>(defaultPrice.toFixed(2));
  const save = () => {
    const num = Number(price);
    if (!Number.isFinite(num) || num <= 0) {
      toast({ title: "Invalid price", variant: "destructive" });
      return;
    }
    const next: SavedAlert = {
      id: crypto.randomUUID(),
      symbol: symbol.toUpperCase(),
      price: num,
      direction: num >= defaultPrice ? "above" : "below",
      createdAt: new Date().toISOString(),
    };
    writeAlerts([...readAlerts(), next]);
    toast({ title: `Alert set for ${symbol} ${next.direction} $${num.toFixed(2)}` });
    onClose();
  };
  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-[11px] text-muted-foreground">Alert when {symbol} crosses</span>
      <Input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        type="number"
        step="0.01"
        className="h-7 w-24 text-xs"
      />
      <Button size="sm" className="h-7 text-xs" onClick={save}>Save</Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
    </div>
  );
}

// ─── Single Game Plan card ──────────────────────────────────────────────────
function GamePlanCard({ pick }: { pick: ApprovedPick }) {
  const [showAlert, setShowAlert] = useState(false);
  const r = pick.row;
  const score = pick.rank?.finalRank ?? r.setupScore;
  const isBullish = r.bias !== "bearish";
  const horizon =
    pick.bucket === "Lottery" ? "DAY" :
    pick.bucket === "Aggressive" ? "SWING" :
    pick.bucket === "Conservative" ? "POSITION" : "SWING";

  // What-it-needs checklist
  const gatesPassed = pick.verdict?.verdict !== "Avoid";
  const scoreOk = score >= 63;
  const earningsRisk = (r.earningsInDays ?? 99) < 7;
  const wideSpread = pick.suspect;
  const relVolMissing = (r.relVolume ?? 0) < 1.5;

  // Entry zone ±0.3%
  const lo = (r.price * 0.997).toFixed(2);
  const hi = (r.price * 1.003).toFixed(2);
  const entryMid = r.price;

  // DTE
  const dte = Math.max(1, Math.round((new Date(pick.contract.expiry).getTime() - Date.now()) / 86_400_000));

  return (
    <Card className="glass-card p-3 sm:p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{r.symbol}</span>
            <span className="mono text-sm text-muted-foreground">${r.price.toFixed(2)}</span>
            <Badge variant="outline" className="text-[10px]">{horizon}</Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span className="mono">
              ${pick.contract.strike}{pick.contract.optionType === "call" ? "C" : "P"}
            </span>
            <span>·</span>
            <span>{pick.contract.expiry} ({dte} DTE)</span>
            <span>·</span>
            <span className={cn("inline-flex items-center gap-0.5", isBullish ? "text-bullish" : "text-bearish")}>
              {isBullish ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {isBullish ? "Bullish" : "Bearish"}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase text-muted-foreground">Score</div>
          <div className={cn("font-semibold", score >= 70 ? "text-bullish" : score >= 50 ? "text-foreground" : "text-bearish")}>
            {Math.round(score)}
          </div>
        </div>
      </div>

      <div className="rounded border border-border/60 bg-muted/30 p-2 space-y-1">
        <div className="text-[10px] uppercase text-muted-foreground tracking-wider">What it needs to flip BUY NOW</div>
        <ul className="text-xs space-y-0.5">
          <li>{gatesPassed ? "✅" : "⛔"} Gates {gatesPassed ? "passed" : "failed"}</li>
          <li>{scoreOk ? "✅" : "⏳"} Setup score: {Math.round(score)} {scoreOk ? "" : "(needs ≥ 63)"}</li>
          <li>⏳ Live trigger at open</li>
          {relVolMissing && <li>⏳ Needs relVolume ≥ 1.5× (watch 9:35 AM)</li>}
          {earningsRisk && <li className="text-warning">⚠ Earnings in {r.earningsInDays}d</li>}
          {wideSpread && <li className="text-warning">⚠ Wide spread — verify at open</li>}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Entry zone</div>
          <div className="mono">${lo}–${hi}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Target</div>
          <div className="mono text-bullish">+40–80%</div>
        </div>
        <div>
          <div className="text-muted-foreground">Stop</div>
          <div className="mono text-bearish">-25%</div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <SaveToWatchlistButton
          size="xs"
          symbol={r.symbol}
          direction="long"
          optionType={pick.contract.optionType}
          strike={pick.contract.strike}
          expiry={pick.contract.expiry}
          bias={r.bias}
          tier={pick.pickTier}
          entryPrice={r.price}
          thesis={`Game Plan · score ${Math.round(score)}`}
          source="game_plan"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={() => setShowAlert((v) => !v)}
        >
          <Bell className="mr-1 h-3 w-3" />
          {showAlert ? "Cancel" : "Set Alert"}
        </Button>
      </div>
      {showAlert && <AlertForm symbol={r.symbol} defaultPrice={entryMid} onClose={() => setShowAlert(false)} />}
    </Card>
  );
}

// ─── Main section ───────────────────────────────────────────────────────────
export function TomorrowsGamePlan() {
  const marketState = getMarketState();
  const visible = marketState !== "OPEN";

  // Pull the full universe (no maxResults), include none of the blocked sets.
  const scan = useScannerPicks({ bucket: "All" });

  // Top 10 by finalRank/setupScore with score ≥ 50.
  const liveTop = useMemo(() => {
    const all = [...scan.approved, ...scan.watchlistOnly, ...scan.bestPending];
    // Dedupe by key
    const seen = new Set<string>();
    const uniq: ApprovedPick[] = [];
    for (const p of all) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      uniq.push(p);
    }
    return uniq
      .filter((p) => (p.rank?.finalRank ?? p.row.setupScore) >= 50)
      .sort((a, b) => (b.rank?.finalRank ?? b.row.setupScore) - (a.rank?.finalRank ?? a.row.setupScore))
      .slice(0, 10);
  }, [scan.approved, scan.watchlistOnly, scan.bestPending]);

  // Persist the latest non-empty plan to localStorage so the next morning
  // load can render instantly while the live scan rehydrates.
  useEffect(() => {
    if (!visible || liveTop.length === 0) return;
    try {
      const slim = liveTop.map((p) => ({
        key: p.key,
        symbol: p.row.symbol,
        price: p.row.price,
        score: Math.round(p.rank?.finalRank ?? p.row.setupScore),
        contract: p.contract,
      }));
      localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), picks: slim }));
    } catch { /* quota — ignore */ }
  }, [liveTop, visible]);

  const tomorrow = getTomorrowET();
  const tomorrowEvent = getEventWarning(tomorrow);
  const buyReadyCount = liveTop.filter((p) => (p.rank?.finalRank ?? p.row.setupScore) >= 63).length;
  const topPick = liveTop[0];

  const [open, setOpen] = useState(true);

  if (!visible) return null;

  return (
    <div className="space-y-3">
      {/* Always-visible summary strip */}
      <Card className="glass-card p-3 border-primary/30 bg-primary/5">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Moon className="h-4 w-4 text-primary" /> Tomorrow:{" "}
              {liveTop.length > 0 ? (
                <>
                  <span className="text-bullish">{buyReadyCount}</span> setups ready
                  {topPick && (
                    <span className="text-muted-foreground ml-1">
                      · Top pick: <span className="text-foreground font-mono">{topPick.row.symbol} ${topPick.contract.strike}{topPick.contract.optionType === "call" ? "C" : "P"}</span>
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">building plan…</span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              <MarketOpenCountdown />
            </span>
          </div>
          {tomorrowEvent && (
            <div className="inline-flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> {tomorrowEvent} tomorrow
            </div>
          )}
        </div>
      </Card>

      {/* Collapsible cards */}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between" size="sm">
            <span className="inline-flex items-center gap-2">
              <Moon className="h-4 w-4" /> Tomorrow's Game Plan
              <span className="text-xs text-muted-foreground font-normal">
                · Setups to watch at open — built from today's closing data
              </span>
            </span>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          {liveTop.length === 0 ? (
            <Card className="glass-card p-8 text-center text-sm text-muted-foreground">
              No setups scoring ≥ 50 yet. Plan rebuilds as the scan completes.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {liveTop.map((p) => <GamePlanCard key={p.key} pick={p} />)}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
