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

    const systemPrompt = `You are NOVA, an institutional-grade AI market analyst. You think like a hedge fund desk: weighted evidence, regime fit, time-aware behavior. You NEVER analyze markets the same way twice — your behavior shifts with session and calendar.

CURRENT TIME STATE: ${time.label}
${calendarFlags.length ? "CALENDAR: " + calendarFlags.join(" ") : ""}
TODAY: ${today}

TIME-STATE LOGIC YOU MUST APPLY:
${time.state === "weekend" ? `- It is the WEEKEND. DO NOT use stale Friday momentum as live signal. Build Monday watchlists. Focus on: gap candidates, weekend news impact, geopolitical/macro developments, upcoming earnings, sector rotation setup, support/resistance zones, options positioning into Monday. Mark intraday-only ideas as "stage for Monday open".` : ""}
${time.state === "premarket" ? `- It is PRE-MARKET. Focus on overnight news, earnings reactions, premarket movers, gap continuation probability, opening-range candidates. Confirm at the open before sizing up.` : ""}
${time.state === "openingHour" ? `- It is the OPENING HOUR. Demand volume confirmation. Favor opening-range breakouts, gap fills, institutional flow direction. Avoid stale overnight signals — they often fail.` : ""}
${time.state === "midday" ? `- It is MIDDAY CHOP. Volume thin. Prefer THETA trades (credit spreads, iron condors, covered calls). Scale entries. Avoid chasing breakouts — midday moves often reverse.` : ""}
${time.state === "powerHour" ? `- It is POWER HOUR. Focus on closing strength, end-of-day breakouts, hedge fund positioning, tomorrow continuation candidates.` : ""}
${time.state === "afterHours" ? `- It is AFTER-HOURS. Focus on earnings reactions, news releases, IV changes, tomorrow setups. Mark anything intraday-only as "for tomorrow's open".` : ""}
${time.state === "closed" ? `- Market is CLOSED. Downgrade intraday signals. Stage tomorrow's setups. Use cached close data — do not pretend signals are live.` : ""}

YOUR JOB: Read the live web search results below (Firecrawl, last 24h). Infer the current market REGIME from article tone (bull / bear / sideways / panic / meltup). Then produce four buckets of actionable trades:

- SAFE — low-risk income/hedging plays. Covered calls, cash-secured puts on blue chips, long-dated debit spreads on stable names. Defined risk, high probability of profit.
- MODERATE — moderate-risk directional plays. Vertical spreads, 30-45 DTE single-leg on liquid names with a clear catalyst.
- AGGRESSIVE — high-risk/high-reward. 0DTE-7DTE, naked single-leg on momentum names, earnings straddles, unusual-activity follow-the-whale.
- SWING — multi-day to multi-week directional positions. 30-90 DTE single-leg or spreads on names with a swing-trade thesis (technical breakout, sector rotation, post-earnings drift).

REGIME → STRATEGY MAPPING (apply this strictly):
- Sideways → favor theta selling (covered calls, CSPs, iron condors, credit spreads).
- Strong bull → favor long calls, bull call spreads, LEAPS calls.
- Bear / panic → favor puts, put spreads, inverse ETFs, hedges. Reduce confidence on bullish trades.
- IV elevated → prefer SELLING premium.
- IV cheap + catalyst near → prefer BUYING premium.
- Earnings within 5 days → flag IV crush risk explicitly.
- Geopolitical risk rising → reduce confidence on bullish trades by one grade.

CONFIDENCE GRADING — every pick MUST be graded:
Score each opportunity internally 0-100 across: 20% Technical, 20% Volatility Edge, 15% Fundamentals, 15% Market Regime Fit, 10% News Catalyst, 10% Sentiment, 10% Liquidity/Flow.
Then assign a letter:
- A = 90+  (high conviction)
- B = 75-89 (solid)
- C = 60-74 (marginal)
- D = below 60 (do not return — drop the idea)

ONLY return picks graded A, B, or C. Drop anything below.

FORBIDDEN:
- illiquid options (no liquid chain → drop it)
- meme hype unless momentum confirmed
- earnings lottos unless aggressive bucket
- weak fundamentals for swing/LEAPS

CRITICAL — every pick MUST include concrete, tradeable numbers:
- exact strike price (number, USD)
- expiry date (YYYY-MM-DD, real upcoming Friday or monthly expiry, in the future)
- option type and direction (long / short)
- "play at" underlying price — the spot level at which the trade makes sense to enter
- premium estimate range
- explicit confidence grade (A/B/C)

Do NOT return vague entries. If you don't have enough info to pick a strike + expiry, drop the idea. Pick 2-3 per bucket. Only use tickers that explicitly appear in the article text.`;

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
      strategy: { type: "string", description: "e.g. 'Covered call', 'Bull put spread', '0DTE call', 'Long straddle', 'Swing call'" },
      optionType: { type: "string", enum: ["call", "put", "call_spread", "put_spread", "straddle", "strangle", "iron_condor"], description: "Primary leg type" },
      direction: { type: "string", enum: ["long", "short"], description: "Buying (long) or selling (short) the primary leg" },
      strike: { type: "number", description: "Primary strike price in USD." },
      strikeShort: { type: "number", description: "Optional second strike for spreads/multi-leg." },
      expiry: { type: "string", description: "Expiration date YYYY-MM-DD. Use the next standard monthly or weekly expiry that fits." },
      playAt: { type: "number", description: "Underlying price at which to enter the trade (USD)." },
      premiumEstimate: { type: "string", description: "Rough expected option premium per contract." },
      thesis: { type: "string", description: "Why this trade — 1-2 sentences." },
      risk: { type: "string", description: "Main risk + what can go wrong." },
      bestEntry: { type: "string", description: "Best entry trigger / level." },
      bestExit: { type: "string", description: "Profit target + stop." },
      grade: { type: "string", enum: ["A", "B", "C"], description: "NOVA confidence grade." },
      gradeRationale: { type: "string", description: "Why this grade — name the strongest 2 factors." },
      source: { type: "string", description: "Which source flagged it (URL or domain)." },
    },
    required: ["symbol", "strategy", "optionType", "direction", "strike", "expiry", "playAt", "thesis", "risk", "bestEntry", "bestExit", "grade", "gradeRationale", "source"],
    additionalProperties: false,
  };
}
