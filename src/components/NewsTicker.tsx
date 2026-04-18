import { Newspaper, Loader2, ExternalLink, Siren } from "lucide-react";
import { useNews } from "@/lib/liveData";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

// Aggregated news sources — Finnhub forwards stories from these publishers.
const NEWS_SOURCES = ["yahoo", "cnbc", "marketwatch", "reuters", "motley fool", "seeking alpha", "msnbc", "bloomberg"];

// Headlines containing any of these keywords are treated as "breaking" and
// rendered as a red pulsing pill so they cut through the normal scroll.
// Covers: explicit breaking tags, the President / White House, Fed Chair,
// and macro shock words (war, attack, strike, sanctions, halt, crash).
const BREAKING_PATTERNS = [
  /\bbreaking\b/i,
  /\balert\b/i,
  /\bjust in\b/i,
  /\bdeveloping\b/i,
  /\btrump\b/i,
  /\bpresident\b/i,
  /\bpotus\b/i,
  /\bwhite house\b/i,
  /\boval office\b/i,
  /\btruth social\b/i,
  /\bfed chair\b/i,
  /\bpowell\b/i,
  /\bemergency\b/i,
  /\bhalt(ed)?\b/i,
  /\bcrash(es|ed|ing)?\b/i,
  /\bplunge(s|d)?\b/i,
  /\bwar\b/i,
  /\battack(ed|s)?\b/i,
  /\bstrike(s)?\b/i,
  /\bsanction(s|ed)?\b/i,
  /\btariff(s)?\b/i,
];

function isBreaking(headline: string, source?: string): boolean {
  const text = `${headline} ${source ?? ""}`;
  return BREAKING_PATTERNS.some((re) => re.test(text));
}

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
            const breaking = isBreaking(n.headline, n.source);
            let when = "";
            try { when = formatDistanceToNow(new Date(n.publishedAt), { addSuffix: true }); } catch { /* ignore */ }
            return (
              <a
                key={`${n.id}-${i}`}
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "flex items-center gap-2 px-5 border-r border-border/40 shrink-0 group transition-colors",
                  breaking
                    ? "bg-bearish/15 hover:bg-bearish/25 animate-pulse"
                    : "hover:bg-surface/60",
                )}
                title={breaking ? `BREAKING: ${n.headline}` : n.headline}
              >
                {breaking ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bearish text-bearish-foreground text-[9px] font-bold uppercase tracking-widest shrink-0">
                    <Siren className="h-2.5 w-2.5" />
                    Breaking
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/80 truncate max-w-[100px]">
                    {n.source}
                  </span>
                )}
                <span
                  className={cn(
                    "text-xs truncate max-w-[420px] transition-colors",
                    breaking
                      ? "text-bearish font-semibold"
                      : "text-foreground/90 group-hover:text-primary",
                  )}
                >
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
