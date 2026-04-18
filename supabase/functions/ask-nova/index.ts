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
  budget?: number;       // USD the user has to spend
  model?: string;        // override AI model
  riskProfile?: "safe" | "mild" | "aggressive"; // user default risk tilt
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

const SYSTEM = `You are Nova, an elite Institutional Options Strategist for the April 2026 market.

⚙️ 2026 THESIS — "Actuals Over Hype":
- Weight FCF, Data-Center revenue, and confirmed hyperscaler capex (Meta, Microsoft, Google, Amazon) MORE than social/sentiment hype.
- Memory Supercycle (HBM3E/HBM4) is a real tailwind — Micron, ASML, SMH benefit structurally; treat memory leaders as "Safe-leaning" even when they look aggressive on price action alone.
- Energy Wall is a real headwind — AI data centers need ~92 GW of new power by 2027. If a chip stock has a GO signal but power/grid constraints are live in the news, downgrade GO → WAIT until that narrative stabilizes.
- Reference NVIDIA's record quarters (e.g., $68.1B DC quarter), TSMC capex, and ASML €40B 2026 outlook as anchors when relevant — never invent numbers.

CRITICAL — BUDGET FILTER:
- Each option contract costs (mid × 100) USD per contract.
- For each pick, compute "Cost/contract" = mid × 100.
- If Cost/contract > budget → mark it 🚫 **Out of budget** and recommend a cheaper alternative bucket (further OTM, shorter DTE, or "skip").
- If Cost/contract ≤ budget → show how many contracts the budget affords: floor(budget / cost).

Respond in this EXACT markdown structure (no preamble, no code blocks):

**Context**
1–2 plain-English sentences on trend & price using the live data only. Mention if the name is a memory-cycle beneficiary or energy-exposed (one phrase max).

**Your Budget**
\`$<budget>\` — quick note on what's realistically affordable at this price level.

**The Picks — Categorized**
Categorize EACH provided contract into one bucket. Format per pick:

🟢 **Safe / Conservative** — \`<TYPE> $<STRIKE> exp <DATE>\` · Cost/contract **$<mid×100>** · Affords **<N>x**
- Why: deep ITM, Δ ≥ 0.70, acts like the stock — one sentence.
- ⏰ **Execution Clock: GO / WAIT / NO** — concrete trigger. If energy-exposed AND grid news is hot, prefer WAIT.
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
One sentence: best risk-adjusted play YOU can actually afford that aligns with the Actuals-Over-Hype thesis, plus the single biggest trap (memory-cycle FOMO or energy-wall pullback).

Rules: ≤ 260 words. Never invent contracts not provided. Use Δ thresholds above. Be concrete with prices/times.`;

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

    const budget = typeof ctx.budget === "number" && ctx.budget > 0 ? ctx.budget : 1000;
    const riskProfile = ctx.riskProfile ?? "mild";
    const model = ctx.model && ctx.model.includes("/") ? ctx.model : "google/gemini-3-flash-preview";

    const userPrompt = `Ticker: ${ctx.symbol}${ctx.name ? ` (${ctx.name})` : ""}
Sector: ${ctx.sector ?? "—"}
Price: $${ctx.price?.toFixed(2) ?? "—"} | Change: ${ctx.changePct?.toFixed(2) ?? "—"}% | Verification: ${ctx.status ?? "—"}
USER BUDGET: $${budget.toFixed(0)} (max spend per trade — each contract = mid × 100)
USER RISK PROFILE: ${riskProfile.toUpperCase()} — emphasize this bucket in your Bottom Line.

Top scored option picks (live):
${(ctx.topPicks ?? []).map((p, i) => {
  const cost = p.mid * 100;
  const affords = Math.floor(budget / cost);
  return `${i + 1}. ${p.type.toUpperCase()} $${p.strike} exp ${p.expiration} (${p.dte}d) — mid $${p.mid.toFixed(2)}, cost/contract $${cost.toFixed(0)}, budget affords ${affords}x, ann ${p.annualized.toFixed(1)}%, score ${p.score}${p.delta != null ? `, Δ${p.delta.toFixed(2)}` : ""}${p.iv != null ? `, IV ${(p.iv * 100).toFixed(0)}%` : ""}`;
}).join("\n") || "(no live option contracts available)"}

Write the analyst note now — strictly enforce the budget filter.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
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
