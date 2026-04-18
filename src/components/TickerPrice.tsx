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

function FetchedTickerPrice({ symbol, className, showChange }: { symbol: string; className?: string; showChange?: boolean }) {
  const { data } = useLiveQuotes([symbol], { refetchMs: 60_000 });
  const q = data?.find((x) => x.symbol === symbol);
  if (!q || q.price == null) return null;
  return <Pill px={q.price} pct={q.changePct} className={className} showChange={showChange} />;
}

function Pill({ px, pct, className, showChange }: { px: number; pct: number | null; className?: string; showChange?: boolean }) {
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

export function TickerPrice({ symbol, className, showChange = false, price, changePct }: Props) {
  if (price != null) return <Pill px={price} pct={changePct ?? null} className={className} showChange={showChange} />;
  return <FetchedTickerPrice symbol={symbol} className={className} showChange={showChange} />;
}
