// Inline live price next to a ticker symbol. Shares the live-quotes cache
// per-symbol so multiple instances of the same ticker only fetch once.
import { useLiveQuotes } from "@/lib/liveData";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  className?: string;
  showChange?: boolean;
  /** Optional override price (skip the fetch when caller already has it). */
  price?: number | null;
  changePct?: number | null;
}

export function TickerPrice({ symbol, className, showChange = false, price, changePct }: Props) {
  const enabled = price == null;
  const { data } = useLiveQuotes(enabled ? [symbol] : [], { refetchMs: 60_000 });
  const q = enabled ? data?.find((x) => x.symbol === symbol) : null;
  const px = price ?? q?.price ?? null;
  const pct = changePct ?? q?.changePct ?? null;

  if (px == null) return null;
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-mono text-xs text-muted-foreground", className)}>
      <span className="text-foreground/80">${px.toFixed(2)}</span>
      {showChange && pct != null && (
        <span className={cn("text-[10px]", pct >= 0 ? "text-bullish" : "text-bearish")}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      )}
    </span>
  );
}
