// Full-screen red modal that fires when Gate 7 (-30% stop) triggers on an OPEN
// position. Blocking modal — user must acknowledge or click Exit to dismiss.
import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePortfolio, useClosePosition, type PortfolioPosition } from "@/lib/portfolio";
import { useLiveQuotes, type VerifiedQuote } from "@/lib/liveData";
import { gate7_SafetyExit } from "@/lib/gates";
import type { OptionType } from "@/lib/gates";

interface FiredAlert {
  positionId: string;
  symbol: string;
  reasoning: string;
  entryPremium: number;
  currentPremium: number;
  exitThreshold: number;
  lossPct: number;
  invalidQuote: boolean;
}

const DISMISSED_KEY = "nova.safetyExit.dismissed";

function loadDismissed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "{}"); }
  catch { return {}; }
}
function saveDismissed(map: Record<string, number>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
}

/**
 * Estimate current premium from intrinsic value (conservative floor).
 * Same approach the Portfolio page uses for unrealized P&L.
 */
function estimateCurrentPremium(p: PortfolioPosition, spot: number): number | null {
  const strike = Number(p.strike);
  const isCall = p.option_type.toLowerCase().includes("call");
  const isPut = p.option_type.toLowerCase().includes("put");
  if (!isCall && !isPut) return null;
  const intrinsic = isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  return intrinsic;
}

