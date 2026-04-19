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
      const y = ytTickers.find((t) => t.symbol === sym);
      const q = quoteMap.get(sym);
      return {
        symbol: sym,
        youtube: y ? { mentions: y.mentions, bias: y.bias, heat: y.heat } : null,
        quote: q ? { price: q.price, changePct: Number(q.changePct.toFixed(2)), volume: q.volume, status: q.status } : null,
      };
    });

    const topVideos = (youtube?.videos ?? []).slice(0, 6).map((v: { title: string; channel: string; views: number; tickers: string[] }) => ({
      title: v.title.slice(0, 140), channel: v.channel, views: v.views, tickers: v.tickers,
    }));

    // 4) Call Lovable AI with structured tool output
    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = `You are Nova, an experienced options trader analyzing tomorrow's session.
You synthesize two things: (a) what finance YouTube creators are covering and their comment sections, (b) verified market quotes.
Pick 5-8 tickers worth watching for the next session. For each, give a directional bias, a one-sentence thesis, key catalysts, risks, AND a concrete options play.

CRITICAL: This app trades CALLS or PUTS only — single leg, no multi-leg structures. Never propose spreads, condors, straddles, strangles, calendars, or any combo.

For each pick:
- option type: "call" or "put" (no other values allowed)
- direction: "long" or "short"
- exact strike price (number, USD) — pick a strike that fits the bias and current spot price from the quotes data
- expiry date in YYYY-MM-DD (a real upcoming Friday weekly or monthly expiry — today is ${today})
- "play at" underlying price (the spot level where the trade triggers)
- premium estimate range

If hype is high but data is weak, set bias to "fade" and pick the contrarian put (or call) — never invent a multi-leg structure to express it. Never return vague entries — every pick must be tradeable.`;

    const userPrompt = `INTERNET TALK SUMMARY (next session planning)\n\nUniverse + per-source signals:\n${JSON.stringify(merged, null, 2)}\n\nTop YouTube videos:\n${JSON.stringify(topVideos, null, 2)}\n\nReturn a ranked watchlist via the tool with concrete strikes, expiries, and play-at prices for every pick.`;

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
                      sources: { type: "array", items: { type: "string", enum: ["youtube", "quote"] } },
                      optionType: { type: "string", enum: ["call", "put"], description: "Single leg only — never propose spreads, condors, straddles, strangles, or any multi-leg combo." },
                      direction: { type: "string", enum: ["long", "short"] },
                      strike: { type: "number", description: "Strike price in USD." },
                      strikeShort: { type: "number", description: "DEPRECATED — leave omitted. Multi-leg structures are disabled." },
                      expiry: { type: "string", description: "Expiration date YYYY-MM-DD — pick a real upcoming Friday/monthly expiry." },
                      playAt: { type: "number", description: "Underlying spot price at which to enter the trade." },
                      premiumEstimate: { type: "string", description: "Rough premium estimate, e.g. '$1.20-$1.40' or 'collect $0.85 credit'." },
                    },
                    required: ["symbol", "bias", "conviction", "thesis", "catalysts", "risks", "sources", "optionType", "direction", "strike", "expiry", "playAt"],
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
    let synthesis: { marketTone: string; picks: Array<Record<string, unknown>> } = { marketTone: "", picks: [] };
    if (toolCall?.function?.arguments) {
      try { synthesis = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[planning] parse tool args failed", e); }
    }
    // Server-side guard: drop any non-call/put picks the model still produced.
    synthesis.picks = (synthesis.picks ?? []).filter(
      (p) => p.optionType === "call" || p.optionType === "put",
    );

    return new Response(
      JSON.stringify({
        synthesis,
        sources: {
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
