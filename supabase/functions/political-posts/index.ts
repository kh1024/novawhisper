// Political Posts feed — pulls REAL social posts (not news headlines).
// Primary: Reddit (r/politics, r/PoliticalDiscussion, r/Conservative, r/Liberal,
//          r/PoliticalHumor, r/Trumpvirus, r/news) via the existing reddit-pulse function.
// Fallback / top-up: Firecrawl Search for site:truthsocial.com and site:x.com
// for high-profile political accounts.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

const POLITICAL_SUBS = [
  "politics",
  "PoliticalDiscussion",
  "Conservative",
  "Liberal",
  "PoliticalHumor",
  "moderatepolitics",
];

// Firecrawl queries for actual platform posts. The trick:
//   • Direct site:truthsocial.com/@realDonaldTrump returns post URLs but JS-blocked
//     descriptions ("To use this website, please enable JavaScript"). We scrape
//     each URL to get real post text.
//   • @TrumpDailyPosts on X mirrors every Trump TS post with full text + timestamp,
//     so it's the best source for previews when scraping fails.
const FIRECRAWL_QUERIES = [
  "site:truthsocial.com/@realDonaldTrump",
  "site:x.com TrumpDailyPosts Trump Truth Social Post",
  "site:x.com (from:elonmusk OR from:SpeakerJohnson OR from:POTUS OR from:WhiteHouse)",
];

interface NormalizedPost {
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

function hostFromUrl(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

function platformFromUrl(u: string): NormalizedPost["platform"] {
  const h = hostFromUrl(u).toLowerCase();
  if (h.includes("reddit")) return "reddit";
  if (h.includes("truthsocial")) return "truthsocial";
  if (h === "x.com" || h === "twitter.com" || h.endsWith(".x.com")) return "x";
  return "other";
}

async function fetchRedditPolitical(): Promise<NormalizedPost[]> {
  if (!SUPABASE_URL || !SERVICE_KEY) return [];
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/reddit-pulse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subs: POLITICAL_SUBS, sort: ["hot"], limit: 15 }),
    });
    if (!r.ok) {
      console.warn("[political-posts] reddit-pulse status", r.status);
      return [];
    }
    const data = await r.json();
    const posts = (data?.posts ?? []) as Array<{
      id: string; title: string; excerpt: string; url: string; sub: string;
      score: number; comments: number; author: string; publishedAt: string;
    }>;
    return posts.map((p) => ({
      id: `reddit:${p.id}`,
      headline: p.title,
      summary: p.excerpt,
      source: `r/${p.sub}`,
      url: p.url,
      author: p.author,
      publishedAt: p.publishedAt,
      score: p.score,
      comments: p.comments,
      platform: "reddit" as const,
    }));
  } catch (e) {
    console.warn("[political-posts] reddit fetch error", e);
    return [];
  }
}

async function firecrawlSearch(query: string, limit: number) {
  if (!FIRECRAWL_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, tbs: "qdr:d" }),
    });
    if (!r.ok) { console.warn("[political-posts] firecrawl", r.status); return []; }
    const j = await r.json();
    const arr =
      j?.data?.web?.results ?? j?.web?.results ?? j?.data ?? j?.results ?? [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { console.warn("[political-posts] firecrawl error", e); return []; }
}

async function fetchSocialPlatforms(): Promise<NormalizedPost[]> {
  if (!FIRECRAWL_KEY) return [];
  const settled = await Promise.allSettled(FIRECRAWL_QUERIES.map((q) => firecrawlSearch(q, 4)));
  const seen = new Set<string>();
  const out: NormalizedPost[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const h of s.value) {
      const url = h?.url as string | undefined;
      if (!url || seen.has(url)) continue;
      const platform = platformFromUrl(url);
      // Only keep actual platform posts, drop generic web pages
      if (platform !== "truthsocial" && platform !== "x") continue;
      seen.add(url);
      out.push({
        id: url,
        headline: (h.title ?? "").trim() || "(untitled post)",
        summary: ((h.description ?? h.markdown ?? "") as string).slice(0, 280),
        source: hostFromUrl(url),
        url,
        publishedAt: new Date().toISOString(),
        platform,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(40, Number(body.limit ?? 24));
    const includeSocial = body.includeSocial !== false; // default true

    const [reddit, social] = await Promise.all([
      fetchRedditPolitical(),
      includeSocial ? fetchSocialPlatforms() : Promise.resolve([]),
    ]);

    // Merge: social posts first (more authentic), then top reddit by score.
    const merged = [...social, ...reddit].slice(0, limit);

    return new Response(
      JSON.stringify({
        posts: merged,
        counts: { reddit: reddit.length, social: social.length, total: merged.length },
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("political-posts error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
