import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink, Loader2 } from "lucide-react";
import { useNews } from "@/lib/liveData";
import { formatDistanceToNow } from "date-fns";

interface Props {
  symbol?: string | null;
  title?: string;
  limit?: number;
  className?: string;
  sources?: string[];
  sourceLabel?: string;
}

export function NewsFeed({ symbol = null, title, limit = 8, className = "", sources, sourceLabel }: Props) {
  const { data: items = [], isLoading, isFetching, error } = useNews({ symbol, limit, sources });
  const heading = title ?? (symbol ? `${symbol} News` : "Market News");
  const providerLabel = sourceLabel ?? (sources?.length ? `via ${sources.join(" · ")}` : "via Yahoo · Reuters · MarketWatch");

  return (
    <Card className={`glass-card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" /> {heading}
        </h2>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>{providerLabel}</span>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-14 w-14 rounded-md shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-3 w-[60%]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-bearish py-4">
          Couldn't load news. {(error as Error).message}
        </div>
      )}

      {!isLoading && items.length === 0 && !error && (
        <div className="text-xs text-muted-foreground py-4 text-center">No recent stories.</div>
      )}

      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {items.map((n) => {
          let when = "";
          try { when = formatDistanceToNow(new Date(n.publishedAt), { addSuffix: true }); } catch { /* ignore */ }
          return (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="flex gap-3 p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-surface/50 transition-all group"
            >
              {n.image ? (
                <img
                  src={n.image}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 rounded-md object-cover bg-muted shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="h-14 w-14 rounded-md bg-surface/60 flex items-center justify-center shrink-0">
                  <Newspaper className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                  {n.headline}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                  <span className="font-medium truncate max-w-[120px]">{n.source}</span>
                  {when && <><span>·</span><span>{when}</span></>}
                  <ExternalLink className="h-2.5 w-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </Card>
  );
}
