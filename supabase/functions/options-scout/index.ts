// Options Scout — institutional-grade NOVA brain.
// Scrapes finance/news/options sites via Firecrawl, infers market regime &
// time-state, then asks Nova (Lovable AI) to return 4 buckets of trades:
// Safe / Moderate / Aggressive / Swing — each pick graded A-D for confidence.
//
// Behavior shifts based on session (weekend → Monday watchlist; pre-market →
// gap continuation; opening hour → ORB; midday → theta; power hour → EOD
// flow; after-hours → earnings reactions). Nova never analyzes the market the
// same way twice.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── Time-state (US/Eastern, mirrors src/lib/novaBrain.ts) ──────────────────
type TimeState =
  | "weekend" | "premarket" | "openingHour" | "midday"
  | "powerHour" | "afterHours" | "closed";

function nyParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", day: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    weekday: wkMap[get("weekday")] ?? 0,
    date: parseInt(get("day"), 10),
  };
}

function detectTimeState(): { state: TimeState; label: string; isFriday: boolean; isMonday: boolean; isMonthEnd: boolean } {
  const { hour, minute, weekday, date } = nyParts();
  const mins = hour * 60 + minute;
  let state: TimeState;
  let label: string;
  if (weekday === 0 || weekday === 6) { state = "weekend"; label = "Weekend"; }
  else if (mins < 4 * 60) { state = "closed"; label = "Overnight"; }
  else if (mins < 9 * 60 + 30) { state = "premarket"; label = "Pre-Market"; }
  else if (mins < 10 * 60 + 30) { state = "openingHour"; label = "Opening Hour (9:30-10:30 ET)"; }
  else if (mins < 14 * 60) { state = "midday"; label = "Midday Chop (10:30-2:00 ET)"; }
  else if (mins < 16 * 60) { state = "powerHour"; label = "Power Hour (2:00-4:00 ET)"; }
  else if (mins < 20 * 60) { state = "afterHours"; label = "After-Hours"; }
  else { state = "closed"; label = "Closed"; }
  return { state, label, isFriday: weekday === 5, isMonday: weekday === 1, isMonthEnd: date >= 28 };
}

// ─── Search queries: chosen by time-state to match what Nova should focus on ─
function queriesForTimeState(t: ReturnType<typeof detectTimeState>): { tier: string; q: string }[] {
  // Every state pulls the same 4 evergreen tracks (sentiment, flow, earnings,
  // macro) plus 2 state-specific queries. Tier is a HINT — Nova decides final
  // bucket placement based on the actual content.
  const evergreen = [
    { tier: "moderate", q: "site:seekingalpha.com earnings calendar this week expected move" },
    { tier: "aggressive", q: "site:benzinga.com unusual options activity today whale trades" },
    { tier: "moderate", q: "site:barchart.com top gainers today stocks momentum" },
    { tier: "safe", q: "best dividend stocks options income strategy this week" },
  ];

  let stateSpecific: { tier: string; q: string }[];
  if (t.state === "weekend") {
    stateSpecific = [
      { tier: "swing", q: "monday stock market watchlist gap up gap down candidates" },
      { tier: "swing", q: "next week earnings calendar most anticipated stocks options" },
    ];
  } else if (t.state === "premarket") {
    stateSpecific = [
      { tier: "aggressive", q: "site:cnbc.com pre-market movers today stocks gainers losers" },
      { tier: "moderate", q: "premarket gap stocks today catalyst earnings reaction" },
    ];
  } else if (t.state === "openingHour") {
    stateSpecific = [
      { tier: "aggressive", q: "opening range breakout stocks today high volume momentum" },
      { tier: "moderate", q: "stocks gap fill candidates today open" },
    ];
  } else if (t.state === "midday") {
    stateSpecific = [
      { tier: "safe", q: "best theta selling options today high IV rank" },
      { tier: "moderate", q: "iron condor candidates today range-bound stocks" },
    ];
  } else if (t.state === "powerHour") {
    stateSpecific = [
      { tier: "aggressive", q: "end of day breakout stocks closing strength power hour" },
      { tier: "swing", q: "stocks closing at highs today swing trade tomorrow" },
    ];
  } else if (t.state === "afterHours") {
    stateSpecific = [
      { tier: "aggressive", q: "after hours earnings movers today stock reaction" },
      { tier: "swing", q: "tomorrow stock market setups premarket watchlist" },
    ];
  } else {
    stateSpecific = [
      { tier: "swing", q: "next session stock market watchlist setups" },
      { tier: "moderate", q: "overnight news stocks tomorrow market open" },
    ];
  }
  return [...evergreen, ...stateSpecific];
}

