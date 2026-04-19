// Inline "budget-friendly alternative" hint shown on a pick card when the
// estimated contract cost exceeds the user's per-trade budget.
//
// Strategy: same-sector peer with a cheaper underlying ⇒ cheaper ATM premium.
// We never auto-execute or replace the original pick — we only *suggest*, so
// the user keeps the higher-conviction setup visible.
import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { findBudgetPeer } from "@/lib/peers";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  /** Estimated cost of the original pick's single contract (premium × 100). */
  contractCost: number;
  budget: number;
  className?: string;
}

export function BudgetAltSuggestion({ symbol, contractCost, budget, className }: Props) {
  if (!Number.isFinite(contractCost) || contractCost <= 0) return null;
  if (contractCost <= budget) return null;

  const peer = findBudgetPeer(symbol, budget);
  if (!peer) return null;

  const fits = peer.estContractCost <= budget;
  const overage = +((contractCost - budget) / budget * 100).toFixed(0);

  const tip = (
    <div className="space-y-1.5 text-xs leading-snug max-w-[260px]">
      <div className="font-semibold">Over budget by ~{overage}%</div>
      <div className="text-muted-foreground">
        {symbol} contract ≈ <span className="font-mono">${Math.round(contractCost)}</span>, your cap is{" "}
        <span className="font-mono">${budget}</span>.
      </div>
      <div className="pt-1 border-t border-border/40">
        <div className="font-semibold text-foreground">
          Try {peer.symbol} {fits ? "(fits budget)" : "(closest peer)"}
        </div>
        {peer.name && <div className="text-muted-foreground">{peer.name}</div>}
        <div className="text-muted-foreground font-mono">
          ATM ≈ ${peer.estPremium.toFixed(2)} · 1 contract ≈ ${Math.round(peer.estContractCost)}
        </div>
        <div className="text-muted-foreground italic mt-1">
          Same sector, cheaper underlying. Not a perfect correlation — confirm setup before entering.
        </div>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider cursor-help",
              fits ? "border-primary/40 bg-primary/10 text-primary" : "border-warning/40 bg-warning/10 text-warning",
              className,
            )}
          >
            <Sparkles className="h-2.5 w-2.5" />
            alt: {peer.symbol}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
