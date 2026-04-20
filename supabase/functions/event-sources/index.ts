// Pulls fresh, topic-specific articles + social posts for an event-risk
// category (geopolitics, political, fed, earnings) using Firecrawl Search.
// Returns a normalized list the UI can render directly.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");

type Category = "geopolitics" | "political" | "fed" | "earnings";

const QUERIES: Record<Category, string[]> = {
  geopolitics: [
    "site:reuters.com OR site:apnews.com OR site:bbc.com war sanctions tariffs missile strike today",
    "site:ft.com OR site:wsj.com OR site:bloomberg.com geopolitical risk markets today",
    "site:reddit.com/r/worldnews OR site:reddit.com/r/geopolitics breaking today",
  ],
  political: [
    "site:reuters.com OR site:apnews.com OR site:axios.com Trump executive order White House today",
    "site:politico.com OR site:thehill.com Congress Senate vote today",
    "site:truthsocial.com OR site:x.com Trump post today",
    "site:reddit.com/r/politics breaking today",
  ],
  fed: [
    "site:reuters.com OR site:bloomberg.com OR site:wsj.com Fed FOMC Powell rate decision today",
    "site:ft.com OR site:cnbc.com CPI PCE inflation jobs report today",
    "site:federalreserve.gov speech statement",
    "treasury yield 10-year today",
  ],
  earnings: [
    // Real corporate earnings prints — keep queries simple so Firecrawl
    // returns actual hits. Each one targets a single high-quality earnings
    // source with explicit "earnings beat/miss/guidance" wording.
    "earnings beat estimates EPS revenue today site:cnbc.com",
    "quarterly earnings results beat miss site:reuters.com",
    "earnings report EPS revenue site:seekingalpha.com",
    "earnings beat raised guidance site:bloomberg.com",
    "earnings preannounce profit warning site:wsj.com",
    "earnings calendar today site:earningswhispers.com",
  ],
};

interface SearchHit {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

interface NormalizedItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image?: string;
  publishedAt: string;
}

function hostFromUrl(u: string): string {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return h;
  } catch {
    return "source";
  }
}

async function firecrawlSearch(query: string, limit: number, tbs: string): Promise<SearchHit[]> {
  const r = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit, tbs }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("[firecrawl search]", r.status, query.slice(0, 60), t.slice(0, 200));
    return [];
  }
  const data = await r.json();
  // v2 returns { success, data: { web: [...], news: [...] } } most commonly,
  // but older shapes used data.web.results / web.results. Try them all and
  // also fall back to data.news for news vertical results.
  const arr =
    (data?.data?.web?.results as SearchHit[] | undefined) ??
    (data?.data?.web as SearchHit[] | undefined) ??
    (data?.data?.news as SearchHit[] | undefined) ??
    (data?.web?.results as SearchHit[] | undefined) ??
    (data?.data as SearchHit[] | undefined) ??
    (data?.results as SearchHit[] | undefined) ??
    [];
  if (!Array.isArray(arr) || arr.length === 0) {
    console.log("[firecrawl search] empty", query.slice(0, 60), "shape:", Object.keys(data ?? {}), "data keys:", Object.keys(data?.data ?? {}));
  }
  return Array.isArray(arr) ? arr : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY not configured");

    const body = await req.json().catch(() => ({}));
    const category = (body.category as Category) ?? "geopolitics";
    const limit = Math.min(20, Number(body.limit ?? 12));

    const queries = QUERIES[category] ?? QUERIES.geopolitics;
    const perQuery = Math.max(3, Math.ceil(limit / queries.length) + 1);

    // Earnings prints cluster around report days — widen to last week.
    const tbs = category === "earnings" ? "qdr:w" : "qdr:d";
    const settled = await Promise.allSettled(queries.map((q) => firecrawlSearch(q, perQuery, tbs)));
    const all: SearchHit[] = [];
    for (const s of settled) if (s.status === "fulfilled") all.push(...s.value);

    // Deduplicate by URL, normalize
    const seen = new Set<string>();
    const items: NormalizedItem[] = [];
    for (const h of all) {
      if (!h?.url || seen.has(h.url)) continue;
      seen.add(h.url);
      const headline = (h.title ?? "").trim();
      if (!headline) continue;
      items.push({
        id: h.url,
        headline,
        summary: (h.description ?? h.markdown ?? "").slice(0, 280),
        source: hostFromUrl(h.url),
        url: h.url,
        publishedAt: new Date().toISOString(),
      });
      if (items.length >= limit) break;
    }

    return new Response(JSON.stringify({ category, items, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("event-sources error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
