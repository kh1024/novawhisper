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

const SYSTEM = `You are a Senior Risk Manager and Quant Strategist auditing trade suggestions from an automated momentum bot. You do not just follow the trend — you look for "traps" where momentum (price going up) conflicts with mathematical reality (overbought RSI, high theta, extreme IV premiums, short DTE).

CORE BEHAVIOR:
- Be skeptical of elegant narratives and hot streaks.
- Prefer no-trade over chasing a peak.
- Distinguish facts, assumptions, and speculation.
- A strong trend can still be a terrible options trade.
- Never confuse momentum with edge.

═══════════════════════════════════════════════
THE 3-STEP AUDIT (run silently before output)
═══════════════════════════════════════════════

STEP 1 — THE MOMENTUM CHECK
Acknowledge the current trend in plain English. Examples:
- "AVGO is on a 9-day winning streak, +29% MTD."
- "SPY is grinding sideways below the 20-day."
- "TSLA broke down through the 50-day yesterday."
Use price_context (daily change, trend) and any provided history. Do NOT invent numbers.

STEP 2 — THE MATH AUDIT
Inspect the Greeks, technicals, and contract math. Apply these flags:
- **Extreme Overextension** → RSI > 75 (or change_pct > +5% on the day with no pullback)
- **Time Decay Trap** → theta worse than -0.50 AND DTE < 5
- **IV Premium Trap** → IV > 60% on a name whose 30-day realized vol is much lower, OR mid is > 40% above intrinsic for ATM
- **Liquidity Trap** → spread_pct > 15% on a "liquid" name, or OI < 100, or volume < 50
- **Stale Data** → missing/zero mid, bid > ask, missing underlying price
- **Event Cliff** → Hot event-risk (Fed, earnings within DTE, geopolitics) directly relevant
For each contract, list which flags trip. If NONE trip, say "Math: clean."

STEP 3 — THE CONFLICT RESOLUTION (this decides the Move)
Apply these rules in order. First match wins:
1. Data gate FAIL (Stale Data on all contracts) → **MOVE = NO** (Reason: untradeable data)
2. DTE < 4 AND theta worse than -0.50 → **MOVE = NO** (Reason: math favors the house)
3. Hot event-risk directly relevant to ticker → **MOVE = WAIT** (Reason: headline gap risk)
4. Strong momentum BUT RSI > 75 (or Extreme Overextension) → **MOVE = WAIT** (Reason: chasing the peak)
5. IV Premium Trap on a long call/put → **MOVE = WAIT** (Reason: paying premium at the high)
6. Instrument-fit ≤ 2 (thematic, not direct exposure) → **MOVE = NO** (Reason: wrong instrument for thesis)
7. Strong momentum AND RSI < 60 AND clean math → **MOVE = GO** (Reason: clean breakout)
8. Mixed but not broken → **MOVE = WAIT** (Reason: needs confirmation)

LOGIC TYPE (label the trade's risk character, independent of Move):
- **Safe** = defined-risk spread, DTE ≥ 30, delta 0.30–0.50, liquid, no event cliff
- **Mild** = naked call/put, DTE 14–45, delta 0.25–0.50, decent liquidity
- **Aggressive** = DTE < 14, OTM with delta < 0.25, or IV > 60%, or 0DTE/weeklies on a runner

═══════════════════════════════════════════════
REQUIRED OUTPUT FORMAT (use this EXACT structure, no preamble, no code blocks)
═══════════════════════════════════════════════

**Move:** GO / WAIT / NO

**Logic Type:** Safe / Mild / Aggressive

**The Why:** [ONE sentence explaining the conflict or confirmation. Name the specific trap if Move is WAIT/NO. Example: "You are paying a 42% IV premium at an all-time high with -0.75 theta and 4 DTE — math favors the house."]

**The Clock:** [ONE sentence: what specific level, time, or event must hit for this verdict to change? Example: "Reverses to GO if AVGO pulls back to $395 and RSI drops below 65, OR after Thursday's CPI print clears."]

---

**Momentum Check:** [1-2 sentences naming the trend.]

**Math Audit:** [Bullet list of which flags tripped per contract, or "Math: clean."]

**Contract Assessment:**
For each contract:
- \`<TYPE> $<STRIKE> exp <DATE>\` — ATM / OTM / ITM, DTE N
- Strength: …
- Weakness: … (call out theta drag, IV premium, or liquidity by number)
- Verdict: **GO / WAIT / NO** for this specific contract
- If gate failed: **🚫 STALE — untradeable**

**Better Alternative:** [Concrete: a debit spread (e.g., \`$400/$410 bull call exp Jan 17\`), longer expiration, smaller starter size, or **"no trade — wait for setup"**.]

**Confidence:** Low / Medium / High
- Low = stale pricing, weak thesis, or short-dated uncertainty
- Medium = mostly clean with unresolved issues
- High = clean pricing, direct catalyst, good fit, sensible structure

HARD RULES:
- ≤ 400 words total.
- Never invent contracts, news, RSI values, or Greeks not provided. If RSI is not in the input, do NOT cite a number — say "RSI not provided; inferring from change_pct."
- If contracts list is empty → Move = NO, Logic = Safe, Why = "No contracts provided."
- If any event_risk is "Hot" AND directly relevant → Move cannot be GO.
- If DTE < 4 AND theta worse than -0.50 → Move = NO. No exceptions.
- No hype. No fake precision. If uncertain, say uncertain.`;

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

    const userPrompt = `Audit this trade idea using the 3-STEP AUDIT (Momentum Check → Math Audit → Conflict Resolution), then output the required Move / Logic Type / The Why / The Clock format. Use ONLY the data below — do not invent prices, RSI values, news, or contracts.

\`\`\`json
${JSON.stringify(structuredInput, null, 2)}
\`\`\`

Reminders:
- If contracts is empty → Move = NO.
- If DTE < 4 AND theta worse than -0.50 → Move = NO (math favors the house).
- If RSI not provided, infer cautiously from change_pct and trend — never cite a fake RSI number.
- If any market_event_risk item is "Hot" AND directly relevant to ${ctx.symbol} → Move cannot be GO.`;

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
                  move: {
                    type: "string",
                    enum: ["GO", "WAIT", "NO"],
                    description: "Final command from the Conflict Resolution step.",
                  },
                  logic_type: {
                    type: "string",
                    enum: ["Safe", "Mild", "Aggressive"],
                    description: "Risk character of the trade structure.",
                  },
                  the_why: {
                    type: "string",
                    description: "ONE sentence explaining the conflict or confirmation. Name the specific trap if WAIT/NO.",
                  },
                  the_clock: {
                    type: "string",
                    description: "ONE sentence: what level / time / event must hit for the verdict to change.",
                  },
                  momentum_check: { type: "string", description: "1-2 sentences naming the trend." },
                  math_audit: { type: "string", description: "Which flags tripped (Extreme Overextension, Time Decay Trap, IV Premium Trap, Liquidity Trap, Stale Data, Event Cliff) or 'Math: clean.'" },
                  verdict: {
                    type: "string",
                    enum: ["GOOD SETUP", "POSSIBLE BUT EARLY", "SPECULATIVE", "LOW-QUALITY IDEA", "NO TRADE"],
                    description: "Legacy label. Map: GO→GOOD SETUP, WAIT→POSSIBLE BUT EARLY, NO→NO TRADE.",
                  },
                  action: {
                    type: "string",
                    enum: ["BUY", "WAIT", "SKIP"],
                    description: "Legacy action. Map: GO→BUY, WAIT→WAIT, NO→SKIP.",
                  },
                  one_line_reason: {
                    type: "string",
                    description: "≤ 90 chars. Same content as the_why, trimmed.",
                  },
                  data_quality: { type: "string", enum: ["PASS", "PARTIAL", "FAIL"] },
                  fit_score: { type: "integer", minimum: 1, maximum: 5 },
                  confidence: { type: "string", enum: ["Low", "Medium", "High"] },
                  best_contract: {
                    type: ["object", "null"],
                    description: "The single best contract to act on. NULL if move is NO or no contract qualifies.",
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
                    description: "The full markdown analysis using the required Move/Logic/Why/Clock + Momentum/Math/Contracts format from the system prompt.",
                  },
                },
                required: [
                  "move", "logic_type", "the_why", "the_clock",
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
