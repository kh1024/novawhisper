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
  // Floor — real premium ≥ intrinsic. Good enough for a -30% trigger.
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

  // Re-evaluate gate 7 every time quotes refresh.
  useEffect(() => {
    if (active) return; // already showing
    const dismissed = loadDismissed();
    const now = Date.now();
    for (const p of open) {
      const dismissedAt = dismissed[p.id];
      if (dismissedAt && now - dismissedAt < 60 * 60 * 1000) continue; // 1h snooze
      const spot = quoteMap.get(p.symbol)?.price;
      if (spot == null) continue;
      const currentPremium = estimateCurrentPremium(p, spot);
      if (currentPremium == null) continue;
      const result = gate7_SafetyExit({
        ticker: p.symbol,
        optionType: p.option_type.toLowerCase().includes("call") ? "CALL" : "PUT" as OptionType,
        strikePrice: Number(p.strike),
        currentPrice: spot,
        entryPremium: Number(p.entry_premium),
        currentPremium,
        // Unused fields for gate 7 — fill safe defaults.
        quoteTimestamp: new Date(),
        liveFeedPrice: spot,
        rsi14: 50, streakDays: 0, sma200: spot, ivPercentile: 50,
        marketTime: new Date(), delta: 0.5,
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
    await close.mutateAsync({
      id: active.positionId,
      closePremium: active.currentPremium,
      status: "closed",
    });
    dismiss();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent
        className="max-w-lg border-2 border-bearish bg-bearish/10 backdrop-blur-md p-0 overflow-hidden"
        aria-label="Safety exit triggered"
      >
        <div className="bg-bearish text-bearish-foreground px-5 py-4 flex items-center gap-3">
          <AlertOctagon className="h-7 w-7 animate-pulse" />
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-90">
              Capital Guard · Gate 7
            </div>
            <div className="text-lg font-extrabold tracking-tight">
              30% STOP TRIGGERED — EXIT NOW
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
            <div className="rounded border border-bearish/50 bg-bearish/10 p-2">
              <div className="text-[9px] uppercase tracking-widest text-bearish">Now</div>
              <div className="font-mono font-bold text-bearish">${active.currentPremium.toFixed(2)}</div>
            </div>
            <div className="rounded border border-bearish bg-bearish/20 p-2">
              <div className="text-[9px] uppercase tracking-widest text-bearish">Loss</div>
              <div className="font-mono font-bold text-bearish">−{active.lossPct.toFixed(0)}%</div>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-foreground">{active.reasoning}</p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={dismiss}>
              Snooze 1 hr
            </Button>
            <Button
              className="flex-1 bg-bearish text-bearish-foreground hover:bg-bearish/90 font-bold"
              onClick={exitNow}
              disabled={close.isPending}
            >
              {close.isPending ? "Closing…" : "EXIT NOW"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
