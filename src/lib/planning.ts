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
      return data as PlanningResult;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}
