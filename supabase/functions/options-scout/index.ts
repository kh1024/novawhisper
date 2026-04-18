// Options Scout — scrapes finance sites via Firecrawl for live options ideas,
// then Nova (Lovable AI) buckets them into Safe / Mild / Aggressive plays.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// Search queries we run via Firecrawl /v2/search — each returns top results
// with scraped markdown so Nova can read the actual articles, not just titles.
const QUERIES = [
  { tier: "safe", q: "best safe options trades this week covered calls cash secured puts" },
  { tier: "safe", q: "best dividend stocks options income strategy today" },
  { tier: "mild", q: "best options plays this week vertical spreads moderate risk" },
  { tier: "mild", q: "best swing trade options ideas next week catalyst" },
  { tier: "aggressive", q: "unusual options activity today whale trades aggressive" },
  { tier: "aggressive", q: "0DTE options momentum plays today high risk high reward" },
];

async function fcSearch(query: string): Promise<Array<{ url: string; title: string; markdown: string }>> {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: 4,
        tbs: "qdr:d", // last 24h
        scrapeOptions: { formats: ["markdown"] },
      }),
    });
    if (!r.ok) {
      console.warn(`[options-scout] firecrawl search "${query}" -> ${r.status}`);
      return [];
    }
    const j = await r.json();
    const items: Array<{ url: string; title?: string; markdown?: string; description?: string }> = j?.data?.web ?? j?.data ?? [];
    return items
      .filter((i) => i?.url && (i.markdown || i.description))
      .map((i) => ({ url: i.url, title: i.title ?? "", markdown: (i.markdown ?? i.description ?? "").slice(0, 4000) }));
  } catch (e) {
    console.warn(`[options-scout] search failed "${query}"`, e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // 1) Scrape all sources in parallel
    const scraped = (await Promise.all(SOURCES.map((s) => scrape(s.url).then((r) => r ? { ...r, name: s.name } : null))))
      .filter((x): x is { url: string; markdown: string; name: string } => x !== null);

    if (scraped.length === 0) {
      return new Response(JSON.stringify({ error: "No sources could be scraped right now. Try again in a moment." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Build context for Nova
    const context = scraped.map((s) => `### ${s.name}\nSource: ${s.url}\n\n${s.markdown}`).join("\n\n---\n\n");

    const systemPrompt = `You are Nova, an experienced options strategist. You read live scraped data from finance sites and produce three actionable buckets of options ideas for the next session:

- SAFE: low-risk income/hedging plays (covered calls, cash-secured puts on blue chips, long-dated debit spreads on stable names). Defined risk, high probability.
- MILD: moderate-risk directional plays (vertical spreads, 30-45 DTE single-leg on liquid names with a clear catalyst).
- AGGRESSIVE: high-risk/high-reward (0DTE-7DTE, naked single-leg on momentum names, earnings straddles, unusual-activity follow-the-whale).

For each pick: ticker, strategy, thesis (1 sentence grounded in the scraped data), entry idea, key risk. Pick 2-3 per bucket. Only use tickers you actually saw in the source data. Cite which source mentioned it.`;

    const userPrompt = `Scraped finance sources (${scraped.length} sites):\n\n${context}\n\nReturn three buckets via the tool.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "options_buckets",
            description: "Return safe/mild/aggressive options ideas.",
            parameters: {
              type: "object",
              properties: {
                marketRead: { type: "string", description: "One sentence market read from the scraped data." },
                safe: { type: "array", items: pickSchema() },
                mild: { type: "array", items: pickSchema() },
                aggressive: { type: "array", items: pickSchema() },
              },
              required: ["marketRead", "safe", "mild", "aggressive"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "options_buckets" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit on AI gateway. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      console.error("[options-scout] AI error", aiResp.status, t);
      throw new Error(`AI gateway ${aiResp.status}`);
    }
    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let buckets: Record<string, unknown> = { marketRead: "", safe: [], mild: [], aggressive: [] };
    if (toolCall?.function?.arguments) {
      try { buckets = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[options-scout] parse failed", e); }
    }

    return new Response(
      JSON.stringify({
        ...buckets,
        sources: scraped.map((s) => ({ name: s.name, url: s.url })),
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("options-scout error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function pickSchema() {
  return {
    type: "object",
    properties: {
      symbol: { type: "string" },
      strategy: { type: "string", description: "e.g. 'Covered call', 'Bull put spread', '0DTE call', 'Long straddle'" },
      thesis: { type: "string" },
      entry: { type: "string", description: "Concrete entry idea — strikes/expiry/direction." },
      risk: { type: "string", description: "Main risk in one line." },
      source: { type: "string", description: "Which scraped source flagged it." },
    },
    required: ["symbol", "strategy", "thesis", "entry", "risk", "source"],
    additionalProperties: false,
  };
}
