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
    "site:reuters.com OR site:cnbc.com OR site:bloomberg.com earnings beat miss guidance today",
    "site:seekingalpha.com OR site:barrons.com quarterly earnings today",
    "site:wsj.com earnings preannounce warning today",
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

async function firecrawlSearch(query: string, limit: number): Promise<SearchHit[]> {
  const r = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      tbs: "qdr:d", // last 24h
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("[firecrawl search]", r.status, t);
    return [];
  }
  const data = await r.json();
  // v2 may return { web: { results: [...] } } or { data: [...] }
  const arr =
    (data?.data?.web?.results as SearchHit[] | undefined) ??
    (data?.web?.results as SearchHit[] | undefined) ??
    (data?.data as SearchHit[] | undefined) ??
    (data?.results as SearchHit[] | undefined) ??
    [];
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

    const settled = await Promise.allSettled(queries.map((q) => firecrawlSearch(q, perQuery)));
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
