// Inline live price next to a ticker symbol. Shares the live-quotes cache
// per-symbol so multiple instances of the same ticker only fetch once.
//
// During pre-market / after-hours sessions we surface a small badge ("PRE" or
// "AH") plus the extended-hours price next to the regular price so traders see
// the gap forming before the open / after the close.
import { useLiveQuotes, sessionLabel } from "@/lib/liveData";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  className?: string;
  showChange?: boolean;
  /** Optional override price (skip the fetch when caller already has it). */
  price?: number | null;
  changePct?: number | null;
}

interface PillProps {
  px: number;
  pct: number | null;
  className?: string;
  showChange?: boolean;
  ext?: { session: "pre" | "post"; price: number; pct: number | null } | null;
}

function FetchedTickerPrice({ symbol, className, showChange }: { symbol: string; className?: string; showChange?: boolean }) {
  const { data } = useLiveQuotes([symbol], { refetchMs: 60_000 });
  const q = data?.find((x) => x.symbol === symbol);
  if (!q || q.price == null) return null;
  const ext = (q.session === "pre" || q.session === "post") && q.extendedPrice != null
    ? { session: q.session, price: q.extendedPrice, pct: q.extendedChangePct ?? null }
    : null;
  return <Pill px={q.price} pct={q.changePct} className={className} showChange={showChange} ext={ext} />;
}

function Pill({ px, pct, className, showChange, ext }: PillProps) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-mono text-xs text-muted-foreground", className)}>
      <span className="text-foreground/80">${px.toFixed(2)}</span>
      {showChange && pct != null && (
        <span className={cn("text-[10px]", pct >= 0 ? "text-bullish" : "text-bearish")}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      )}
      {ext && (
        <ExtendedBadge session={ext.session} price={ext.price} pct={ext.pct} />
      )}
    </span>
  );
}

function ExtendedBadge({ session, price, pct }: { session: "pre" | "post"; price: number; pct: number | null }) {
  const label = sessionLabel(session);
  if (!label) return null;
  return (
    <span
      title={`${label.long}: $${price.toFixed(2)}${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : ""}`}
      className={cn(
        "ml-0.5 inline-flex items-baseline gap-0.5 rounded border px-1 py-0 text-[9px] font-semibold tracking-wider",
        session === "pre"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-warning/40 bg-warning/10 text-warning",
      )}
    >
      {label.short} ${price.toFixed(2)}
      {pct != null && (
        <span className={cn(pct >= 0 ? "text-bullish" : "text-bearish")}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

export function TickerPrice({ symbol, className, showChange = false, price, changePct }: Props) {
  if (price != null) return <Pill px={price} pct={changePct ?? null} className={className} showChange={showChange} ext={null} />;
  return <FetchedTickerPrice symbol={symbol} className={className} showChange={showChange} />;
}
