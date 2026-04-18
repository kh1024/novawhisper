// Market news via Finnhub (aggregates Yahoo, Reuters, MarketWatch, Motley Fool, etc.)
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  datetime: number; // unix seconds
  related: string;
  category: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FINNHUB_KEY) throw new Error("FINNHUB_API_KEY not configured");

    const url = new URL(req.url);
    let symbol: string | null = null;
    let category = "general";
    let limit = 12;

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      symbol = body.symbol ?? null;
      category = body.category ?? "general";
      limit = Math.min(50, Number(body.limit ?? 12));
    } else {
      symbol = url.searchParams.get("symbol");
      category = url.searchParams.get("category") ?? "general";
      limit = Math.min(50, Number(url.searchParams.get("limit") ?? 12));
    }

    let endpoint: string;
    if (symbol) {
      // Company-specific news from last 7 days
      const to = new Date();
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      endpoint = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_KEY}`;
    } else {
      endpoint = `https://finnhub.io/api/v1/news?category=${encodeURIComponent(category)}&token=${FINNHUB_KEY}`;
    }

    const r = await fetch(endpoint);
    if (!r.ok) {
      const t = await r.text();
      console.error("[finnhub news]", r.status, t);
      throw new Error(`Finnhub news ${r.status}`);
    }
    const raw: NewsItem[] = await r.json();

    const items = (raw ?? [])
      .filter((n) => n.headline && n.url)
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, limit)
      .map((n) => ({
        id: String(n.id ?? n.url),
        headline: n.headline,
        summary: n.summary?.slice(0, 280) ?? "",
        source: n.source ?? "Unknown",
        url: n.url,
        image: n.image ?? "",
        publishedAt: new Date(n.datetime * 1000).toISOString(),
        related: n.related ?? symbol ?? "",
        category: n.category ?? category,
      }));

    return new Response(JSON.stringify({ items, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("news-fetch error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
