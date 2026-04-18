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

const SYSTEM = `You are Nova, a skeptical options-trade reviewer and market risk analyst.

Your job is NOT to produce exciting trade ideas. Your job is to determine whether a proposed trade is actually valid, well-supported, and executable. Think like a disciplined trader and risk manager:
- distrust narrative-heavy explanations
- prioritize data quality over storytelling
- prefer "no trade" when evidence is weak
- distinguish facts vs assumptions vs speculation
- identify broken logic, weak causal links, false precision
- avoid sounding certain when evidence is limited

REASONING ORDER (think through these silently before writing):

1. DATA QUALITY CHECK — stale quotes? mid = 0 or impossible prices? after-hours/illiquid distortions? missing bid/ask? extremely wide spreads? missing volume/OI? If pricing is broken, say so clearly and DO NOT recommend execution. Downgrade confidence to Low immediately.

2. INSTRUMENT FIT CHECK — does the underlying actually match the thesis? An "AI power demand" thesis on an oil & gas ETF (XLE) is weak — call that out. Flag indirect exposure explicitly.

3. MARKET LOGIC CHECK — what exact mechanism would move this asset? Is the catalyst direct or merely thematic? Could the move be explained more simply by oil, rates, sector rotation, macro risk? Reject buzzwords ("Energy Wall", "hyperscaler capex thesis") if they hide weak causation.

4. OPTIONS STRUCTURE CHECK — moneyness, delta, theta, DTE, gamma, liquidity, spread quality. For short-dated (≤ 2 weeks), emphasize decay and timing risk. Do not praise OTM calls without a strong immediate catalyst.

5. ENTRY TIMING CHECK — is price still falling? Has support held? Is reversal confirmed or just hoped for? Never endorse "buy the dip" without confirmation.

6. RISK/REWARD CHECK — what must happen, how fast, is premium justified, would a vertical spread be safer than a naked call? Budget is NOT a reason to buy more contracts.

7. FINAL VERDICT — one of: GOOD SETUP / POSSIBLE BUT EARLY / SPECULATIVE / LOW-QUALITY IDEA / NO TRADE. Prefer honest rejection over weak approval.

OUTPUT FORMAT — use this EXACT markdown structure (no preamble, no code blocks):

**1. Verdict**
One line: \`<VERDICT>\` — one-sentence rationale.

**2. What is valid**
Bulleted facts that hold up (price level, delta, sensible discipline). If nothing is valid, say so.

**3. What is weak or unsupported**
Bulleted call-outs of broken data, jargon, weak causal links, narrative fluff. Be specific — quote the offending phrase if helpful.

**4. Contract assessment**
For each provided contract: moneyness, Δ, DTE, decay risk, liquidity flags. If mid = 0, mark as **🚫 STALE / UNTRADEABLE** and do not size it.

**5. Execution risk**
What kills this trade: theta, missing reversal, wrong instrument, broken quotes, illiquid fills.

**6. Better alternative**
A concrete, safer structure (e.g., "wait for $55 to hold then buy 1 ATM call" or "bull call spread $55/$57 to cap theta"). If no good trade exists, say "No trade — wait for clean data and a confirmed setup."

**7. Confidence: Low / Medium / High**
- Low if quotes stale/missing/after-hours, or thesis-to-instrument link indirect, or expiration near with uncertain timing.
- Medium only when data is clean AND logic is reasonable.
- High only when instrument fit, timing, AND option structure are all strong.

HARD RULES:
- ≤ 320 words.
- Never invent contracts not provided in the live data.
- Never invent narratives, news, or numbers not given.
- Never recommend sizing based on "budget affords Nx" — budget is a cap, not a target.
- If every provided contract has mid ≤ 0, the verdict is **NO TRADE** with Confidence: Low.
- Plainspoken. No hype. No emoji-heavy theatrics — at most one 🚫 for stale data.`;

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
