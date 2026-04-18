// Options Scout — scrapes finance sites via Firecrawl for live options ideas,
// then Nova (Lovable AI) buckets them into Safe / Mild / Aggressive plays.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Search queries we run via Firecrawl /v2/search — each returns top results
// with scraped markdown so Nova can read the actual articles, not just titles.
const QUERIES = [
  { tier: "safe", q: "best safe options trades this week covered calls cash secured puts" },
  { tier: "safe", q: "best dividend stocks options income strategy today" },
  { tier: "mild", q: "best options plays this week vertical spreads moderate risk" },
  { tier: "mild", q: "best swing trade options ideas next week catalyst" },
  { tier: "aggressive", q: "unusual options activity today whale trades aggressive" },
  { tier: "aggressive", q: "0DTE options momentum plays today high risk high reward" },
  { tier: "mild", q: "site:seekingalpha.com earnings calendar this week expected move" },
  { tier: "aggressive", q: "site:cnbc.com pre-market movers today stocks gainers losers" },
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

    // 1) Run all Firecrawl searches in parallel (last 24h)
    const groups = await Promise.all(
      QUERIES.map(async (q) => ({ tier: q.tier, query: q.q, results: await fcSearch(q.q) })),
    );
    const totalResults = groups.reduce((n, g) => n + g.results.length, 0);
    if (totalResults === 0) {
      return new Response(JSON.stringify({ error: "Firecrawl returned no results. Try again in a moment." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Build context for Nova
    const context = groups.map((g) =>
      `### Search bucket: ${g.tier.toUpperCase()} — "${g.query}"\n\n` +
      g.results.map((r) => `- [${r.title || r.url}](${r.url})\n${r.markdown}`).join("\n\n")
    ).join("\n\n---\n\n");

    const allSources = groups.flatMap((g) => g.results.map((r) => ({ name: r.title || new URL(r.url).hostname, url: r.url })));

    const systemPrompt = `You are Nova, an experienced options strategist. You read live web search results from Firecrawl (last 24 hours) and produce three actionable buckets of options ideas for the next session:

- SAFE: low-risk income/hedging plays (covered calls, cash-secured puts on blue chips, long-dated debit spreads on stable names). Defined risk, high probability.
- MILD: moderate-risk directional plays (vertical spreads, 30-45 DTE single-leg on liquid names with a clear catalyst).
- AGGRESSIVE: high-risk/high-reward (0DTE-7DTE, naked single-leg on momentum names, earnings straddles, unusual-activity follow-the-whale).

CRITICAL — every pick MUST include concrete, tradeable numbers:
- exact strike price (number, USD)
- expiry date (YYYY-MM-DD, pick a real upcoming Friday or monthly expiry)
- option type (call / put / spread / straddle etc.) and direction (long / short)
- "play at" underlying price — the spot level at which the trade makes sense to enter
- a premium estimate range

Do NOT return vague entries like "buy calls if it breaks out". If you don't have enough info to pick a strike and expiry, drop the idea. Pick 2-3 per bucket. Only use tickers that explicitly appear in the article text. Today's date is ${new Date().toISOString().slice(0, 10)} — choose expiries in the future.`;

    const userPrompt = `Web search results (Firecrawl, last 24h, grouped by intended risk tier):\n\n${context}\n\nReturn three buckets via the tool with concrete strikes, expiries, and play-at prices for every pick.`;

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
        sources: allSources,
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
      symbol: { type: "string", description: "Underlying ticker, e.g. AAPL" },
      strategy: { type: "string", description: "e.g. 'Covered call', 'Bull put spread', '0DTE call', 'Long straddle'" },
      optionType: { type: "string", enum: ["call", "put", "call_spread", "put_spread", "straddle", "strangle", "iron_condor"], description: "Primary leg type" },
      direction: { type: "string", enum: ["long", "short"], description: "Buying (long) or selling (short) the primary leg" },
      strike: { type: "number", description: "Primary strike price in USD. For spreads, the long-leg strike." },
      strikeShort: { type: "number", description: "Optional second strike for spreads/multi-leg (the short leg)." },
      expiry: { type: "string", description: "Expiration date in YYYY-MM-DD format. Use the next standard monthly or weekly expiry that fits the strategy." },
      playAt: { type: "number", description: "Underlying price at which to enter the trade (USD)." },
      premiumEstimate: { type: "string", description: "Rough expected option premium per contract, e.g. '$1.20-$1.40' or 'collect $0.85 credit'." },
      thesis: { type: "string" },
      risk: { type: "string", description: "Main risk in one line." },
      source: { type: "string", description: "Which source flagged it (URL or domain)." },
    },
    required: ["symbol", "strategy", "optionType", "direction", "strike", "expiry", "playAt", "thesis", "risk", "source"],
    additionalProperties: false,
  };
}
