// Small header badge: shows current NOVA mode (time-state) + inferred regime.
// Re-evaluates every 60s so it flips automatically as the session advances.
import { useEffect, useMemo, useState } from "react";
import { Clock, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { detectTimeState, inferRegime, type MarketRegime, type TimeState } from "@/lib/novaBrain";
import { useLiveQuotes } from "@/lib/liveData";

const TIME_CLS: Record<TimeState, string> = {
  weekend:     "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
  holiday:     "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
  premarket:   "border-warning/50 bg-warning/10 text-warning",
  openingHour: "border-primary/50 bg-primary/15 text-primary",
  midday:      "border-muted-foreground/40 bg-surface/60 text-foreground",
  powerHour:   "border-primary/60 bg-primary/20 text-primary",
  afterHours:  "border-warning/50 bg-warning/10 text-warning",
  closed:      "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
};

const REGIME_META: Record<MarketRegime, { label: string; cls: string }> = {
  bull:     { label: "Bull",     cls: "border-bullish/50 bg-bullish/10 text-bullish" },
  meltup:   { label: "Melt-up",  cls: "border-bullish/60 bg-bullish/20 text-bullish" },
  bear:     { label: "Bear",     cls: "border-bearish/50 bg-bearish/10 text-bearish" },
  panic:    { label: "Panic",    cls: "border-bearish/60 bg-bearish/20 text-bearish" },
  sideways: { label: "Sideways", cls: "border-muted-foreground/40 bg-surface/60 text-foreground" },
};

export function NovaModeBadge() {
  const { data: quotes = [] } = useLiveQuotes();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const time = useMemo(() => detectTimeState(new Date()), [tick]);

  const regime = useMemo(() => {
    const find = (sym: string) => quotes.find((q) => q.symbol === sym);
    return inferRegime({
      spyChangePct: find("SPY")?.changePct ?? null,
      qqqChangePct: find("QQQ")?.changePct ?? null,
      iwmChangePct: find("IWM")?.changePct ?? null,
      diaChangePct: find("DIA")?.changePct ?? null,
    });
  }, [quotes]);

  const reg = REGIME_META[regime.regime];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`pill ${TIME_CLS[time.state]} cursor-help`}>
              <Clock className="h-3 w-3" /> {time.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
            <div className="font-semibold mb-1">Best now: <span className="font-normal">{time.bestStrategy}</span></div>
            <div className="text-muted-foreground">Avoid: {time.avoid}</div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`pill ${reg.cls} cursor-help`}>
              <Activity className="h-3 w-3" /> {reg.label}
              <span className="opacity-70 ml-1">{regime.confidence}%</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
            <div className="font-semibold mb-1">{regime.description}</div>
            <div className="text-muted-foreground">
              Prefer: {regime.preferredStrategies.slice(0, 3).join(", ")}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
