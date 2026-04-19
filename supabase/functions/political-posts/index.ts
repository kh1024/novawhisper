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
  if (!FIRECRAWL_KEY) { console.warn("[political-posts] FIRECRAWL_API_KEY missing"); return []; }
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, tbs: "qdr:d" }),
    });
    if (!r.ok) { console.warn("[political-posts] firecrawl HTTP", r.status, await r.text().catch(() => "")); return []; }
    const j = await r.json();
    const arr =
      j?.data?.web?.results ?? j?.data?.web ?? j?.web?.results ?? j?.web ?? j?.data ?? j?.results ?? [];
    if (!Array.isArray(arr) || arr.length === 0) {
      console.warn("[political-posts] firecrawl empty for query:", query, "shape keys:", Object.keys(j ?? {}), "data keys:", Object.keys(j?.data ?? {}));
    } else {
      console.log("[political-posts] firecrawl", query, "→", arr.length, "hits, sample:", arr[0]?.url);
    }
    return Array.isArray(arr) ? arr : [];
  } catch (e) { console.warn("[political-posts] firecrawl error", e); return []; }
}

// Truth Social blocks scrapers without JS, so search descriptions come back as
// "To use this website, please enable JavaScript." For those URLs we fire a
// Firecrawl scrape (which renders JS) to pull the actual post text + timestamp.
const JS_PLACEHOLDER = /enable javascript/i;

interface ScrapeResult { text: string | null; publishedAt: string | null }

async function firecrawlScrape(url: string): Promise<ScrapeResult> {
  if (!FIRECRAWL_KEY) return { text: null, publishedAt: null };
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 2000 }),
    });
    if (!r.ok) return { text: null, publishedAt: null };
    const j = await r.json();
    const md: string = (j?.data?.markdown ?? j?.markdown ?? "") as string;
    if (!md) return { text: null, publishedAt: null };
    return { text: cleanTruthSocialMarkdown(md), publishedAt: extractTruthSocialTimestamp(md) };
  } catch { return { text: null, publishedAt: null }; }
}

/** Strip Truth Social UI chrome (nav, avatar, reply counts, links) and return
 *  just the post body text. */
function cleanTruthSocialMarkdown(md: string): string {
  let s = md;
  const verifiedIdx = s.indexOf("Verified Account");
  if (verifiedIdx >= 0) s = s.slice(verifiedIdx + "Verified Account".length);
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, " ");        // image markdown
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");       // link markdown → text
  s = s.replace(/\b(Back|# ?Truth Details|\d+\s+replies|ReTruths?|Likes?|Reply|Boost|Quote|Favorite|More|Share|Bookmark|Translate post|@realDonaldTrump|Donald J\.? ?Trump)\b/gi, " ");
  s = s.replace(/[\\|]+/g, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, 280);
}

/** Find a relative ("2h", "5m ago") or absolute timestamp in the rendered page. */
function extractTruthSocialTimestamp(md: string): string | null {
  const rel = md.match(/\b(\d+)\s*(s|m|h|d)\b(?!\w)/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - n * mult).toISOString();
  }
  const abs = md.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}[^A-Za-z]+\d{1,2}:\d{2}\s*(AM|PM)/i);
  if (abs) {
    const t = Date.parse(abs[0]);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

async function fetchSocialPlatforms(): Promise<NormalizedPost[]> {
  if (!FIRECRAWL_KEY) return [];
  const settled = await Promise.allSettled(FIRECRAWL_QUERIES.map((q) => firecrawlSearch(q, 6)));
  const seen = new Set<string>();
  const drafts: NormalizedPost[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const h of s.value) {
      const url = h?.url as string | undefined;
      if (!url || seen.has(url)) continue;
      const platform = platformFromUrl(url);
      if (platform !== "truthsocial" && platform !== "x") continue;
      seen.add(url);
      const rawDesc = ((h.description ?? h.markdown ?? "") as string).trim();
      const summary = JS_PLACEHOLDER.test(rawDesc) ? "" : rawDesc.slice(0, 280);
      const title = (h.title ?? "").trim();
      const headline = title.includes("Truth Social") && platform === "truthsocial"
        ? "Donald J. Trump · Truth Social post"
        : (title || "(untitled post)");
      // X-mirror summaries embed the actual TS post time, e.g.
      //   "Donald J. Trump Truth Social Post of Video 09:26 PM EST 04.18.26 Chills."
      const tsTime = extractMirrorTimestamp(`${title} ${rawDesc}`);
      drafts.push({
        id: url, headline, summary, source: hostFromUrl(url), url,
        publishedAt: tsTime ?? new Date().toISOString(), platform,
      });
    }
  }
  // Scrape Truth Social posts (max 6 in parallel) for cleaned text + real timestamp.
  const needsScrape = drafts.filter((p) => p.platform === "truthsocial").slice(0, 6);
  await Promise.all(needsScrape.map(async (p) => {
    const { text, publishedAt } = await firecrawlScrape(p.url);
    if (text && text.length > 8) {
      p.summary = text;
      const firstLine = text.split(/[.!?\n]/)[0].trim();
      if (firstLine.length > 8 && firstLine.length < 120) p.headline = firstLine;
    }
    if (publishedAt) p.publishedAt = publishedAt;
  }));
  // Most recent first so freshest social posts top the merged feed.
  drafts.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  return drafts;
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
