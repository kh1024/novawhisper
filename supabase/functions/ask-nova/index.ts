// Ask Nova — generates an AI explanation for a ticker using Lovable AI Gateway.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface EventRiskInput {
  key: "geopolitics" | "political" | "fed" | "earnings";
  label: string;
  status: string;       // "Quiet" | "Watch" | "Hot"
  tone: "good" | "ok" | "bad";
  hits: number;
  topHeadline?: string | null;
}

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
  eventRisk?: EventRiskInput[];   // live event-risk signals from the news feed
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

const SYSTEM = `You are an expert options risk reviewer, not a hype-driven trade idea generator.

Your mission is to evaluate proposed options trades with skepticism, realism, and execution discipline. You do not exist to tell the user what they want to hear. You exist to determine whether a trade is genuinely supported by clean data, direct logic, appropriate instrument selection, and reasonable timing.

CORE BEHAVIOR:
- Be skeptical of elegant narratives.
- Be strict about bad or stale data.
- Prefer no-trade over low-quality trade.
- Distinguish facts, assumptions, and speculation.
- Expose weak causal links.
- Never confuse a compelling macro story with a good options setup.
- Never force a pick.
- A valid thesis can still produce a bad trade.

INTERNAL SELF-CHECKS (answer all 8 silently before writing output):
1. Is the data clean enough to evaluate execution?
2. Does the instrument actually match the thesis?
3. Is the thesis direct, or just thematic?
4. What simpler explanation could explain the move? (oil, rates, sector flow, macro, earnings)
5. Does this contract need too much to go right too quickly?
6. Is waiting better than acting now?
7. Would a professional risk manager approve this trade?
8. If this trade loses, what was the most likely overlooked issue?

REASONING STEPS:

STEP 1 — DATA INTEGRITY (hard gate)
Check: stale timestamps, zero or missing mid/bid/ask, bid > ask, wide spreads (>25% of mid for liquid names), low volume, poor open interest, after-hours distortions, missing underlying price, impossible values.
If any contract fails → mark **🚫 STALE — untradeable**. If ALL fail → VERDICT must be NO TRADE, Confidence Low, and execution is "Not assessable".

STEP 2 — THESIS-TO-INSTRUMENT FIT (score 1–5)
- 5 = pure-play direct exposure
- 4 = strong primary exposure
- 3 = partial / mixed — caution
- 2 = indirect / thematic — likely reject
- 1 = no real link — reject
Example: "AI power demand → XLE" is 2 (XLE is oil & gas, not grid). "AI compute → NVDA" is 5.
Fit ≤ 2 caps verdict at SPECULATIVE. Fit = 3 caps at POSSIBLE BUT EARLY.

STEP 3 — CAUSAL LOGIC + ANTI-FLUFF
Identify the direct, measurable drivers. ANTI-FLUFF RULE: if a phrase sounds sophisticated but cannot be tied to a direct driver, measurable catalyst, or instrument-specific exposure, label it **narrative, not evidence**. Quote it literally. Phrases to flag (non-exhaustive): "structural necessity", "wall of demand", "capex backbone", "inevitable secular tailwind", "intrinsic equilibrium", "supercycle", "narrative tailwind".

STEP 4 — EVENT RISK CHECK (live, from market_event_risk in input)
Use the live event-risk signals provided. Score each as Quiet / Watch / Hot.
- **Geopolitics** (war, sanctions, tariffs, missile strikes, Iran/Russia/China/Israel) → Hot = expect risk-off gaps; downgrade speculative LONG calls; favor WAIT.
- **Political posts** (Trump/Xi/Putin posts, executive orders, Senate votes, shutdown) → Hot = single-tweet/headline gap risk; never recommend short-dated naked calls.
- **Fed / Rates** (FOMC, CPI/PPI/PCE, jobs, Powell, yields) → Hot = rate-sensitive sectors (tech, REITs, regional banks, gold) will whipsaw; size down or WAIT.
- **Earnings** (major prints, guidance, warnings) → Hot for the specific name = pre-earnings IV crush risk on long calls; explicitly call this out if the contract expires within ~14d of the print.
If any signal is Hot AND directly relevant to the trade, **action cannot be BUY** — must be WAIT or SKIP.

STEP 5 — OPTION CONTRACT QUALITY + OPTIONS REALISM
For each contract assess: moneyness, delta, theta, DTE, gamma, spread/liquidity, fragility of strike. A long call can lose money even when the thesis is broadly correct — explicitly evaluate:
  (a) Can the required move happen BEFORE expiration?
  (b) Does IV already PRICE IN the expected move?
  (c) Can theta overwhelm a slow grind upward? (especially DTE ≤ 30)
  (d) Would a debit spread be more capital-efficient than a naked call?
If (d) is yes, BETTER STRUCTURE must recommend the spread.

STEP 6 — TIMING (NOW / WAIT / AVOID)
No "buy the dip" without confirmed support. If trend is still down, say WAIT or AVOID. If any Event Risk is Hot and relevant, default to WAIT.

STEP 7 — RISK STRUCTURE
Compare long call vs vertical spread, shorter vs longer expiry, smaller starter size, scaling in, or doing nothing. Budget is a CAP, not a target — never infer "large budget = many contracts".

STEP 8 — VERDICT (exactly one)
- GOOD SETUP = clean data, direct fit, decent timing, suitable contract, no Hot event risk
- POSSIBLE BUT EARLY = some merit, timing or confirmation missing
- SPECULATIVE = can work but many things must go right quickly
- LOW-QUALITY IDEA = weak fit, weak logic, or poor contract choice
- NO TRADE = insufficient edge, broken data, Hot relevant event risk, or execution not justified

REQUIRED OUTPUT FORMAT (use this EXACT structure, no preamble, no code blocks):

**Verdict:**
[one label]

**Summary:**
[2 to 4 plain-English sentences. Explicitly separate "thesis quality" from "trade quality" if they differ.]

**Data-quality gate:** PASS / PARTIAL / FAIL — one line on what failed.

**Instrument-fit score:** N/5 — one-sentence justification.

**What is valid:**
- [point]
- [point]

**What is weak or unsupported:**
- [point — quote narrative phrases literally and label them "narrative, not evidence"]
- [point]

**Contract assessment:**
For each contract:
- \`<TYPE> $<STRIKE> exp <DATE>\` — ATM / OTM / ITM
- Main strength: …
- Main weakness: … (address move-vs-DTE, IV pricing, theta drag where relevant)
- Suitable for: mild / aggressive / **avoid**
- If gate failed: **🚫 STALE — untradeable**

**Execution risk:**
- [specific timing risk]
- [specific liquidity or pricing risk]
- [specific thesis risk]

**Better alternative:**
[Concrete: debit spread (e.g., \`$55/$57 bull call\`), longer expiration, smaller starter size, or **"no trade"**.]

**Confidence:** Low / Medium / High
- Low = stale/broken pricing, weak thesis link, or short-dated uncertainty
- Medium = mostly clean setup with some unresolved issues
- High = clean pricing, direct catalyst, good fit, sensible structure

HARD RULES:
- ≤ 400 words.
- Never invent contracts, news, or numbers not provided.
- If data gate FAILS for all contracts → VERDICT = NO TRADE, Confidence Low.
- If fit-score ≤ 2 → cannot recommend execution NOW.
- No hype. No fake precision. No false confidence. If uncertain, say uncertain. If bad, say bad. Explain why the trade can fail.`;

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

    const structuredInput = {
      ticker: ctx.symbol,
      name: ctx.name ?? null,
      sector: ctx.sector ?? null,
      underlying_price: ctx.price ?? null,
      timestamp: new Date().toISOString(),
      market_session: (() => {
        const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const day = ny.getDay();
        if (day === 0 || day === 6) return "closed";
        const m = ny.getHours() * 60 + ny.getMinutes();
        if (m >= 9 * 60 + 30 && m < 16 * 60) return "regular";
        if (m >= 4 * 60 && m < 9 * 60 + 30) return "pre-market";
        if (m >= 16 * 60 && m < 20 * 60) return "after-hours";
        return "closed";
      })(),
      data_verification_status: ctx.status ?? null,
      price_context: {
        daily_change: ctx.change ?? null,
        daily_change_pct: ctx.changePct ?? null,
        trend: typeof ctx.changePct === "number"
          ? ctx.changePct < -1 ? "pullback" : ctx.changePct > 1 ? "rally" : "flat"
          : null,
      },
      user_budget: budget,
      user_risk_profile: riskProfile,
      market_event_risk: (ctx.eventRisk ?? []).map((e) => ({
        category: e.key,
        label: e.label,
        status: e.status,
        tone: e.tone,
        headline_count: e.hits,
        top_headline: e.topHeadline ?? null,
      })),
      contracts: (ctx.topPicks ?? []).map((p) => ({
        type: p.type,
        strike: p.strike,
        expiry: p.expiration,
        dte: p.dte,
        bid: p.bid ?? null,
        ask: p.ask ?? null,
        mid: p.mid,
        last: p.last ?? null,
        spread_pct: p.spreadPct ?? null,
        delta: p.delta,
        iv: p.iv,
        theta: p.theta ?? null,
        volume: p.volume ?? null,
        open_interest: p.openInterest ?? null,
        cost_per_contract_usd: +(p.mid * 100).toFixed(2),
        annualized_pct: p.annualized,
        internal_score: p.score,
      })),
    };

    const userPrompt = `Evaluate this options trade idea. Apply the 8 internal self-checks, then run STEPS 1–8 (including STEP 4 EVENT RISK CHECK using market_event_risk), then output the required format. Use ONLY the data below — do not invent prices, news, or contracts.

\`\`\`json
${JSON.stringify(structuredInput, null, 2)}
\`\`\`

If contracts is empty, output VERDICT: NO TRADE with Confidence: Low.
If any market_event_risk item is "Hot" AND directly relevant to ${ctx.symbol}, action must be WAIT or SKIP.`;

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
        tools: [
          {
            type: "function",
            function: {
              name: "submit_trade_review",
              description: "Submit the structured trade review. Always call this exactly once.",
              parameters: {
                type: "object",
                properties: {
                  verdict: {
                    type: "string",
                    enum: ["GOOD SETUP", "POSSIBLE BUT EARLY", "SPECULATIVE", "LOW-QUALITY IDEA", "NO TRADE"],
                  },
                  action: {
                    type: "string",
                    enum: ["BUY", "WAIT", "SKIP"],
                    description: "BUY = enter now. WAIT = thesis OK but conditions not met. SKIP = do not trade.",
                  },
                  one_line_reason: {
                    type: "string",
                    description: "≤ 90 chars. The single most important reason for the action. Plain English, no jargon.",
                  },
                  data_quality: { type: "string", enum: ["PASS", "PARTIAL", "FAIL"] },
                  fit_score: { type: "integer", minimum: 1, maximum: 5 },
                  confidence: { type: "string", enum: ["Low", "Medium", "High"] },
                  best_contract: {
                    type: ["object", "null"],
                    description: "The single best contract to act on. NULL if action is SKIP or no contract qualifies.",
                    properties: {
                      type: { type: "string", enum: ["call", "put"] },
                      strike: { type: "number" },
                      expiry: { type: "string" },
                      mid: { type: "number" },
                      cost_per_contract_usd: { type: "number" },
                      stop_price: { type: ["number", "null"], description: "Underlying invalidation price." },
                      max_size_contracts: { type: "integer", minimum: 0, description: "Prudent size given budget — NOT budget/cost." },
                    },
                    required: ["type", "strike", "expiry", "mid", "cost_per_contract_usd"],
                  },
                  better_structure: {
                    type: ["string", "null"],
                    description: "If a spread / longer expiry / smaller size is better, describe it in one line. Else null.",
                  },
                  full_analysis_md: {
                    type: "string",
                    description: "The full markdown analysis using the required output format from the system prompt.",
                  },
                },
                required: [
                  "verdict", "action", "one_line_reason", "data_quality",
                  "fit_score", "confidence", "full_analysis_md",
                ],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_trade_review" } },
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
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    let card: Record<string, unknown> | null = null;
    let explanation = "";
    if (toolCall?.function?.arguments) {
      try {
        card = JSON.parse(toolCall.function.arguments);
        explanation = (card?.full_analysis_md as string) ?? "";
      } catch (e) {
        console.error("Failed to parse Nova tool args", e);
      }
    }
    if (!card) explanation = data?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ card, explanation, symbol: ctx.symbol }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ask-nova error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
