// Ask Nova — generates an AI explanation for a ticker using Lovable AI Gateway.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface NovaContext {
  symbol: string;
  name?: string;
  sector?: string;
  price?: number;
  change?: number;
  changePct?: number;
  status?: string;
  topPicks?: Array<{
    type: string;
    strike: number;
    expiration: string;
    dte: number;
    mid: number;
    annualized: number;
    score: number;
    delta: number | null;
    iv: number | null;
  }>;
}

const SYSTEM = `You are Nova, a Lead Options Strategist who explains live option picks to non-experts.
You receive: ticker, live spot price, recent move, and a list of top-scored option contracts.

You MUST respond in this EXACT markdown structure (no preamble, no code blocks):

**Context**
1-2 plain-English sentences on the current trend & price (use the live data given — do not invent fundamentals).

**The Picks — Categorized**
Categorize EACH provided contract into exactly one bucket. Use this format per pick:

🟢 **Safe / Conservative** — \`<TYPE> $<STRIKE> exp <DATE>\`
- Why: deep ITM / high delta / acts like the stock — explain in one sentence.
- ⏰ **Execution Clock: GO / WAIT / NO** — one-sentence reason (mention volume, spread, or a price/time trigger like "wait for 10:30 AM reversal" or "needs to hold $X support").

🟡 **Moderate / Mild** — \`<TYPE> $<STRIKE> exp <DATE>\`
- Why: balanced risk-reward, 2–5 day swing, etc.
- ⏰ **Execution Clock: GO / WAIT / NO** — reason.

🔴 **Aggressive / Speculative** — \`<TYPE> $<STRIKE> exp <DATE>\`
- Why: high leverage, theta decay risk, lotto-style.
- ⏰ **Execution Clock: GO / WAIT / NO** — reason.

If a bucket has no matching contract from the list, write "_No qualifying contract in picks._" under that header — do NOT invent strikes.

**Bottom Line**
One sentence: which pick is the best risk-adjusted play right now, and the single biggest trap to avoid.

Rules:
- Stay under 220 words total.
- Never invent option contracts that weren't provided.
- Use Δ (delta) and IV values when given to justify the bucket (Δ ≥ 0.70 = Safe, 0.40–0.69 = Mild, < 0.40 = Aggressive).
- Be concrete with execution triggers (price levels, times, volume).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ctx: NovaContext = await req.json();
    if (!ctx?.symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const userPrompt = `Ticker: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ""}
Sector: ${ctx.sector ?? "—"}
Price: $${ctx.price?.toFixed(2) ?? "—"} | Change: ${ctx.changePct?.toFixed(2) ?? "—"}% | Verification: ${ctx.status ?? "—"}

Top scored option picks (live):
${(ctx.topPicks ?? []).map((p, i) =>
  `${i + 1}. ${p.type.toUpperCase()} $${p.strike} exp ${p.expiration} (${p.dte}d) — mid $${p.mid.toFixed(2)}, ann ${p.annualized.toFixed(1)}%, score ${p.score}${p.delta != null ? `, Δ${p.delta.toFixed(2)}` : ""}${p.iv != null ? `, IV ${(p.iv * 100).toFixed(0)}%` : ""}`
).join("\n") || "(no live option contracts available)"}

Write the analyst note now.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit reached. Try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings → Workspace → Usage." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      throw new Error(`AI gateway ${resp.status}`);
    }

    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ explanation: text, symbol: ctx.symbol }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ask-nova error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
