// Portfolio Verdict — pulls a live underlying quote for each open position and
// asks Nova (Lovable AI) for an honest, plain-English verdict per position.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface InPosition {
  id: string;
  symbol: string;
  optionType: string;
  direction: string;
  strike: number;
  strikeShort?: number | null;
  expiry: string;
  contracts: number;
  entryPremium?: number | null;
  entryUnderlying?: number | null;
  thesis?: string | null;
}

interface Quote { symbol: string; price: number; changePct: number; status: string }

async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return [];
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/quotes-fetch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbols }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.quotes ?? []) as Quote[];
  } catch (e) {
    console.warn("[portfolio-verdict] quotes fetch failed", e);
    return [];
  }
}

function daysTo(expiry: string): number {
  const d = new Date(expiry + "T16:00:00Z").getTime();
  return Math.round((d - Date.now()) / 86_400_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = await req.json();
    const positions: InPosition[] = body?.positions ?? [];
    if (!positions.length) {
      return new Response(JSON.stringify({ verdicts: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const symbols = [...new Set(positions.map((p) => p.symbol.toUpperCase()))];
    const quotes = await fetchQuotes(symbols);
    const qMap = new Map(quotes.map((q) => [q.symbol, q]));

    // Pre-compute moneyness/DTE so the prompt is short and precise.
    const enriched = positions.map((p) => {
      const q = qMap.get(p.symbol.toUpperCase());
      const dte = daysTo(p.expiry);
      const spot = q?.price ?? null;
      const isCall = p.optionType.includes("call");
      const isPut = p.optionType.includes("put");
      let moneyness: string | null = null;
      if (spot != null) {
        if (isCall) moneyness = spot > p.strike ? "ITM" : spot < p.strike ? "OTM" : "ATM";
        else if (isPut) moneyness = spot < p.strike ? "ITM" : spot > p.strike ? "OTM" : "ATM";
      }
      const distancePct = spot != null ? ((spot - p.strike) / p.strike) * 100 : null;
      return { ...p, spot, dte, moneyness, distancePct, dayChangePct: q?.changePct ?? null };
    });

    const systemPrompt = `You are Nova, a brutally honest options trading coach. Speak like a friend at the bar — straight, no fluff, no hedging your bets, plain English. No legal disclaimers.
For each open position you receive:
1) Decide one of: "winning", "bleeding", "in trouble", "expiring worthless", "running fine", "neutral".
2) Give a 1-2 sentence verdict telling them exactly what's happening and what to do (hold / take profit / cut / roll). Be specific with the strike and DTE.
3) Be honest — if it's a stupid trade, say so. If it's printing, say so.

Never say "consult a financial advisor" or any disclaimer. Never use the word "synergy". Use the trader vocabulary: ITM/OTM, DTE, theta, IV crush, etc.`;

    const userPrompt = `Open positions with live underlying:\n${JSON.stringify(enriched, null, 2)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "score_positions",
            description: "Return one verdict per position id.",
            parameters: {
              type: "object",
              properties: {
                verdicts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      status: { type: "string", enum: ["winning", "bleeding", "in trouble", "expiring worthless", "running fine", "neutral"] },
                      verdict: { type: "string", description: "1-2 honest sentences." },
                      action: { type: "string", enum: ["hold", "take_profit", "cut", "roll", "let_expire"] },
                    },
                    required: ["id", "status", "verdict", "action"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["verdicts"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "score_positions" } },
      }),
    });
    if (!aiResp.ok) {
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit on AI gateway." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await aiResp.text();
      console.error("[portfolio-verdict] AI error", aiResp.status, t);
      throw new Error(`AI gateway ${aiResp.status}`);
    }
    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: { verdicts: unknown[] } = { verdicts: [] };
    if (toolCall?.function?.arguments) {
      try { parsed = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[portfolio-verdict] parse failed", e); }
    }
    return new Response(
      JSON.stringify({ verdicts: parsed.verdicts, quotes, fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("portfolio-verdict error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
