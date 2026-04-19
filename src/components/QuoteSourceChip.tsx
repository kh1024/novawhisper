// Tiny chip that surfaces which provider supplied the price (the "consensus
// source") and, on hover, lists every source's price + a ⚠ flag when
// providers disagree by more than 0.5%.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerifiedQuote } from "@/lib/liveData";

const SHORT: Record<string, string> = {
  yahoo: "yhoo",
  finnhub: "fnhb",
  "alpha-vantage": "alpha",
  massive: "msv",
  stooq: "stooq",
  cnbc: "cnbc",
  google: "ggl",
};

const DISAGREE_PCT = 0.5;

interface Props {
  quote: Pick<VerifiedQuote, "consensusSource" | "sources" | "diffPct" | "status"> | null | undefined;
  className?: string;
}

export function QuoteSourceChip({ quote, className }: Props) {
  if (!quote || !quote.consensusSource) return null;
  const disagree = quote.diffPct != null && quote.diffPct >= DISAGREE_PCT;
  const live = Object.entries(quote.sources)
    .filter(([, v]) => v != null && Number(v) > 0)
    .map(([k, v]) => ({ name: k, price: Number(v) }));
  const tooltip = (
    <div className="space-y-1 text-xs leading-snug">
      <div className="font-semibold">
        Consensus: <span className="font-mono">{quote.consensusSource}</span>
      </div>
      {live.length > 0 && (
        <div className="space-y-0.5">
          {live.map((s) => (
            <div key={s.name} className="flex justify-between gap-3 font-mono">
              <span className={s.name === quote.consensusSource ? "text-foreground" : "text-muted-foreground"}>
                {s.name}
              </span>
              <span>${s.price.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      {quote.diffPct != null && (
        <div className={cn("pt-1 border-t border-border/40", disagree ? "text-warning" : "text-muted-foreground")}>
          {disagree ? "⚠ " : ""}
          Spread between sources: {quote.diffPct.toFixed(2)}%
        </div>
      )}
    </div>
  );
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[9px] font-mono uppercase tracking-wider cursor-help",
              disagree
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-border/60 bg-surface/40 text-muted-foreground",
              className,
            )}
          >
            {disagree && <AlertTriangle className="h-2.5 w-2.5" />}
            {SHORT[quote.consensusSource] ?? quote.consensusSource}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
