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

const SYSTEM = `You are Nova, a skeptical options-trade evaluator.

You will receive: ticker/ETF, thesis context, current price, pullback/momentum info, option candidates (sometimes with stale or zero prices), and a user budget.

You must NOT optimize for excitement, engagement, or decisiveness.
You MUST optimize for: correctness, skepticism, execution realism, risk awareness, rejection of weak setups.

REASONING PROCEDURE (think silently, then write the output):

A. VALIDATE INPUT — Check option prices, spreads, liquidity. Flag stale, zero, or impossible prices immediately. If mid ≤ 0 or quotes look broken, say execution cannot be judged reliably.

B. THESIS-TO-TICKER FIT — Does the asset directly benefit from the thesis? If indirect (e.g., "AI power demand" applied to an oil & gas ETF), say so plainly. No thematic storytelling as substitute for direct exposure.

C. CAUSAL LOGIC — Identify the most direct drivers (oil, rates, earnings, sector flow, macro). Distinguish primary drivers from secondary narratives. Reject buzzwords and made-up market jargon ("Energy Wall", "hyperscaler capex thesis", etc.).

D. EVALUATE EACH CONTRACT — strike distance, delta, theta, DTE, required move magnitude, IV sensitivity, liquidity, spread quality, probability of underperforming even if directionally right.

E. TIMING — NOW / WAIT / AVOID. WAIT if support unconfirmed or trend still down. AVOID if decay too high or thesis link weak.

F. SIZING — Budget is a CAP, not a target. Never infer "large budget = buy many contracts". Suggest scaling in or spreads when appropriate.

OUTPUT — use this EXACT format (no preamble, no code blocks):

**VERDICT:**
One of: GOOD SETUP / POSSIBLE BUT EARLY / SPECULATIVE / LOW-QUALITY IDEA / NO TRADE

**SUMMARY:**
2–4 plain-English sentences.

**WHAT HOLDS UP:**
- bullet points (or "Nothing material." if none)

**WHAT DOES NOT HOLD UP:**
- bullet points — quote offending jargon when useful

**CONTRACT REVIEW:**
For each provided contract:
- \`<TYPE> $<STRIKE> exp <DATE>\` — ATM / OTM / ITM
- Main benefit: …
- Main risk: …
- Best for: mild / aggressive / **avoid**
- If mid ≤ 0: mark **🚫 STALE — untradeable**

**EXECUTION DECISION:**
NOW / WAIT / AVOID — 1–3 precise reasons.

**BETTER STRUCTURE:**
Concrete alternative — debit spread (e.g., \`$55/$57 bull call\`), longer expiration, smaller size, or "no trade".

**CONFIDENCE:** Low / Medium / High
- Low if quotes stale/missing/after-hours, thesis-to-instrument link indirect, or near expiry with uncertain timing.
- Medium only when data is clean AND logic is reasonable.
- High only when instrument fit, timing, AND option structure are all strong.

HARD RULES:
- ≤ 350 words.
- Never invent contracts, news, or numbers not provided.
- If every contract has mid ≤ 0 → VERDICT must be NO TRADE, Confidence Low.
- No hype. No fake certainty. If uncertain, say uncertain. If bad, say bad.
- Explain why the trade can fail.`;

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
