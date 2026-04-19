// PickMetaChips — shared chip row used by the live Web Picks panel and the
// History panel so both surfaces render the same five rich signals:
//   • bias      (bullish / bearish / neutral)
//   • expected return
//   • probability
//   • risk level (low / medium / high)
//   • grade A/B/C with rationale tooltip
//
// All inputs are optional — the chip set degrades gracefully when NOVA didn't
// return that signal for a given pick.
import { TrendingUp, TrendingDown, Minus, Target, Percent, ShieldAlert, Award } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PickMeta {
  bias?: "bullish" | "bearish" | "neutral" | string | null;
  expectedReturn?: string | null;
  probability?: string | null;
  riskLevel?: "low" | "medium" | "high" | string | null;
  grade?: "A" | "B" | "C" | string | null;
  gradeRationale?: string | null;
}

const baseChip =
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none";

function biasMeta(b?: string | null) {
  if (!b) return null;
  if (b === "bullish") return { Icon: TrendingUp, cls: "border-bullish/40 bg-bullish/10 text-bullish", label: "Bullish" };
  if (b === "bearish") return { Icon: TrendingDown, cls: "border-bearish/40 bg-bearish/10 text-bearish", label: "Bearish" };
  return { Icon: Minus, cls: "border-border bg-muted/40 text-muted-foreground", label: "Neutral" };
}

function riskMeta(r?: string | null) {
  if (!r) return null;
  if (r === "low") return { cls: "border-bullish/40 bg-bullish/10 text-bullish", label: "Low risk" };
  if (r === "high") return { cls: "border-bearish/40 bg-bearish/10 text-bearish", label: "High risk" };
  return { cls: "border-warning/40 bg-warning/10 text-warning", label: "Medium risk" };
}

function gradeMeta(g?: string | null) {
  if (!g) return null;
  if (g === "A") return { cls: "border-bullish/50 bg-bullish/15 text-bullish" };
  if (g === "B") return { cls: "border-warning/50 bg-warning/15 text-warning" };
  return { cls: "border-bearish/50 bg-bearish/15 text-bearish" };
}

export function PickMetaChips({ meta, compact = false }: { meta: PickMeta; compact?: boolean }) {
  const bias = biasMeta(meta.bias ?? undefined);
  const risk = riskMeta(meta.riskLevel ?? undefined);
  const grade = gradeMeta(meta.grade ?? undefined);
  const has = bias || meta.expectedReturn || meta.probability || risk || grade;
  if (!has) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("flex flex-wrap items-center gap-1", compact ? "gap-1" : "gap-1.5")}>
        {bias && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(baseChip, bias.cls, "cursor-help")}>
                <bias.Icon className="h-2.5 w-2.5" />
                {bias.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Directional bias NOVA assigned.</TooltipContent>
          </Tooltip>
        )}

        {meta.expectedReturn && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(baseChip, "border-primary/40 bg-primary/10 text-primary cursor-help")}>
                <Target className="h-2.5 w-2.5" />
                {meta.expectedReturn}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Expected return on capital.</TooltipContent>
          </Tooltip>
        )}

        {meta.probability && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(baseChip, "border-border/60 bg-surface/60 text-foreground/90 cursor-help")}>
                <Percent className="h-2.5 w-2.5" />
                {meta.probability}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">NOVA's win probability estimate.</TooltipContent>
          </Tooltip>
        )}

        {risk && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(baseChip, risk.cls, "cursor-help uppercase tracking-wider")}>
                <ShieldAlert className="h-2.5 w-2.5" />
                {risk.label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Risk level NOVA assigned to this idea.</TooltipContent>
          </Tooltip>
        )}

        {grade && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(baseChip, grade.cls, "cursor-help font-bold tracking-wider px-2")}>
                <Award className="h-2.5 w-2.5" />
                Grade {meta.grade}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
              {meta.gradeRationale || "NOVA's overall conviction grade for this pick."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
