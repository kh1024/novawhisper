import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Clock, Activity, Target, Ban, Brain } from "lucide-react";
import { detectTimeState, inferRegime, type RegimeContext } from "@/lib/novaBrain";
import { useLiveQuotes } from "@/lib/liveData";
import { Hint } from "@/components/Hint";

const REGIME_STYLE: Record<RegimeContext["regime"], { cls: string; emoji: string }> = {
  bull:     { cls: "bg-bullish/15 text-bullish border-bullish/40", emoji: "🐂" },
  meltup:   { cls: "bg-bullish/20 text-bullish border-bullish/50", emoji: "🚀" },
  bear:     { cls: "bg-bearish/15 text-bearish border-bearish/40", emoji: "🐻" },
  panic:    { cls: "bg-bearish/25 text-bearish border-bearish/60", emoji: "🚨" },
  sideways: { cls: "bg-muted text-muted-foreground border-border", emoji: "↔️" },
};

export function NovaStatusStrip() {
  const [now, setNow] = useState(() => new Date());
  const { data: quotes = [] } = useLiveQuotes();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const time = useMemo(() => detectTimeState(now), [now]);

  const regime = useMemo(() => {
    const find = (sym: string) => quotes.find((q) => q.symbol === sym);
    const breadthPool = quotes.filter((q) => q.sector !== "ETF");
    const breadth = breadthPool.length
      ? breadthPool.filter((q) => q.change > 0).length / breadthPool.length
      : null;
    return inferRegime({
      spyChangePct: find("SPY")?.changePct ?? null,
      qqqChangePct: find("QQQ")?.changePct ?? null,
      iwmChangePct: find("IWM")?.changePct ?? null,
      diaChangePct: find("DIA")?.changePct ?? null,
      breadth,
    });
  }, [quotes]);

  const regimeStyle = REGIME_STYLE[regime.regime];

  return (
    <Card className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-wide">NOVA Status</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">
          Adaptive regime + time-state read · refreshes every minute
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Time state */}
        <Hint label={`Nova adapts strategy by US/Eastern session. ${time.isFriday ? "Friday — weekend decay ahead." : time.isMonday ? "Monday — gap risk from weekend news." : ""}`}>
          <div className="p-3 rounded-lg border border-border bg-surface/40 cursor-help">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3" /> Time State
            </div>
            <div className="mt-1 text-sm font-semibold">{time.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {time.isMonday && "Monday · "}{time.isFriday && "Friday · "}{time.isMonthEnd && "Month-end · "}ET
            </div>
          </div>
        </Hint>

        {/* Regime */}
        <Hint label={`Inferred from index moves + breadth. Confidence: ${regime.confidence}/100.`}>
          <div className={`p-3 rounded-lg border cursor-help ${regimeStyle.cls}`}>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-80">
              <Activity className="h-3 w-3" /> Regime
            </div>
            <div className="mt-1 text-sm font-semibold capitalize">
              {regimeStyle.emoji} {regime.regime}
            </div>
            <div className="text-[10px] opacity-80 mt-0.5 line-clamp-2">{regime.description}</div>
          </div>
        </Hint>

        {/* Best strategy */}
        <Hint label="What Nova thinks fits this regime + session right now.">
          <div className="p-3 rounded-lg border border-bullish/30 bg-bullish/5 cursor-help">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-bullish/90">
              <Target className="h-3 w-3" /> Best Now
            </div>
            <div className="mt-1 text-xs leading-snug font-medium text-foreground line-clamp-3">
              {time.bestStrategy}
            </div>
          </div>
        </Hint>

        {/* Avoid */}
        <Hint label="What Nova flags as low-edge or high-risk in this context.">
          <div className="p-3 rounded-lg border border-bearish/30 bg-bearish/5 cursor-help">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-bearish/90">
              <Ban className="h-3 w-3" /> Avoid
            </div>
            <div className="mt-1 text-xs leading-snug font-medium text-foreground line-clamp-3">
              {time.avoid}
            </div>
          </div>
        </Hint>
      </div>

      {/* Preferred / avoid strategies from regime */}
      {(regime.preferredStrategies.length > 0 || regime.avoidStrategies.length > 0) && (
        <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
          {regime.preferredStrategies.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-muted-foreground">Prefers:</span>
              {regime.preferredStrategies.slice(0, 4).map((s) => (
                <span key={s} className="pill pill-bullish capitalize">{s}</span>
              ))}
            </div>
          )}
          {regime.avoidStrategies.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-muted-foreground">Avoids:</span>
              {regime.avoidStrategies.slice(0, 3).map((s) => (
                <span key={s} className="pill pill-bearish capitalize">{s}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