export function SafetyExitAlert() {
  const { data: positions = [] } = usePortfolio();
  const open = useMemo(
    () => positions.filter((p) => p.status === "open" && !p.is_paper && p.entry_premium != null),
    [positions],
  );
  const symbols = useMemo(() => Array.from(new Set(open.map((p) => p.symbol))), [open]);
  const { data: quotes = [] } = useLiveQuotes(symbols);
  const quoteMap = useMemo(
    () => new Map<string, VerifiedQuote>((quotes as VerifiedQuote[]).map((q) => [q.symbol, q])),
    [quotes],
  );

  const [active, setActive] = useState<FiredAlert | null>(null);
  const close = useClosePosition();

  useEffect(() => {
    if (active) return;
    const dismissed = loadDismissed();
    const now = Date.now();
    for (const p of open) {
      const dismissedAt = dismissed[p.id];
      if (dismissedAt && now - dismissedAt < 60 * 60 * 1000) continue;

      const invalidQuote = p.last_quote_quality != null && p.last_quote_quality !== "VALID";
      const frozenPremium = Number(p.last_valid_mark ?? p.current_price ?? p.entry_premium ?? 0);
      if (invalidQuote && frozenPremium > 0) {
        setActive({
          positionId: p.id,
          symbol: p.symbol,
          reasoning: "Quote unavailable — last valid mark used. No auto-stop. Check your broker.",
          entryPremium: Number(p.entry_premium),
          currentPremium: frozenPremium,
          exitThreshold: Number(p.entry_premium) * 0.70,
          lossPct: ((Number(p.entry_premium) - frozenPremium) / Number(p.entry_premium)) * 100,
          invalidQuote: true,
        });
        return;
      }

      const spot = quoteMap.get(p.symbol)?.price;
      if (spot == null) continue;
      const currentPremium = Number(p.current_price ?? estimateCurrentPremium(p, spot) ?? 0);
      if (!Number.isFinite(currentPremium) || currentPremium <= 0) continue;

      const result = gate7_SafetyExit({
        ticker: p.symbol,
        optionType: p.option_type.toLowerCase().includes("call") ? "CALL" : "PUT" as OptionType,
        strikePrice: Number(p.strike),
        currentPrice: spot,
        entryPremium: Number(p.entry_premium),
        currentPremium,
        quoteTimestamp: new Date(),
        liveFeedPrice: spot,
        rsi14: 50, streakDays: 0, sma200: spot, ivPercentile: 50,
        marketTime: new Date(), delta: 0.5,
        accountBalance: 0,
      });
      if (result.status === "BLOCKED") {
        const exitThreshold = Number(p.entry_premium) * 0.70;
        setActive({
          positionId: p.id,
          symbol: p.symbol,
          reasoning: result.reasoning,
          entryPremium: Number(p.entry_premium),
          currentPremium,
          exitThreshold,
          lossPct: ((Number(p.entry_premium) - currentPremium) / Number(p.entry_premium)) * 100,
          invalidQuote: false,
        });
        return;
      }
    }
  }, [open, quoteMap, active]);

  if (!active) return null;

  const dismiss = () => {
    const d = loadDismissed();
    d[active.positionId] = Date.now();
    saveDismissed(d);
    setActive(null);
  };

  const exitNow = async () => {
    const pos = open.find((p) => p.id === active.positionId);
    if (!pos) { dismiss(); return; }
    await close.mutateAsync({
      id: active.positionId,
      closePremium: active.currentPremium,
      status: "closed",
      contracts: pos.contracts,
      entryPremium: pos.entry_premium,
      direction: pos.direction,
    });
    dismiss();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent
        className={active.invalidQuote ? "max-w-lg border-2 border-warning bg-warning/10 backdrop-blur-md p-0 overflow-hidden" : "max-w-lg border-2 border-bearish bg-bearish/10 backdrop-blur-md p-0 overflow-hidden"}
        aria-label={active.invalidQuote ? "Quote unavailable" : "Safety exit triggered"}
      >
        <div className={active.invalidQuote ? "bg-warning text-warning-foreground px-5 py-4 flex items-center gap-3" : "bg-bearish text-bearish-foreground px-5 py-4 flex items-center gap-3"}>
          <AlertOctagon className={active.invalidQuote ? "h-7 w-7" : "h-7 w-7 animate-pulse"} />
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">
              Capital Guard · Gate 7
            </div>
            <div className="text-lg font-extrabold tracking-tight">
              {active.invalidQuote ? "Quote Unavailable — using last valid price" : "30% STOP TRIGGERED — EXIT NOW"}
            </div>
          </div>
          <button
            onClick={dismiss}
            className="rounded-full p-1 hover:bg-black/20 transition-colors"
            aria-label="Snooze 1 hour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-2xl font-extrabold tracking-tight">{active.symbol}</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded border border-border bg-card/50 p-2">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Entry</div>
              <div className="font-mono font-bold">${active.entryPremium.toFixed(2)}</div>
            </div>
            <div className={active.invalidQuote ? "rounded border border-warning/50 bg-warning/10 p-2" : "rounded border border-bearish/50 bg-bearish/10 p-2"}>
              <div className={active.invalidQuote ? "text-[9px] uppercase tracking-widest text-warning" : "text-[9px] uppercase tracking-widest text-bearish"}>Now</div>
              <div className={active.invalidQuote ? "font-mono font-bold text-warning" : "font-mono font-bold text-bearish"}>${active.currentPremium.toFixed(2)}</div>
            </div>
            <div className={active.invalidQuote ? "rounded border border-warning bg-warning/20 p-2" : "rounded border border-bearish bg-bearish/20 p-2"}>
              <div className={active.invalidQuote ? "text-[9px] uppercase tracking-widest text-warning" : "text-[9px] uppercase tracking-widest text-bearish"}>{active.invalidQuote ? "Status" : "Loss"}</div>
              <div className={active.invalidQuote ? "font-mono font-bold text-warning" : "font-mono font-bold text-bearish"}>{active.invalidQuote ? "Frozen" : `−${active.lossPct.toFixed(0)}%`}</div>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{active.reasoning}</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={dismiss}>
              Snooze 1 hr
            </Button>
            {!active.invalidQuote && (
              <Button
                className="flex-1 bg-bearish text-bearish-foreground hover:bg-bearish/90 font-bold"
                onClick={exitNow}
                disabled={close.isPending}
              >
                {close.isPending ? "Closing…" : "EXIT NOW"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
