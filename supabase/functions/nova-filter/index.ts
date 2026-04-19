// NOVA Filter — natural-language → structured pick-filter spec.
// Uses Lovable AI tool-calling to extract a clean JSON schema the
// frontend can apply across Dashboard / Scanner / Web Picks.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const TOOL = {
  type: "function",
  function: {
    name: "build_filter_spec",
    description:
      "Convert a trader's natural-language ask into a structured filter spec. " +
      "Only set fields you are confident about; leave others null/empty. " +
      "Budget is the total dollars the user has — the app will require premium × 100 ≤ budget.",
    parameters: {
      type: "object",
      properties: {
        budget: { type: ["number", "null"], description: "Total $ available for ONE contract." },
        riskBuckets: {
          type: "array",
          items: { type: "string", enum: ["safe", "mild", "aggressive"] },
        },
        bias: {
          type: "array",
          items: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        },
        optionTypes: {
          type: "array",
          items: { type: "string", enum: ["call", "put"] },
        },
        strategies: {
          type: "array",
          items: { type: "string" },
          description: "Substring of strategy name e.g. 'csp', 'covered-call', 'long-call', 'leaps'.",
        },
        symbols: { type: "array", items: { type: "string" }, description: "Restrict to these tickers (uppercase)." },
        excludeSymbols: { type: "array", items: { type: "string" } },
        expiryFrom: { type: ["string", "null"], description: "ISO yyyy-mm-dd inclusive." },
        expiryTo: { type: ["string", "null"], description: "ISO yyyy-mm-dd inclusive." },
        minDte: { type: ["number", "null"] },
        maxDte: { type: ["number", "null"] },
        minScore: { type: ["number", "null"], description: "0-100." },
        minAnnualized: { type: ["number", "null"], description: "Annualized % return floor." },
        excludeEarnings: { type: "boolean", description: "Drop picks with earnings within 7d." },
        rationale: { type: "string", description: "One short sentence echoing what you understood." },
      },
      required: ["rationale"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query } = await req.json();
    if (typeof query !== "string" || query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const today = new Date().toISOString().slice(0, 10);
    const dow = new Date().toLocaleDateString("en-US", { weekday: "long" });

    const systemPrompt = [
      `You are NOVA's filter parser. Today is ${today} (${dow}).`,
      "Convert the trader's ask into a structured filter spec via the build_filter_spec tool.",
      "RULES:",
      "- 'I have $X' or 'with $X' → budget=X. Treat budget as the price of ONE contract (premium × 100).",
      "- 'safe' / 'income' / 'conservative' → riskBuckets=['safe']. 'aggressive' / 'YOLO' → ['aggressive'].",
      "- 'puts' → optionTypes=['put']. 'calls' → ['call'].",
      "- 'bullish' / 'long' → bias=['bullish']. 'bearish' / 'hedge' → ['bearish'].",
      "- 'this week' → expiryTo = next Friday. 'monday' alone usually means picks expiring or active by next Monday — set expiryFrom=today and expiryTo to that Monday.",
      "- 'short-dated' → maxDte=14. 'leaps' or 'long-dated' → minDte=180.",
      "- Be conservative: only set fields the user actually mentioned.",
      "- Always include a friendly one-sentence rationale.",
    ].join(" ");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "build_filter_spec" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded — try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI credits exhausted — top up in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await resp.text();
      console.error("nova-filter gateway error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return a filter spec." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let spec: any;
    try { spec = JSON.parse(call.function.arguments); }
    catch { spec = {}; }

    return new Response(JSON.stringify({ spec }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("nova-filter error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
