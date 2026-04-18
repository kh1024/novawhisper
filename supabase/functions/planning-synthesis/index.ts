// Planning Synthesis — combines Reddit + YouTube + our quotes into a ranked
// next-session watchlist using Lovable AI (Gemini 2.5 Pro) via tool calling.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

interface SourceTicker { symbol: string; mentions: number; bull: number; bear: number; neutral: number; bias: string; heat: number }

async function invoke(fn: string, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn(`[planning] ${fn} ${r.status}`);
    return null;
  }
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const includeYouTube: boolean = body.includeYouTube !== false;
    const ytQuery: string = body.ytQuery ?? "stock market today options unusual activity";

    // 1) Pull YouTube (Reddit dropped — IPs blocked across providers)
    const youtube = includeYouTube ? await invoke("youtube-chatter", { query: ytQuery, maxVideos: 8, commentsPerVideo: 5 }) : null;
    const ytTickers: SourceTicker[] = youtube?.tickers ?? [];

    const universe = new Set<string>();
    for (const t of ytTickers.slice(0, 30)) universe.add(t.symbol);
    const symbols = [...universe].slice(0, 30);

    // 2) Pull our verified quotes for that universe
    const quotesData = symbols.length ? await invoke("quotes-fetch", { symbols }) : null;
    const quotes = (quotesData?.quotes ?? []) as Array<{ symbol: string; price: number; changePct: number; volume: number; status: string }>;
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    // 3) Build a compact summary for the LLM
    const merged = symbols.map((sym) => {
      const r = redditTickers.find((t) => t.symbol === sym);
      const y = ytTickers.find((t) => t.symbol === sym);
      const q = quoteMap.get(sym);
      return {
        symbol: sym,
        reddit: r ? { mentions: r.mentions, bias: r.bias, heat: r.heat } : null,
        youtube: y ? { mentions: y.mentions, bias: y.bias, heat: y.heat } : null,
        quote: q ? { price: q.price, changePct: Number(q.changePct.toFixed(2)), volume: q.volume, status: q.status } : null,
      };
    });

    const topRedditPosts = (reddit?.posts ?? []).slice(0, 10).map((p: { title: string; sub: string; score: number; tickers: string[] }) => ({
      title: p.title.slice(0, 140), sub: p.sub, score: p.score, tickers: p.tickers,
    }));
    const topVideos = (youtube?.videos ?? []).slice(0, 6).map((v: { title: string; channel: string; views: number; tickers: string[] }) => ({
      title: v.title.slice(0, 140), channel: v.channel, views: v.views, tickers: v.tickers,
    }));

    // 4) Call Lovable AI with structured tool output
    const systemPrompt = `You are Nova, an experienced options trader analyzing tomorrow's session.
You synthesize three things: (a) what retail is talking about on Reddit, (b) what finance YouTube creators are covering, (c) verified market quotes.
Pick 5-8 tickers worth watching for the next session. For each, give a directional bias, a one-sentence thesis, key catalysts, and risks.
Be honest: if hype is high but data is weak, say "fade the noise". Avoid generic advice.`;

    const userPrompt = `INTERNET TALK SUMMARY (next session planning)\n\nUniverse + per-source signals:\n${JSON.stringify(merged, null, 2)}\n\nTop Reddit posts:\n${JSON.stringify(topRedditPosts, null, 2)}\n\nTop YouTube videos:\n${JSON.stringify(topVideos, null, 2)}\n\nReturn a ranked watchlist via the tool.`;

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
            name: "rank_watchlist",
            description: "Return a ranked next-session watchlist.",
            parameters: {
              type: "object",
              properties: {
                marketTone: { type: "string", description: "One sentence on overall market vibe heading into the next session." },
                picks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      symbol: { type: "string" },
                      bias: { type: "string", enum: ["bullish", "bearish", "neutral", "fade"] },
                      conviction: { type: "string", enum: ["A", "B", "C"] },
                      thesis: { type: "string" },
                      catalysts: { type: "array", items: { type: "string" } },
                      risks: { type: "array", items: { type: "string" } },
                      sources: { type: "array", items: { type: "string", enum: ["reddit", "youtube", "quote"] } },
                    },
                    required: ["symbol", "bias", "conviction", "thesis", "catalysts", "risks", "sources"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["marketTone", "picks"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "rank_watchlist" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit hit on AI gateway. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      console.error("[planning] AI error", aiResp.status, errText);
      throw new Error(`AI gateway ${aiResp.status}`);
    }
    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let synthesis: { marketTone: string; picks: unknown[] } = { marketTone: "", picks: [] };
    if (toolCall?.function?.arguments) {
      try { synthesis = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[planning] parse tool args failed", e); }
    }

    return new Response(
      JSON.stringify({
        synthesis,
        sources: {
          reddit: { tickers: redditTickers.slice(0, 15), posts: (reddit?.posts ?? []).slice(0, 20), subs: reddit?.subs ?? [], fetchedAt: reddit?.fetchedAt },
          youtube: youtube ? { tickers: ytTickers.slice(0, 15), videos: (youtube?.videos ?? []).slice(0, 8), query: youtube?.query, fetchedAt: youtube?.fetchedAt } : null,
          quotes,
        },
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("planning-synthesis error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
