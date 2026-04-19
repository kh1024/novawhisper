// Reddit Ideas — scrapes finance subreddits for posts that mention a ticker
// AND concrete option details (strike / expiry / calls or puts). Each idea is
// clickable: it prefills the Strategy Builder profile (outlook + horizon).
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Flame, MessageSquare, RefreshCcw, ArrowUpRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { TraderProfile } from "@/lib/settings";

interface RedditIdea {
  id: string;
  symbol: string;
  side: "call" | "put" | "unknown";
  strike: number | null;
  expiry: string | null;
  dteHint: string | null;
  sentiment: "bull" | "bear" | "neutral";
  title: string;
  excerpt: string;
  url: string;
  sub: string;
  score: number;
  comments: number;
  author: string;
  publishedAt: string;
  matchedPhrases: string[];
}

interface IdeasResponse {
  scanned: number;
  ideaCount: number;
  ideas: RedditIdea[];
  fetchedAt: string;
}

interface Props {
  onApply: (patch: Partial<TraderProfile>, idea: RedditIdea) => void;
}

function ideaToProfile(i: RedditIdea): Partial<TraderProfile> {
  const horizon: TraderProfile["horizon"] =
    i.dteHint?.includes("0DTE") ? "intraday" :
    i.dteHint?.toLowerCase().includes("leap") ? "position" :
    "swing";
  let outlook: TraderProfile["outlook"];
  if (i.side === "call") outlook = i.sentiment === "bull" ? "bullish" : "slightly_bullish";
  else if (i.side === "put") outlook = i.sentiment === "bear" ? "bearish" : "slightly_bearish";
  else outlook = i.sentiment === "bull" ? "slightly_bullish" : i.sentiment === "bear" ? "slightly_bearish" : "neutral";
  return { horizon, outlook };
}

export function RedditIdeasCard({ onApply }: Props) {
  const q = useQuery<IdeasResponse>({
    queryKey: ["reddit-options-ideas"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("reddit-options-ideas", {
        body: { limit: 40 },
      });
      if (error) throw error;
      return data as IdeasResponse;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const ideas = q.data?.ideas ?? [];

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-orange-500" /> Reddit Ideas · live
          </div>
          <h2 className="mt-1 text-base font-semibold">Trending option setups from r/options, WSB, ThetaGang…</h2>
          <p className="text-xs text-muted-foreground">
            Posts that mention a ticker <em>and</em> a concrete option detail (strike, expiry, or calls/puts). Click an idea to prefill the Strategy Builder.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCcw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {q.isLoading && (
        <div className="text-xs text-muted-foreground py-6 text-center">Scanning Reddit…</div>
      )}
      {q.isError && (
        <div className="text-xs text-bearish py-3">
          Failed to load ideas: {(q.error as Error)?.message ?? "unknown error"}
        </div>
      )}
      {!q.isLoading && !q.isError && ideas.length === 0 && (
        <div className="text-xs text-muted-foreground py-6 text-center">
          No concrete option ideas in the last batch. Try refreshing in a few minutes.
        </div>
      )}

      {ideas.length > 0 && (
        <ScrollArea className="h-[420px] pr-2">
          <div className="space-y-2">
            {ideas.map((i) => (
              <IdeaRow key={i.id} idea={i} onApply={onApply} />
            ))}
          </div>
        </ScrollArea>
      )}

      {q.data && (
        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Scanned {q.data.scanned} posts · {q.data.ideaCount} qualified · updated {new Date(q.data.fetchedAt).toLocaleTimeString()}
        </div>
      )}
    </Card>
  );
}

function IdeaRow({ idea, onApply }: { idea: RedditIdea; onApply: Props["onApply"] }) {
  const sideColor =
    idea.side === "call" ? "text-bullish border-bullish/40 bg-bullish/10" :
    idea.side === "put"  ? "text-bearish border-bearish/40 bg-bearish/10" :
    "text-muted-foreground border-border bg-surface/50";
  const sentColor =
    idea.sentiment === "bull" ? "text-bullish" :
    idea.sentiment === "bear" ? "text-bearish" : "text-muted-foreground";

  const apply = () => onApply(ideaToProfile(idea), idea);

  return (
    <div className="rounded-md border border-border/60 bg-surface/30 p-2.5 hover:border-primary/40 transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-0.5 pt-0.5 min-w-[44px]">
          <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">{idea.symbol}</Badge>
          <span className={cn("text-[9px] uppercase font-bold tracking-wider rounded border px-1 py-0", sideColor)}>
            {idea.side === "unknown" ? "?" : idea.side.toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-[12px] font-medium leading-snug line-clamp-2">{idea.title}</div>
          <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
            {idea.strike != null && (
              <span className="font-mono text-foreground/90">${idea.strike}</span>
            )}
            {idea.dteHint && (
              <span className="rounded bg-primary/10 text-primary px-1 py-0 font-medium">{idea.dteHint}</span>
            )}
            {!idea.dteHint && idea.expiry && (
              <span className="rounded bg-primary/10 text-primary px-1 py-0 font-medium">{idea.expiry}</span>
            )}
            <span className={cn("font-semibold", sentColor)}>· {idea.sentiment}</span>
            <span>· r/{idea.sub}</span>
            <span>· ▲{idea.score}</span>
            <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{idea.comments}</span>
          </div>
          {idea.excerpt && (
            <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">{idea.excerpt}</div>
          )}
          <div className="flex items-center gap-1.5 pt-1">
            <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={apply}>
              <Sparkles className="h-3 w-3 mr-1" /> Use in Builder
            </Button>
            <a
              href={idea.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 h-6 px-2 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface/50"
            >
              <ExternalLink className="h-3 w-3" /> Reddit <ArrowUpRight className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
