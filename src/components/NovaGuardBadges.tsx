import { AlertTriangle, ShieldAlert, TrendingDown, Banknote } from "lucide-react";
import { GUARD_STYLE, type GuardEval, type GuardFlag } from "@/lib/novaGuards";
import { Hint } from "@/components/Hint";
import { cn } from "@/lib/utils";

const ICON: Record<GuardFlag["id"], React.ComponentType<{ className?: string }>> = {
  stale:     AlertTriangle,
  intrinsic: ShieldAlert,
  trend200:  TrendingDown,
  capital30: Banknote,
};

interface Props {
  guard: GuardEval | null | undefined;
  size?: "xs" | "sm";
  className?: string;
  /** Only render the worst flag instead of all of them. */
  compact?: boolean;
}

/**
 * Renders NOVA-Guards as small chips with a Hint tooltip describing the rule.
 * Use anywhere a pick or position is shown.
 */
export function NovaGuardBadges({ guard, size = "xs", className, compact = false }: Props) {
  if (!guard || guard.flags.length === 0) return null;
  const flags = compact && guard.worst ? [guard.worst] : guard.flags;
  const text = size === "xs" ? "text-[10px]" : "text-[11px]";
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {flags.map((f) => {
        const Icon = ICON[f.id];
        return (
          <Hint key={f.id} label={f.message}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold tracking-wider cursor-help",
                text,
                GUARD_STYLE[f.severity],
              )}
            >
              <Icon className="h-3 w-3" />
              {f.label}
            </span>
          </Hint>
        );
      })}
    </div>
  );
}