async function fcSearch(query: string): Promise<Array<{ url: string; title: string; markdown: string }>> {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: 4,
        tbs: "qdr:d", // last 24h
        scrapeOptions: { formats: ["markdown"] },
      }),
    });
    if (!r.ok) {
      console.warn(`[options-scout] firecrawl search "${query}" -> ${r.status}`);
      return [];
    }
    const j = await r.json();
    const items: Array<{ url: string; title?: string; markdown?: string; description?: string }> = j?.data?.web ?? j?.data ?? [];
    return items
      .filter((i) => i?.url && (i.markdown || i.description))
      .map((i) => ({ url: i.url, title: i.title ?? "", markdown: (i.markdown ?? i.description ?? "").slice(0, 4000) }));
  } catch (e) {
    console.warn(`[options-scout] search failed "${query}"`, e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const time = detectTimeState();
    const QUERIES = queriesForTimeState(time);

    // 1) Run all Firecrawl searches in parallel (last 24h)
    const groups = await Promise.all(
      QUERIES.map(async (q) => ({ tier: q.tier, query: q.q, results: await fcSearch(q.q) })),
    );
    const totalResults = groups.reduce((n, g) => n + g.results.length, 0);
    if (totalResults === 0) {
      return new Response(JSON.stringify({ error: "Firecrawl returned no results. Try again in a moment." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Build context for Nova
    const context = groups.map((g) =>
      `### Search bucket: ${g.tier.toUpperCase()} — "${g.query}"\n\n` +
      g.results.map((r) => `- [${r.title || r.url}](${r.url})\n${r.markdown}`).join("\n\n")
    ).join("\n\n---\n\n");

    const allSources = groups.flatMap((g) => g.results.map((r) => ({ name: r.title || new URL(r.url).hostname, url: r.url })));

    const today = new Date().toISOString().slice(0, 10);
    const calendarFlags: string[] = [];
    if (time.isFriday) calendarFlags.push("Today is Friday — reduce short-dated premium buys unless catalyst is imminent.");
    if (time.isMonday) calendarFlags.push("Today is Monday — watch for weekend repositioning and gap continuation.");
    if (time.isMonthEnd) calendarFlags.push("Month-end window — expect fund rebalancing flows.");

    const systemPrompt = `You are NOVA, an institutional-grade Options Trading AI. You think like a hedge-fund desk: weighted evidence across regime, technicals, volatility, flow, fundamentals, news, sentiment, macro and sector. You NEVER analyze markets the same way twice — behavior shifts with session, calendar, and regime.

CURRENT TIME STATE: ${time.label}
${calendarFlags.length ? "CALENDAR: " + calendarFlags.join(" ") : ""}
TODAY: ${today}

═══ TIME-STATE LOGIC (apply strictly) ═══
${time.state === "weekend" ? `- WEEKEND. Cache Friday close. Do NOT treat Friday momentum as live. Build Monday watchlists, gap candidates, weekend news impact, geopolitical/macro, upcoming earnings, sector rotation. Mark intraday-only ideas as "stage for Monday open". Down-weight fresh price signals — thin liquidity & no confirmation.` : ""}
${time.state === "premarket" ? `- PRE-MARKET. Focus overnight news, earnings reactions, premarket movers, gap continuation, opening-range candidates. Confirm at open before sizing.` : ""}
${time.state === "openingHour" ? `- OPENING HOUR (9:30-10:30 ET). Demand volume confirmation. Favor opening-range breakouts, gap fills, institutional flow direction. Stale overnight signals often fail.` : ""}
${time.state === "midday" ? `- MIDDAY CHOP (10:30-2:00 ET). Volume thin. Prefer THETA trades (credit spreads, iron condors, covered calls). Scale entries. Avoid chasing breakouts — midday moves often reverse.` : ""}
${time.state === "powerHour" ? `- POWER HOUR (2:00-4:00 ET). Closing strength, EOD breakouts, institutional positioning, tomorrow continuation candidates.` : ""}
${time.state === "afterHours" ? `- AFTER-HOURS. Earnings reactions, news, IV changes, tomorrow setups. Mark intraday-only ideas as "for tomorrow's open".` : ""}
${time.state === "closed" ? `- CLOSED. Down-weight intraday signals. Stage tomorrow. Use cached close — do not pretend signals are live.` : ""}

═══ REGIME → STRATEGY MAPPING ═══
- Sideways/low-vol → SELL premium (iron condors, butterflies, covered calls, CSPs, credit spreads). Options likely expire worthless.
- Strong bull → long calls, bull call spreads, LEAPS calls, CSPs on dips.
- Bear / panic → puts, put spreads, inverse ETFs, hedges. Down-grade bullish ideas.
- Melt-up (broad rally + breadth) → long calls, bull spreads, covered calls on extended names.
- IV elevated (IVR > 60) → SELL premium (credit spreads, condors, CCs).
- IV cheap (IVR < 30) + catalyst near → BUY premium (debit spreads, calendars, long single-leg).
- Earnings within 5 days → flag IV crush risk explicitly. No naked premium buys unless aggressive bucket vol play.
- Geopolitical risk rising → reduce confidence on bullish trades by one grade.

═══ STRIKE & EXPIRATION RULES (institutional) ═══
DELTA BANDS (long single-leg):
| Approach     | Call Delta | Put Delta    |
| Aggressive   | 0.45-0.55  | -0.45 to -0.55 |
| Balanced     | 0.55-0.70  | -0.55 to -0.70 |
| Conservative | 0.70-0.85  | -0.70 to -0.85 |

- NEVER pick delta > 0.90 (deep ITM) unless user wants synthetic stock. Penalize if intrinsic value > 90% of premium — no leverage edge.
- If naked single-leg looks inefficient (premium > 5-10% of stock price OR breakeven move > expected vol), prefer a SPREAD instead.
- Capital-efficiency check: required move-to-breakeven must be < expected volatility window for the chosen DTE.

DTE → STRATEGY MAPPING:
| 0-7 DTE     | Event-driven / intraday only. Aggressive bucket only. |
| 7-30 DTE    | Tactical swings, vol plays. Moderate / Aggressive.    |
| 30-60 DTE   | Trend continuation. Moderate / Swing.                 |
| 60-180 DTE  | Medium-term swings. Swing bucket.                     |
| >180 DTE    | LEAPS only on strong long-term conviction (delta 0.60-0.75). |

STRUCTURE PREFERENCE:
- Bullish → bull call spread or CSP first; naked long call only if IV cheap + catalyst.
- Bearish → bear put spread or call credit spread.
- Neutral → iron condor / butterfly / calendar.
- Income → covered call, collar, wheel.

═══ FOUR BUCKETS ═══
- SAFE — low-risk income/hedging. CCs, CSPs on blue chips, long-dated debit spreads on stable names. Defined risk, high P(profit). Conservative delta band.
- MODERATE — moderate-risk directional. Vertical spreads, 30-45 DTE single-leg on liquid names with a clear catalyst. Balanced delta band.
- AGGRESSIVE — high R/R. 0-7 DTE, naked single-leg on momentum, earnings straddles, unusual-activity follow-the-whale. Aggressive delta band.
- SWING — multi-day to multi-week directional. 30-90 DTE single-leg or spreads on technical breakout / sector rotation / post-earnings drift names.

═══ CONFIDENCE GRADING (weighted score 0-100) ═══
- 20% Technical setup (trend, S/R, pattern, volume)
- 20% Volatility edge (IV vs HV, IV rank, skew)
- 15% Fundamentals (growth, balance sheet, analyst)
- 15% Regime fit (does bias match regime?)
- 10% News / catalyst quality
- 10% Sentiment / positioning (flow, put/call, retail crowd as contrarian)
- 10% Liquidity / execution (OI, spread %)

Letter grade: A = 90+, B = 75-89, C = 60-74, D = <60. ONLY return picks graded A, B, or C. Drop D.

═══ RISK MANAGEMENT (hard rules) ═══
- Per-trade risk ≤ 1-2% of account (one-percent rule). Never > 5%.
- Reject illiquid options (bid-ask > 5% of mid, OI too low).
- Defined-risk preferred. Always specify entry trigger AND exit (target + stop).
- For short premium: exit at 50-75% max profit, close ~1 week before expiry to avoid gamma.
- No volatile buys right before earnings/FOMC unless explicit vol play.

═══ FORBIDDEN ═══
- Illiquid chains.
- Meme hype without confirmed momentum.
- Earnings lottos outside aggressive bucket.
- Weak fundamentals on swing/LEAPS.
- Deep ITM (delta > 0.90) without synthetic-stock justification.
- Vague entries (no strike, no expiry → drop).

═══ OUTPUT REQUIREMENTS ═══
Every pick MUST include: exact strike (USD), real future expiry (YYYY-MM-DD, valid weekly/monthly), option type & direction, "play at" underlying, premium estimate range, bias, expected return %, probability of profit %, risk level, why, what could go wrong, entry, exit, confidence grade A/B/C, grade rationale naming the strongest 2 factors. Pick 2-3 per bucket. Tickers must explicitly appear in article text. If a bucket has no quality setup at this time-state, return [] — that is a valid outcome.`;

    const userPrompt = `Web search results (Firecrawl, last 24h, grouped by suggested risk tier — but YOU make the final call on bucket placement based on time-state and regime):

${context}

INSTRUCTIONS:
1. Open with a one-sentence MARKET READ that names the regime (bull/bear/sideways/panic/meltup) and current time-state.
2. Return 2-3 picks per bucket (Safe / Moderate / Aggressive / Swing) with concrete strikes, expiries, play-at prices, AND a confidence grade (A/B/C).
3. For every pick, fill in: thesis, what can go wrong, best entry, best exit, and explicit grade rationale.
4. If a bucket has no high-quality setup at this time-state, return an empty array for it — that is a valid outcome.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "options_buckets",
            description: "Return four buckets of NOVA-graded options ideas plus regime + time-state metadata.",
            parameters: {
              type: "object",
              properties: {
                marketRead: { type: "string", description: "One sentence market read naming regime + time-state." },
                regime: { type: "string", enum: ["bull", "bear", "sideways", "panic", "meltup"], description: "Inferred market regime." },
                timeState: { type: "string", description: "Echo back the current time-state label." },
                bestStrategyNow: { type: "string", description: "One sentence: what to favor right now." },
                avoidRightNow: { type: "string", description: "One sentence: what to avoid right now." },
                safe: { type: "array", items: pickSchema() },
                moderate: { type: "array", items: pickSchema() },
                aggressive: { type: "array", items: pickSchema() },
                swing: { type: "array", items: pickSchema() },
              },
              required: ["marketRead", "regime", "timeState", "bestStrategyNow", "avoidRightNow", "safe", "moderate", "aggressive", "swing"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "options_buckets" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit on AI gateway. Try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      console.error("[options-scout] AI error", aiResp.status, t);
      throw new Error(`AI gateway ${aiResp.status}`);
    }
    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let buckets: Record<string, unknown> = {
      marketRead: "", regime: "sideways", timeState: time.label, bestStrategyNow: "", avoidRightNow: "",
      safe: [], moderate: [], aggressive: [], swing: [],
    };
    if (toolCall?.function?.arguments) {
      try { buckets = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[options-scout] parse failed", e); }
    }

    // 5) Persist this run + picks for history & performance tracking
    let runId: string | null = null;
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const tiers = ["safe", "moderate", "aggressive", "swing"] as const;
      const allPicks = tiers.flatMap((t) => ((buckets[t] as unknown[]) ?? []).map((p) => ({ tier: t, pick: p as Record<string, unknown> })));
      const { data: runRow, error: runErr } = await sb.from("web_picks_runs").insert({
        market_read: (buckets.marketRead as string) ?? "",
        source_count: allSources.length,
        pick_count: allPicks.length,
        sources: allSources,
      }).select("id").single();
      if (runErr) throw runErr;
      runId = runRow!.id as string;
      if (allPicks.length) {
        const rows = allPicks.map(({ tier, pick }) => ({
          run_id: runId, tier,
          symbol: String(pick.symbol ?? "").toUpperCase(),
          strategy: String(pick.strategy ?? ""),
          option_type: String(pick.optionType ?? ""),
          direction: String(pick.direction ?? ""),
          strike: Number(pick.strike ?? 0),
          strike_short: pick.strikeShort != null ? Number(pick.strikeShort) : null,
          expiry: String(pick.expiry ?? new Date().toISOString().slice(0, 10)),
          play_at: Number(pick.playAt ?? 0),
          premium_estimate: pick.premiumEstimate ? String(pick.premiumEstimate) : null,
          thesis: String(pick.thesis ?? ""),
          risk: String(pick.risk ?? ""),
          source: String(pick.source ?? ""),
          // New rich-signal columns (added 2026-04). Each is optional — preserves
          // back-compat if NOVA omits a field for a given pick.
          bias: pick.bias ? String(pick.bias) : null,
          expected_return: pick.expectedReturn ? String(pick.expectedReturn) : null,
          probability: pick.probability ? String(pick.probability) : null,
          risk_level: pick.riskLevel ? String(pick.riskLevel) : null,
          grade: pick.grade ? String(pick.grade) : null,
          grade_rationale: pick.gradeRationale ? String(pick.gradeRationale) : null,
          outcome: "open",
        }));
        const { error: pickErr } = await sb.from("web_picks").insert(rows);
        if (pickErr) console.error("[options-scout] persist picks failed", pickErr);
      }
    } catch (e) {
      console.error("[options-scout] persistence failed (non-fatal)", e);
    }

    return new Response(
      JSON.stringify({
        ...buckets,
        runId,
        sources: allSources,
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("options-scout error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function pickSchema() {
  return {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Underlying ticker, e.g. AAPL" },
      strategy: { type: "string", description: "e.g. 'Covered call', 'Bull put spread', '0DTE call', 'Iron condor', 'Swing call'" },
      optionType: { type: "string", enum: ["call", "put", "call_spread", "put_spread", "straddle", "strangle", "iron_condor"], description: "Primary leg type" },
      direction: { type: "string", enum: ["long", "short"], description: "Buying (long) or selling (short) the primary leg" },
      strike: { type: "number", description: "Primary strike price in USD." },
      strikeShort: { type: "number", description: "Optional second strike for spreads/multi-leg." },
      expiry: { type: "string", description: "Expiration YYYY-MM-DD. Real upcoming weekly/monthly expiry, in the future." },
      playAt: { type: "number", description: "Underlying price at which to enter (USD)." },
      premiumEstimate: { type: "string", description: "Rough expected option premium per contract (e.g. '$1.20-1.40')." },
      bias: { type: "string", enum: ["bullish", "bearish", "neutral"], description: "Directional bias of the trade." },
      expectedReturn: { type: "string", description: "Expected return on premium / max gain (e.g. '40%')." },
      probability: { type: "string", description: "Estimated probability of profit (e.g. '70%')." },
      riskLevel: { type: "string", enum: ["low", "medium", "high"], description: "Overall risk level." },
      thesis: { type: "string", description: "Why this trade — 1-2 sentences. Reference regime + setup + vol edge." },
      risk: { type: "string", description: "Main risk + invalidation scenario (what could go wrong)." },
      bestEntry: { type: "string", description: "Best entry trigger / level." },
      bestExit: { type: "string", description: "Profit target + stop." },
      grade: { type: "string", enum: ["A", "B", "C"], description: "NOVA confidence grade (A=90+, B=75-89, C=60-74)." },
      gradeRationale: { type: "string", description: "Why this grade — name the strongest 2 weighted factors." },
      source: { type: "string", description: "Which source flagged it (URL or domain)." },
    },
    required: ["symbol", "strategy", "optionType", "direction", "strike", "expiry", "playAt", "bias", "expectedReturn", "probability", "riskLevel", "thesis", "risk", "bestEntry", "bestExit", "grade", "gradeRationale", "source"],
    additionalProperties: false,
  };
}
