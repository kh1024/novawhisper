// Derives EVENT RISK signals.
// Geopolitics / Fed / Earnings come from the news feed.
// Political Posts comes from REAL social media (Reddit political subs +
// Truth Social / X via the political-posts edge function).
import { useNews } from "./liveData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

const GEOPOLITICS_TERMS = [
  "war", "military", "strike", "missile", "invasion", "ceasefire", "sanctions",
  "ukraine", "russia", "israel", "gaza", "iran", "taiwan", "china tension",
  "north korea", "houthi", "red sea", "tariff", "trade war", "embargo",
  "geopolitical", "conflict", "attack",
];

const POLITICAL_TERMS = [
  "trump", "biden", "white house", "executive order", "tweet", "truth social",
  "post", "remarks", "statement", "press conference", "xi jinping", "putin",
  "netanyahu", "congress", "senate vote", "shutdown", "election",
];

const FED_RATES_TERMS = [
  "fed", "fomc", "powell", "rate cut", "rate hike", "interest rate",
  "inflation", "cpi", "ppi", "pce", "jobs report", "nonfarm", "unemployment",
  "treasury yield", "10-year", "yield curve", "dot plot",
];

const EARNINGS_TERMS = [
  "earnings", "guidance", "quarterly results", "beat estimates", "miss estimates",
  "revenue", "eps", "outlook", "raised forecast", "lowered forecast", "warns",
  "warning", "preannounce",
];

const POSITIVE_HINTS = ["beat", "raise", "raised", "surge", "record", "strong", "ease", "ceasefire", "deal", "agreement"];
const NEGATIVE_HINTS = ["miss", "warn", "warning", "cut", "fall", "drop", "halt", "attack", "strike", "escalat", "tension", "shutdown", "tariff"];

export type SentimentTone = "good" | "ok" | "bad";

export interface EventRiskMatch {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image?: string;
  publishedAt: string;
}

export interface EventRiskSignal {
  key: "geopolitics" | "political" | "fed" | "earnings";
  label: string;
  tone: SentimentTone;
  status: string;       // big plain-English word
  meter: number;        // 0-100 (higher = MORE risk)
  detail: string;       // small subtitle
  hits: number;
  topHeadline?: string;
  matches: EventRiskMatch[];
}

type FeedItem = {
  id?: string;
  headline: string;
  summary: string;
  source?: string;
  url?: string;
  image?: string;
  publishedAt?: string;
};

function scoreFeed(items: FeedItem[], terms: string[]) {
  let hits = 0, pos = 0, neg = 0;
  let topHeadline: string | undefined;
  const matches: EventRiskMatch[] = [];
  for (const it of items) {
    const text = `${it.headline} ${it.summary}`.toLowerCase();
    if (!terms.some((t) => text.includes(t))) continue;
    hits += 1;
    if (!topHeadline) topHeadline = it.headline;
    if (POSITIVE_HINTS.some((h) => text.includes(h))) pos += 1;
    if (NEGATIVE_HINTS.some((h) => text.includes(h))) neg += 1;
    if (it.url) {
      matches.push({
        id: String(it.id ?? it.url),
        headline: it.headline,
        summary: it.summary ?? "",
        source: it.source ?? "Unknown",
        url: it.url,
        image: it.image,
        publishedAt: it.publishedAt ?? new Date().toISOString(),
      });
    }
  }
  return { hits, pos, neg, topHeadline, matches };
}

function buildSignal(
  key: EventRiskSignal["key"],
  label: string,
  raw: ReturnType<typeof scoreFeed>,
  thresholds: { hot: number; warm: number },
  zeroDetail: string,
  unit: string,
): EventRiskSignal {
  // Risk is HIGH when many hits, especially negative-leaning.
  const negRatio = raw.hits > 0 ? raw.neg / raw.hits : 0;
  const isHot = raw.hits >= thresholds.hot || (raw.hits >= 2 && negRatio >= 0.5);
  const isWarm = raw.hits >= thresholds.warm;
  const tone: SentimentTone = isHot ? "bad" : isWarm ? "ok" : "good";
  const status = isHot ? "Hot" : isWarm ? "Watch" : "Quiet";
  const meter = isHot ? 85 : isWarm ? 50 : 18;
  const detail = raw.topHeadline
    ? `${raw.hits} ${unit} · "${raw.topHeadline.slice(0, 60)}${raw.topHeadline.length > 60 ? "…" : ""}"`
    : zeroDetail;
  return { key, label, tone, status, meter, detail, hits: raw.hits, topHeadline: raw.topHeadline, matches: raw.matches };
}

interface PoliticalPost {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  author?: string;
  publishedAt: string;
  score?: number;
  comments?: number;
  platform: "reddit" | "truthsocial" | "x" | "other";
}

function usePoliticalPosts() {
  return useQuery({
    queryKey: ["political-posts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("political-posts", {
        body: { limit: 24, includeSocial: true },
      });
      if (error) throw error;
      return (data?.posts ?? []) as PoliticalPost[];
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 1,
  });
}

function buildPoliticalSignal(posts: PoliticalPost[]): EventRiskSignal {
  const hits = posts.length;
  const top = posts[0];
  const platformPosts = posts.filter((p) => p.platform === "truthsocial" || p.platform === "x").length;
  const isHot = hits >= 8 || platformPosts >= 3;
  const isWarm = hits >= 3;
  const tone: SentimentTone = isHot ? "bad" : isWarm ? "ok" : "good";
  const status = isHot ? "Hot" : isWarm ? "Watch" : "Quiet";
  const meter = isHot ? 85 : isWarm ? 50 : 18;
  const detail = top
    ? `${hits} social posts · "${top.headline.slice(0, 60)}${top.headline.length > 60 ? "…" : ""}"`
    : "No major political social posts right now";
  const matches: EventRiskMatch[] = posts.slice(0, 12).map((p) => ({
    id: p.id,
    headline: p.headline,
    summary: p.summary,
    source: p.source,
    url: p.url,
    publishedAt: p.publishedAt,
  }));
  return {
    key: "political",
    label: "Political Posts",
    tone, status, meter, detail, hits,
    topHeadline: top?.headline,
    matches,
  };
}

/** Pull the general news feed + political social posts and derive Event-Risk signals. */
export function useEventRiskSignals() {
  const { data: items = [], isLoading } = useNews({ category: "general", limit: 50 });
  const { data: politicalPosts = [], isLoading: politicalLoading } = usePoliticalPosts();

  return useMemo(() => {
    const geopolitics = buildSignal(
      "geopolitics",
      "Geopolitics",
      scoreFeed(items, GEOPOLITICS_TERMS),
      { hot: 3, warm: 1 },
      "No war/sanctions/tariff headlines",
      "geo headlines",
    );
    const political = buildPoliticalSignal(politicalPosts);
    const fed = buildSignal(
      "fed",
      "Fed / Rates",
      scoreFeed(items, FED_RATES_TERMS),
      { hot: 3, warm: 1 },
      "No Fed/CPI/yields headlines",
      "rate headlines",
    );
    const earnings = buildSignal(
      "earnings",
      "Earnings",
      scoreFeed(items, EARNINGS_TERMS),
      { hot: 5, warm: 2 },
      "No major earnings prints today",
      "earnings headlines",
    );

    return { geopolitics, political, fed, earnings, all: [geopolitics, political, fed, earnings], isLoading: isLoading || politicalLoading };
  }, [items, politicalPosts, isLoading, politicalLoading]);
}

// Backwards-compat: keep the old hook name as a deprecated alias so any
// stragglers still compile until removed.
export const useNarrativeSignals = useEventRiskSignals;
