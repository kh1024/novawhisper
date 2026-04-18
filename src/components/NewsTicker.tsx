import { Newspaper, Loader2, ExternalLink } from "lucide-react";
import { useNews } from "@/lib/liveData";
import { formatDistanceToNow } from "date-fns";

// Aggregated news sources — Finnhub forwards stories from these publishers.
const NEWS_SOURCES = ["yahoo", "cnbc", "marketwatch", "reuters", "motley fool", "seeking alpha", "msnbc", "bloomberg"];

export function NewsTicker() {
  const { data: items = [], isLoading } = useNews({
    limit: 30,
    sources: NEWS_SOURCES,
    refetchMs: 3 * 60_000,
  });

  if (isLoading || items.length === 0) {
    return (
      <div className="w-full border-b border-border bg-surface/40 backdrop-blur-xl py-2 flex items-center justify-center text-[11px] text-muted-foreground gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading market headlines…
      </div>
    );
  }

  const loop = [...items, ...items];

  return (
    <div className="relative w-full overflow-hidden border-b border-border bg-surface/40 backdrop-blur-xl">
      <div className="flex items-center">
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-r border-border/60 bg-surface/70 text-[11px] font-semibold tracking-wide uppercase text-primary">
          <Newspaper className="h-3 w-3" />
          Headlines
        </div>
        <div className="ticker-track py-2" style={{ animationDuration: "180s" }}>
          {loop.map((n, i) => {
            let when = "";
            try { when = formatDistanceToNow(new Date(n.publishedAt), { addSuffix: true }); } catch { /* ignore */ }
            return (
              <a
                key={`${n.id}-${i}`}
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-5 border-r border-border/40 shrink-0 group hover:bg-surface/60 transition-colors"
                title={n.headline}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/80 truncate max-w-[100px]">
                  {n.source}
                </span>
                <span className="text-xs text-foreground/90 truncate max-w-[420px] group-hover:text-primary transition-colors">
                  {n.headline}
                </span>
                {when && <span className="text-[10px] text-muted-foreground">· {when}</span>}
                <ExternalLink className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            );
          })}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-[110px] w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
