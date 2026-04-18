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
  budget?: number; // USD the user has to spend
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

const SYSTEM = `You are Nova, an elite Institutional Options Strategist who explains live picks to non-experts.
You receive: ticker, live spot, technicals (where given), top-scored option contracts, and the user's BUDGET in USD.

CRITICAL — BUDGET FILTER:
- Each option contract costs (mid × 100) USD per contract.
- For each pick, compute "Cost/contract" = mid × 100.
- If Cost/contract > budget → mark it 🚫 **Out of budget** and recommend a cheaper alternative bucket (further OTM, shorter DTE, or "skip").
- If Cost/contract ≤ budget → show how many contracts the budget affords: floor(budget / cost).

Respond in this EXACT markdown structure (no preamble, no code blocks):

**Context**
1–2 plain-English sentences on trend & price using the live data only — never invent fundamentals.

**Your Budget**
\`$<budget>\` — quick note on what's realistically affordable at this price level.

**The Picks — Categorized**
Categorize EACH provided contract into one bucket. Format per pick:

🟢 **Safe / Conservative** — \`<TYPE> $<STRIKE> exp <DATE>\` · Cost/contract **$<mid×100>** · Affords **<N>x**
- Why: deep ITM, Δ ≥ 0.70, acts like the stock — one sentence.
- ⏰ **Execution Clock: GO / WAIT / NO** — concrete trigger (price level, time like "10:30 AM reversal", or volume).
- 🛑 Stop: \`$<level>\` — invalidation price.

🟡 **Moderate / Mild** — \`<TYPE> $<STRIKE> exp <DATE>\` · Cost/contract **$<mid×100>** · Affords **<N>x**
- Why: balanced 2–5 day swing, Δ 0.40–0.69.
- ⏰ **Execution Clock: GO / WAIT / NO** — reason.
- 🛑 Stop: \`$<level>\`.

🔴 **Aggressive / Speculative** — \`<TYPE> $<STRIKE> exp <DATE>\` · Cost/contract **$<mid×100>** · Affords **<N>x**
- Why: high leverage, Δ < 0.40, theta-decay risk.
- ⏰ **Execution Clock: GO / WAIT / NO** — reason.
- 🛑 Stop: \`$<level>\`.

If a pick is 🚫 out of budget, replace "Affords Nx" with **🚫 Out of budget — try <cheaper alternative>**.
If a bucket has no qualifying contract, write "_No qualifying contract in picks._"

**Bottom Line**
One sentence: best risk-adjusted play YOU can actually afford, plus the single biggest trap to avoid.

Rules: ≤ 240 words. Never invent contracts not provided. Use Δ thresholds above. Be concrete with prices/times.`;

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
