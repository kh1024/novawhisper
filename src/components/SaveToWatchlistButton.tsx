import { Star } from "lucide-react";
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

interface Props extends NewWatchlistItem {
  size?: "sm" | "xs";
  className?: string;
}

export function SaveToWatchlistButton({ size = "sm", className, ...pick }: Props) {
  const { data: items = [] } = useWatchlist();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();

  const existing = useMemo(() => {
    const key = watchlistKeyOf(pick);
    return items.find((i) => watchlistKeyOf(i) === key) ?? null;
  }, [items, pick]);

  const watching = !!existing;
  const pending = add.isPending || remove.isPending;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    if (existing) remove.mutate(existing.id);
    else add.mutate(pick);
  };

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
