// StockData.org news proxy.
// GET /v1/news/all?symbols=...&filter_entities=true&language=en&api_token=...
// → { data: [{ uuid, title, description, url, image_url, published_at, source, ... }] }
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const Body = z.object({
  symbols: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional(),
  // Accepts the same loose "category" shape as news-fetch so the health ping
  // (`{ category: "general", limit: 3 }`) won't 400.
  category: z.string().optional(),
});

interface SDArticle {
  uuid?: string;
  title?: string;
  description?: string;
  url?: string;
  image_url?: string;
  published_at?: string;
  source?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("STOCKDATA_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "STOCKDATA_API_KEY is not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_body", detail: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const { symbols, limit = 10 } = parsed.data;

    const params = new URLSearchParams({
      api_token: key,
      filter_entities: "true",
      language: "en",
      limit: String(Math.min(limit, 50)),
    });
    if (symbols && symbols.length) params.set("symbols", symbols.join(","));

    const r = await fetch(`https://api.stockdata.org/v1/news/all?${params}`);
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `StockData news HTTP ${r.status}`, detail: (await r.text()).slice(0, 400) }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const j = await r.json() as { data?: SDArticle[] };
    const items = (j.data ?? []).map((a) => ({
      id: a.uuid ?? a.url ?? "",
      title: a.title ?? "",
      summary: a.description ?? "",
      url: a.url ?? "",
      image: a.image_url ?? null,
      ts: a.published_at ? new Date(a.published_at).getTime() : Date.now(),
      source: a.source ?? "stockdata",
    }));
    return new Response(JSON.stringify({ ok: true, items }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
