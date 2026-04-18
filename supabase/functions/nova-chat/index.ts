// Nova Chat — streaming AI chat available everywhere in the app via the floating bubble.
// Lightweight, page-context aware. Uses Lovable AI Gateway.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

interface Body {
  messages: ChatMsg[];
  pageContext?: {
    route?: string;
    focusedSymbol?: string | null;
    visibleSymbols?: string[];
    summary?: string;
  };
  model?: string;
}

const SYSTEM = `You are Nova, an honest options-trading copilot embedded in the user's Nova Whisper dashboard.

VOICE
- Conversational, plain English. Short sentences. No filler.
- A senior trader talking to a peer: skeptical, calm, never hyped.
- Use markdown freely (bold, bullets, inline code for tickers/strikes).

WHAT YOU KNOW
- The user is looking at a live market dashboard with quotes, options chains, news, and a portfolio.
- You receive light page context (current route, focused ticker, visible symbols). Use it but don't echo it back verbatim.
- You do NOT have tools to fetch live data here. If the user asks for a real-time quote/chain, tell them to open the ticker drawer or the Scanner — don't make up numbers.

RULES
- Never invent prices, Greeks, IV, OI, or earnings dates. If you don't have it, say so and point to where they can get it.
- If asked "should I buy X?" — give the framework (trend, RSI, IV, DTE, theta, event risk), not a yes/no.
- Prefer "no trade" over chasing peaks. Call out time-decay traps and IV crushes.
- Keep replies under ~6 sentences unless the user asks for depth.
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: Body = await req.json();
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const ctxLines: string[] = [];
    if (body.pageContext?.route) ctxLines.push(`Current page: ${body.pageContext.route}`);
    if (body.pageContext?.focusedSymbol) ctxLines.push(`Focused ticker: ${body.pageContext.focusedSymbol}`);
    if (body.pageContext?.visibleSymbols?.length) {
      ctxLines.push(`Visible tickers: ${body.pageContext.visibleSymbols.slice(0, 12).join(", ")}`);
    }
    if (body.pageContext?.summary) ctxLines.push(`Page note: ${body.pageContext.summary}`);
    const contextMsg = ctxLines.length
      ? { role: "system" as const, content: `Live page context:\n${ctxLines.join("\n")}` }
      : null;

    const messages = [
      { role: "system" as const, content: SYSTEM },
      ...(contextMsg ? [contextMsg] : []),
      ...body.messages.slice(-20),
    ];

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.model || "google/gemini-3-flash-preview",
        messages,
        stream: true,
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit hit. Wait a moment and try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (upstream.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await upstream.text();
      console.error("nova-chat upstream", upstream.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("nova-chat error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
