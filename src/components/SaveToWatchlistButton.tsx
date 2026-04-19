import { Lock, Star } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/Hint";
import { cn } from "@/lib/utils";
import {
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useWatchlist,
  watchlistKeyOf,
  type NewWatchlistItem,
} from "@/lib/watchlist";
import type { ValidationResult } from "@/lib/gates";

interface Props extends NewWatchlistItem {
  size?: "sm" | "xs";
  className?: string;
  /** When the gate pipeline returns BLOCKED, disable the Save/Buy CTA. */
  validation?: ValidationResult | null;
}

export function SaveToWatchlistButton({ size = "sm", className, validation, ...pick }: Props) {
  const { data: items = [] } = useWatchlist();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();

  const existing = useMemo(() => {
    const key = watchlistKeyOf(pick);
    return items.find((i) => watchlistKeyOf(i) === key) ?? null;
  }, [items, pick]);

  const watching = !!existing;
  const pending = add.isPending || remove.isPending;

  // Kill switch — Gate pipeline returned BLOCKED → no new save allowed.
  // (We still let users REMOVE an already-watched item so they can clean up.)
  const blocked = validation?.finalStatus === "BLOCKED" && !watching;
  const blockedReason = blocked
    ? validation?.gateResults.find((g) => g.status === "BLOCKED")?.reasoning
        ?? "A safety gate is blocking this trade."
    : null;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending || blocked) return;
    if (existing) remove.mutate(existing.id);
    else add.mutate(pick);
  };

  if (blocked) {
    return (
      <Hint label={`🚫 BLOCKED — ${blockedReason}`}>
        <Button
          size="sm"
          variant="outline"
          disabled
          onClick={(e) => e.stopPropagation()}
          className={cn(
            size === "xs" ? "h-6 px-2 text-[10px]" : "h-7 px-2 text-[11px]",
            "border-bearish/40 bg-bearish/10 text-bearish opacity-80 cursor-not-allowed",
            className,
          )}
        >
          <Lock className="mr-1 h-3 w-3" />
          Blocked
        </Button>
      </Hint>
    );
  }

  return (
    <Hint label={watching ? "Remove from watchlist" : "Add to watchlist — review on the Dashboard with a live verdict"}>
      <Button
        size="sm"
        variant={watching ? "secondary" : "outline"}
        onClick={onClick}
        disabled={pending}
        className={cn(
          size === "xs" ? "h-6 px-2 text-[10px]" : "h-7 px-2 text-[11px]",
          watching && "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
          className,
        )}
      >
        <Star className={cn("mr-1 h-3 w-3", watching && "fill-current")} />
        {watching ? "Watching" : "Watch"}
      </Button>
    </Hint>
  );
}
