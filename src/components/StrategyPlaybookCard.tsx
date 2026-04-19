// Renders the full institutional-grade trade plan returned by selectStrategy().
// Lives inside the Scanner expanded row so every setup gets a Best Strategy /
// Strike / Expiration / Entry / Target / Stop / R:R / PoP / Sizing block.
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StrategyDecision } from "@/lib/strategySelector";
import {
  Target, ShieldCheck, Clock, AlertTriangle, ArrowRight, Gauge, Wallet,
} from "lucide-react";

const rrCls = (label: StrategyDecision["rewardRiskLabel"]) =>
  label === "Excellent" ? "text-bullish border-bullish/40 bg-bullish/10"
    : label === "Good" ? "text-bullish border-bullish/30 bg-bullish/5"
    : label === "Fair" ? "text-warning border-warning/30 bg-warning/5"
    : "text-bearish border-bearish/40 bg-bearish/10";

const sizingCls = (s: StrategyDecision["sizing"]) =>
  s === "Aggressive" ? "text-bearish border-bearish/40"
    : s === "Conservative" ? "text-bullish border-bullish/40"
    : "text-warning border-warning/40";

export function StrategyPlaybookCard({ decision, symbol }: { decision: StrategyDecision; symbol: string }) {
  if (decision.action === "WAIT — no edge") {
    return (
      <Card className="glass-card p-4 border border-warning/30 bg-warning/5">
        <div className="flex items-center gap-2 text-warning text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" /> WAIT — no actionable edge
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">{decision.rationale}</p>
        {decision.warnings.map((w, i) => (
          <p key={i} className="text-[11px] text-muted-foreground/80 mt-1">• {w}</p>
        ))}
      </Card>
    );
  }

  const strikeLabel = decision.shortStrike != null && decision.longStrike != null && decision.shortStrike !== decision.longStrike
    ? `${decision.longStrike} / ${decision.shortStrike}`
    : `${decision.longStrike ?? "—"}`;

  return (
    <Card className="glass-card p-4 space-y-3 border border-primary/30">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold tracking-[0.18em] text-primary">BEST STRATEGY</span>
            <span className="text-base font-semibold">{decision.action}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{decision.rationale}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border", rrCls(decision.rewardRiskLabel))}>
            R:R {decision.rewardRisk}× · {decision.rewardRiskLabel}
          </span>
          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border border-primary/40 text-primary bg-primary/10">
            PoP {decision.probabilityOfProfit}%
          </span>
          <span className={cn("text-[10px] font-bold tracking-wider px-2 py-0.5 rounded border", sizingCls(decision.sizing))}>
            {decision.sizing} sizing
          </span>
        </div>
      </div>

      {/* Strike + expiration */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1 border-t border-border/40">
        <div>
          <div className="text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Strike</div>
          <div className="mono font-semibold mt-0.5">${strikeLabel}</div>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Expiry</div>
          <div className="mono font-semibold mt-0.5">{decision.expiry}</div>
          <div className="text-[10px] text-muted-foreground/80">{decision.dte}d · {decision.expiryReason}</div>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> Breakeven</div>
          <div className="mono font-semibold mt-0.5">{decision.breakeven != null ? `$${decision.breakeven}` : "—"}</div>
          <div className="text-[10px] text-muted-foreground/80">±$ {decision.expectedMoveDollars} expected (1σ)</div>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3" /> Per contract</div>
          <div className="mono font-semibold mt-0.5">
            <span className="text-bullish">+${decision.targetProfitPerContract}</span>
            {" / "}
            <span className="text-bearish">-${decision.maxLossPerContract}</span>
          </div>
          <div className="text-[10px] text-muted-foreground/80">target / max loss</div>
        </div>
      </div>

      {/* Entry / target / stop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-2 border-t border-border/40">
        <div>
          <div className="text-bullish text-[10px] font-bold tracking-wider mb-1 flex items-center gap-1">
            <ArrowRight className="h-3 w-3" /> ENTRY
          </div>
          <p className="text-foreground/90 leading-snug">{decision.entry}</p>
        </div>
        <div>
          <div className="text-primary text-[10px] font-bold tracking-wider mb-1 flex items-center gap-1">
            <Target className="h-3 w-3" /> TARGET
          </div>
          <p className="text-foreground/90 leading-snug">{decision.target}</p>
        </div>
        <div>
          <div className="text-bearish text-[10px] font-bold tracking-wider mb-1 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> STOP
          </div>
          <p className="text-foreground/90 leading-snug">{decision.stop}</p>
        </div>
      </div>

      {/* Warnings */}
      {decision.warnings.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-1">
          {decision.warnings.map((w, i) => (
            <div key={i} className="text-[11px] text-warning/95 flex gap-1.5">
              <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/70 pt-1 italic">
        Plan for <span className="mono">{symbol}</span> · math is estimated — verify on a real chain before placing.
      </div>
    </Card>
  );
}
