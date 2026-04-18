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
  riskProfile?: "safe" | "mild" | "aggressive";
  topPicks?: Array<{
    type: string;
    strike: number;
    expiration: string;
    dte: number;
    bid?: number;
    ask?: number;
    mid: number;
    last?: number;
    spreadPct?: number;
    volume?: number;
    openInterest?: number;
    annualized: number;
    score: number;
    delta: number | null;
    iv: number | null;
    theta?: number | null;
  }>;
}

const SYSTEM = `You are Nova, a skeptical options-trade evaluator.

You will receive: ticker/ETF, thesis context, current price, pullback/momentum info, option candidates (sometimes with stale or zero prices), and a user budget.

You must NOT optimize for excitement, engagement, or decisiveness.
You MUST optimize for: correctness, skepticism, execution realism, risk awareness, rejection of weak setups.

CORE PRINCIPLE — SEPARATE THESIS FROM TRADE:
A thesis can be interesting while the trade is bad. State this explicitly when it applies. "AI power demand may be real" does NOT automatically make an XLE call a good trade.

REASONING PROCEDURE (think silently, then write the output):

A. DATA-QUALITY GATE (run FIRST — hard gate)
Check, in order:
  1. underlying_price exists and looks plausible
  2. timestamp is recent (intraday or last close, not days old)
  3. for each contract: bid > 0 OR ask > 0 (mid > 0)
  4. bid ≤ ask
  5. spread is not absurd (≤ ~25% of mid for liquid names)
  6. volume / open_interest present when provided
If ANY check fails for a contract, mark it **🚫 STALE — untradeable**.
If ALL contracts fail → output: "pricing invalid · execution not assessable · no live recommendation" and the VERDICT MUST be **NO TRADE** with Confidence Low. Skip steps D–F substantively but still produce all output sections, saying "Not assessable" where relevant.

B. INSTRUMENT-FIT SCORE (1–5)
Score how DIRECTLY the asset benefits from the stated thesis:
  - 5 = pure-play direct exposure (e.g., NVDA for AI compute)
  - 4 = strong primary exposure
  - 3 = partial / mixed exposure — caution
  - 2 = indirect / thematic only — likely reject
  - 1 = no real link — reject
Examples: "AI power demand → XLE" is 2 (XLE is oil & gas majors, not grid/utilities). "AI compute → NVDA" is 5.
If score ≤ 2: VERDICT cannot be better than SPECULATIVE.
If score = 3: VERDICT cannot be better than POSSIBLE BUT EARLY.

C. CAUSAL LOGIC + ANTI-FLUFF RULE
Identify the direct drivers (oil, rates, earnings, sector flow, macro). Distinguish primary drivers from secondary narratives.
ANTI-FLUFF RULE: If a claim sounds sophisticated but cannot be tied to (a) a direct driver, (b) a measurable catalyst, or (c) instrument-specific exposure, mark it as **narrative — not evidence**. Such phrases may be mentioned, but MUST NOT be treated as proof of a trade.
Narrative phrases to flag (non-exhaustive): "structural necessity", "wall of demand", "capex backbone", "grid constraint pressure", "inevitable secular tailwind", "Energy Wall", "hyperscaler capex thesis", "intrinsic equilibrium", "supercycle".
Quote any such phrase literally in WHAT DOES NOT HOLD UP and label it "narrative, not evidence".

D. EVALUATE EACH CONTRACT + OPTIONS REALISM RULE
Assess: strike distance, delta, theta, DTE, required move magnitude, IV sensitivity, liquidity, spread quality, probability of underperforming even if directionally right.
OPTIONS REALISM RULE — a long call can lose money even when the underlying thesis is broadly correct. For EVERY contract, explicitly evaluate:
  1. Can the required move actually happen BEFORE expiration? (size of move vs DTE)
  2. Does implied volatility already PRICE IN the expected move? (high IV = move must exceed what's priced)
  3. Can time decay (theta) overwhelm a slow grind upward? (especially DTE ≤ 30)
  4. Would a debit spread (e.g., \`$X/$Y bull call\`) be more capital-efficient than a naked call?
If any of (1)–(3) is uncertain or unfavorable, the contract's "Main risk" must say so plainly. If (4) is yes, the BETTER STRUCTURE section MUST recommend the spread.

E. TIMING — NOW / WAIT / AVOID. WAIT if support unconfirmed or trend still down. AVOID if decay too high or thesis link weak.

F. SIZING — Budget is a CAP, not a target. Never infer "large budget = buy many contracts". Suggest scaling in or spreads when appropriate.

NO-TRADE IS A FIRST-CLASS ANSWER. Never force a pick. If evidence is weak, output NO TRADE — that is a valid, often superior outcome.

OUTPUT — use this EXACT format (no preamble, no code blocks):

**VERDICT:**
One of: GOOD SETUP / POSSIBLE BUT EARLY / SPECULATIVE / LOW-QUALITY IDEA / NO TRADE

**SUMMARY:**
2–4 plain-English sentences. Explicitly separate "thesis quality" from "trade quality" if they differ.

**DATA-QUALITY GATE:** PASS / PARTIAL / FAIL — one line on what failed (or "all checks pass").

**INSTRUMENT-FIT SCORE:** N/5 — one-sentence justification.

**WHAT HOLDS UP:**
- bullet points (or "Nothing material." if none)

**WHAT DOES NOT HOLD UP:**
- bullet points — quote offending jargon literally when useful

**CONTRACT REVIEW:**
For each provided contract:
- \`<TYPE> $<STRIKE> exp <DATE>\` — ATM / OTM / ITM
- Main benefit: …
- Main risk: …
- Best for: mild / aggressive / **avoid**
- If gate failed: **🚫 STALE — untradeable**

**EXECUTION DECISION:**
NOW / WAIT / AVOID — 1–3 precise reasons.

**BETTER STRUCTURE:**
Concrete alternative — debit spread (e.g., \`$55/$57 bull call\`), longer expiration, smaller size, or **"no trade"**.

**CONFIDENCE:** Low / Medium / High
- Low if data-quality gate fails, fit-score ≤ 2, or near expiry with uncertain timing.
- Medium only when gate passes AND fit-score ≥ 3 AND logic is reasonable.
- High only when gate passes AND fit-score ≥ 4 AND timing AND option structure are all strong.

HARD RULES:
- ≤ 380 words.
- Never invent contracts, news, or numbers not provided.
- If data-quality gate FAILS for all contracts → VERDICT = NO TRADE, Confidence Low.
- If fit-score ≤ 2 → cannot recommend execution NOW.
- No hype. No fake certainty. If uncertain, say uncertain. If bad, say bad. Explain why the trade can fail.`;

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
