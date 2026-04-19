// Small pill that shows what % of a user's account a single contract would
// consume, plus the absolute dollar cost. Color shifts from green → amber →
// red as the trade approaches / exceeds the 5% per-trade cap (Gate 8).
import { Wallet } from "lucide-react";
import { Hint } from "@/components/Hint";
import { cn } from "@/lib/utils";
import { AFFORDABILITY_CAP_PCT, type ValidationResult } from "@/lib/gates";

interface Props {
  result: ValidationResult;
  className?: string;
  /** "xs" = 10px chip, "sm" = 11px chip. Default xs. */
  size?: "xs" | "sm";
}

export function BudgetImpactPill({ result, className, size = "xs" }: Props) {
  const b = result.budgetImpact;
  if (!b || !Number.isFinite(b.contractCost) || b.contractCost <= 0) return null;

  const pct = b.pctOfPortfolio;
  const tone = b.overBudget
    ? "border-bearish/50 bg-bearish/15 text-bearish"
    : pct > AFFORDABILITY_CAP_PCT * 0.6
      ? "border-warning/50 bg-warning/15 text-warning"
      : "border-bullish/40 bg-bullish/10 text-bullish";

  const text = size === "xs" ? "text-[10px]" : "text-[11px]";

  const tooltip = b.overBudget
    ? `This trade would consume ${pct.toFixed(1)}% of your $${b.accountBalance.toLocaleString()} account ($${b.contractCost.toFixed(0)}) — over the ${AFFORDABILITY_CAP_PCT}% per-trade cap.${b.suggestion ? `\n\nSuggestion: ${b.suggestion.title} — ${b.suggestion.detail}` : ""}`
    : `This trade uses ${pct.toFixed(1)}% of your $${b.accountBalance.toLocaleString()} buying power ($${b.contractCost.toFixed(0)}). Cap: ${AFFORDABILITY_CAP_PCT}%.`;

  return (
    <Hint label={tooltip}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-bold tracking-wide cursor-help mono",
          text,
          tone,
          className,
        )}
      >
        <Wallet className="h-3 w-3" />
        {pct.toFixed(1)}% · ${b.contractCost >= 1000 ? `${(b.contractCost / 1000).toFixed(1)}k` : b.contractCost.toFixed(0)}
      </span>
    </Hint>
  );
}
