// Hooks for the Planning page — wraps the three new edge functions.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SourceTicker {
  symbol: string;
  mentions: number;
  bull: number;
  bear: number;
  neutral: number;
  bias: "bull" | "bear" | "neutral";
  heat: number;
  topPost?: { title: string; url: string; score: number; comments: number; sub: string };
  topVideo?: { title: string; url: string; views: number; channel: string };
}

export interface RedditPost {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  sub: string;
  score: number;
  comments: number;
  author: string;
  flair: string | null;
  upvoteRatio: number | null;
  publishedAt: string;
  tickers: string[];
  sentiment: "bull" | "bear" | "neutral";
}

export interface YouTubeVideo {
  id: string;
  title: string;
  channel: string;
  publishedAt: string;
  thumbnail: string;
  url: string;
  views: number;
  likes: number;
  commentCount: number;
  tickers: string[];
  sentiment: "bull" | "bear" | "neutral";
  comments: { text: string; author: string; likes: number; publishedAt: string; tickers: string[]; sentiment: string }[];
}

export interface PlanningPick {
  symbol: string;
  bias: "bullish" | "bearish" | "neutral" | "fade";
  conviction: "A" | "B" | "C";
  thesis: string;
  catalysts: string[];
  risks: string[];
  sources: ("youtube" | "quote")[];
  /** Calls or puts only — multi-leg structures were retired across the app. */
  optionType: "call" | "put";
  direction: "long" | "short";
  strike: number;
  /** Kept on the type for back-compat with persisted rows; always undefined for new picks. */
  strikeShort?: number;
  expiry: string;
  playAt: number;
  premiumEstimate?: string;
}

export interface PlanningResult {
  synthesis: { marketTone: string; picks: PlanningPick[] };
  sources: {
    youtube: { tickers: SourceTicker[]; videos: YouTubeVideo[]; query: string; fetchedAt: string } | null;
    quotes: { symbol: string; price: number; changePct: number; volume: number; status: string }[];
  };
  fetchedAt: string;
}

export function usePlanning(opts?: { includeYouTube?: boolean; ytQuery?: string }) {
  return useQuery({
    queryKey: ["planning", opts?.includeYouTube ?? true, opts?.ytQuery ?? ""],
    queryFn: async (): Promise<PlanningResult> => {
      const { data, error } = await supabase.functions.invoke("planning-synthesis", { body: opts ?? {} });
      if (error) throw error;
      const r = data as PlanningResult;
      // Drop any legacy spread/condor/straddle picks that might come from cached responses.
      const cleanedPicks = (r.synthesis?.picks ?? []).filter(
        (p) => p.optionType === "call" || p.optionType === "put",
      );
      return { ...r, synthesis: { ...r.synthesis, picks: cleanedPicks } };
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}
