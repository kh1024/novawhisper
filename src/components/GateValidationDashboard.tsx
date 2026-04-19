// Vertical stepper showing all 7 gates with status colors + reasoning tooltips.
// Drop-in for pick cards and position cards. The Buy CTA in the parent should
// be disabled when `result.finalStatus === "BLOCKED"`.
import { CheckCircle2, XCircle, Clock, AlertTriangle, Shield, MinusCircle } from "lucide-react";
import { Hint } from "@/components/Hint";
import { GATE_ORDER, GATE_LABELS, type GateName, type SignalStatus, type ValidationResult } from "@/lib/gates";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<SignalStatus, { wrap: string; dot: string }> = {
  APPROVED: { wrap: "border-bullish/40 bg-bullish/5",       dot: "bg-bullish text-bullish-foreground" },
  FLAGGED:  { wrap: "border-warning/50 bg-warning/10",      dot: "bg-warning text-warning-foreground" },
  WAIT:     { wrap: "border-warning/50 bg-warning/10",      dot: "bg-warning text-warning-foreground" },
  BLOCKED:  { wrap: "border-bearish/50 bg-bearish/10",      dot: "bg-bearish text-bearish-foreground" },
};

const STATUS_ICON: Record<SignalStatus, React.ComponentType<{ className?: string }>> = {
  APPROVED: CheckCircle2,
  FLAGGED:  AlertTriangle,
  WAIT:     Clock,
  BLOCKED:  XCircle,
};

interface Props {
  result: ValidationResult;
  className?: string;
  /** Compact = single-row stepper; default = vertical list with reasoning preview. */
  compact?: boolean;
}

export function GateValidationDashboard({ result, className, compact = false }: Props) {
  // Index gate results by name so we can render in canonical order.
  const byName = new Map(result.gateResults.map((g) => [g.gate as GateName, g]));

  if (compact) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        {GATE_ORDER.map((name, idx) => {
          const g = byName.get(name);
          const status = (g?.status ?? "WAIT") as SignalStatus;
          const Icon = STATUS_ICON[status];
          return (
            <Hint
              key={name}
              label={`${idx + 1}. ${GATE_LABELS[name]}\n${g?.label ?? "—"}\n\n${g?.reasoning ?? "Not evaluated."}`}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold cursor-help",
                  STATUS_STYLE[status].dot,
                )}
                aria-label={`Gate ${idx + 1} ${status}`}
              >
                <Icon className="h-3 w-3" />
              </span>
            </Hint>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          7-Gate Validation
        </span>
        <span className={cn(
          "ml-auto px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider",
          result.finalStatus === "APPROVED" && "border-bullish/50 bg-bullish/15 text-bullish",
          result.finalStatus === "FLAGGED"  && "border-warning/50 bg-warning/15 text-warning",
          result.finalStatus === "WAIT"     && "border-warning/50 bg-warning/15 text-warning",
          result.finalStatus === "BLOCKED"  && "border-bearish/50 bg-bearish/20 text-bearish",
        )}>
          {result.finalStatus}
        </span>
      </div>
      <ol className="space-y-1">
        {GATE_ORDER.map((name, idx) => {
          const g = byName.get(name);
          const status = (g?.status ?? "WAIT") as SignalStatus;
          const Icon = STATUS_ICON[status];
          const skipped = g?.label === "⚪ SKIPPED";
          return (
            <Hint key={name} label={g?.reasoning ?? "Not evaluated."}>
              <li
                className={cn(
                  "flex items-start gap-2 rounded border px-2 py-1.5 cursor-help transition-colors",
                  skipped ? "border-border bg-muted/30 opacity-60" : STATUS_STYLE[status].wrap,
                )}
              >
                <span className={cn(
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  skipped ? "bg-muted text-muted-foreground" : STATUS_STYLE[status].dot,
                )}>
                  {skipped ? <MinusCircle className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {idx + 1}. {GATE_LABELS[name]}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold mt-0.5 truncate">
                    {g?.label ?? "—"}
                  </div>
                </div>
              </li>
            </Hint>
          );
        })}
      </ol>
      {result.autoExitTrigger != null && (
        <div className="text-[10px] text-muted-foreground pt-1">
          Auto-exit fires at <span className="font-mono font-bold text-bearish">${result.autoExitTrigger.toFixed(2)}</span> per contract.
        </div>
      )}
    </div>
  );
}
