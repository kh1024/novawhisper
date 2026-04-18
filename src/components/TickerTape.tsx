import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { useLiveQuotes } from "@/lib/liveData";

export function TickerTape() {
  const { data: quotes = [], isLoading } = useLiveQuotes(undefined, { refetchMs: 60_000 });

  if (isLoading || quotes.length === 0) {
    return (
      <div className="w-full border-y border-border bg-surface/60 backdrop-blur-xl py-2.5 flex items-center justify-center text-xs text-muted-foreground gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Fetching live quotes…
      </div>
    );
  }

  // duplicate for seamless infinite scroll
  const loop = [...quotes, ...quotes];

  return (
    <div className="relative w-full overflow-hidden border-y border-border bg-surface/60 backdrop-blur-xl">
      <div className="ticker-track py-2.5">
        {loop.map((q, i) => {
          const up = q.change >= 0;
          return (
            <div
              key={`${q.symbol}-${i}`}
              className="flex items-center gap-2 px-5 border-r border-border/40 shrink-0"
            >
              <span className="font-mono text-sm font-semibold tracking-wide">{q.symbol}</span>
              <span className="mono text-sm text-foreground/90">${q.price.toFixed(2)}</span>
              <span
                className={`mono text-xs flex items-center gap-0.5 ${up ? "text-bullish" : "text-bearish"}`}
              >
                {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {up ? "+" : ""}{q.change.toFixed(2)} ({up ? "+" : ""}{q.changePct.toFixed(2)}%)
              </span>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
