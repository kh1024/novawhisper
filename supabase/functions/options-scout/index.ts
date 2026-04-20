// Options Scout — institutional-grade NOVA brain (BUY PREMIUM ONLY).
//
// Per spec: NEVER recommends covered calls, CSPs, wheels, iron condors,
// credit spreads, or any short-premium / income strategy. Only:
//   1) Long Calls   2) Long Puts   3) LEAPS Calls   4) LEAPS Puts
//   5) Call Debit Spreads (rare — only if superior to long calls)
//   6) Put Debit Spreads  (rare — only if superior to long puts)
//
// Returns 4 buckets — Conservative / Moderate / Aggressive / Lottery —
// with a market-regime read and a final summary block. Behavior shifts
// with the US/Eastern session (weekend, premarket, opening hour, midday,
// power hour, after-hours, closed) so NOVA never analyzes the tape twice
// the same way.
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

// ─── Search queries — biased toward BUY-side flow (no income / theta queries) ─
function queriesForTimeState(t: ReturnType<typeof detectTimeState>): { tier: string; q: string }[] {
  const evergreen = [
    { tier: "moderate", q: "site:seekingalpha.com earnings calendar this week expected move" },
    { tier: "aggressive", q: "site:benzinga.com unusual options activity calls puts whale today" },
    { tier: "moderate", q: "site:barchart.com top gainers losers today momentum stocks" },
    { tier: "conservative", q: "best LEAPS calls 2026 long term thesis quality stocks" },
  ];
  let stateSpecific: { tier: string; q: string }[];
  if (t.state === "weekend") {
    stateSpecific = [
      { tier: "moderate", q: "monday stock market watchlist gap candidates this week" },
      { tier: "moderate", q: "next week earnings calendar most anticipated stocks options" },
    ];
  } else if (t.state === "premarket") {
    stateSpecific = [
      { tier: "aggressive", q: "site:cnbc.com pre-market movers today stocks gainers losers" },
      { tier: "lottery", q: "premarket gap stocks today catalyst earnings reaction explosive" },
    ];
  } else if (t.state === "openingHour") {
    stateSpecific = [
      { tier: "aggressive", q: "opening range breakout stocks today high volume momentum" },
      { tier: "moderate", q: "stocks gap fill candidates today open continuation" },
    ];
  } else if (t.state === "midday") {
    stateSpecific = [
      { tier: "moderate", q: "stocks pullback to support today buy setup long calls" },
      { tier: "conservative", q: "quality stocks oversold bounce LEAPS entry today" },
    ];
  } else if (t.state === "powerHour") {
    stateSpecific = [
      { tier: "aggressive", q: "end of day breakout stocks closing strength power hour" },
      { tier: "moderate", q: "stocks closing at highs today swing trade tomorrow" },
    ];
  } else if (t.state === "afterHours") {
    stateSpecific = [
      { tier: "lottery", q: "after hours earnings movers today stock reaction explosive" },
      { tier: "moderate", q: "tomorrow stock market setups premarket watchlist" },
    ];
  } else {
    stateSpecific = [
      { tier: "moderate", q: "next session stock market watchlist setups long calls" },
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

    const groups = await Promise.all(
      QUERIES.map(async (q) => ({ tier: q.tier, query: q.q, results: await fcSearch(q.q) })),
    );
    const totalResults = groups.reduce((n, g) => n + g.results.length, 0);
    if (totalResults === 0) {
      return new Response(JSON.stringify({ error: "Firecrawl returned no results. Try again in a moment." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const systemPrompt = `You are NOVA, an elite institutional-level options scanner.

YOUR JOB: identify ONLY the highest-quality BUYING-PREMIUM opportunities.

═══ ALLOWED STRATEGIES ═══
1) Long Calls
2) Long Puts
3) LEAPS Calls
4) LEAPS Puts (rare — only for strong bearish long-term thesis)
5) Call Debit Spreads (only if superior to a naked long call)
6) Put  Debit Spreads (only if superior to a naked long put)

═══ FORBIDDEN — NEVER RECOMMEND ═══
- Covered calls, cash-secured puts, the wheel, iron condors, credit spreads,
  naked option selling, any income / short-premium strategy, low-liquidity
  contracts. If it's not a buy-premium trade, drop it.

═══ PRIMARY OBJECTIVE ═══
Generate only high-probability, high-quality setups. If no strong setups
exist, return empty buckets and set staySafe=true with reason
"NO TRADE TODAY — preserve capital." Cash IS a position. No filler trades.

CURRENT TIME STATE: ${time.label}
${calendarFlags.length ? "CALENDAR: " + calendarFlags.join(" ") : ""}
TODAY: ${today}

═══ MARKET REGIME ANALYSIS (do this first) ═══
Classify the regime as exactly one of:
- "bull"     (Bullish Trend)
- "bear"     (Bearish Trend)
- "sideways" (Range Bound)
- "panic"    (High Vol / Event Risk)
- "meltup"   (Risk-On Growth)
- "defensive"(Defensive Rotation)
Use SPY/QQQ trend, VIX behavior, sector leadership, breadth, momentum, macro
catalysts. Then ADAPT recommendations to that regime:
- bull / meltup  → favor long calls, LEAPS calls, call debit spreads on dips
- bear / panic   → favor long puts, hedges, put debit spreads
- sideways       → mostly NO TRADE; only A-grade catalyst breakouts
- defensive      → quality LEAPS only; reduce aggressive bucket size

═══ TIME-STATE LOGIC (apply strictly) ═══
${time.state === "weekend" ? `- WEEKEND. No live signals. Build Monday watchlists, gap candidates, weekend-news impact, geopolitical/macro, upcoming earnings, sector rotation. Mark intraday-only ideas as "stage for Monday open". Down-weight fresh price signals.` : ""}
${time.state === "premarket" ? `- PRE-MARKET. Focus overnight news, earnings reactions, premarket movers, gap continuation, opening-range candidates. Confirm at open before sizing.` : ""}
${time.state === "openingHour" ? `- OPENING HOUR (9:30-10:30 ET). Demand volume confirmation. Favor opening-range breakouts, gap fills, institutional flow direction.` : ""}
${time.state === "midday" ? `- MIDDAY CHOP (10:30-2:00 ET). Volume thin. Be picky — prefer pullbacks to support inside trends. Avoid chasing breakouts.` : ""}
${time.state === "powerHour" ? `- POWER HOUR (2:00-4:00 ET). Closing strength, EOD breakouts, institutional positioning, tomorrow continuation candidates.` : ""}
${time.state === "afterHours" ? `- AFTER-HOURS. Earnings reactions, news, IV changes, tomorrow setups. Mark intraday-only ideas as "for tomorrow's open".` : ""}
${time.state === "closed" ? `- CLOSED. Down-weight intraday signals. Stage tomorrow.` : ""}

═══ FOUR RISK BUCKETS — return MAX 12 trades total ═══
Return 3 per bucket; fewer if quality is lacking; never filler.
Maximum 1 trade per ticker in conservative/moderate/aggressive. Lottery may
repeat a ticker only for an exceptional setup.

CONSERVATIVE (3 trades):
- Large cap or ETF, high liquidity, tight bid/ask, strong structure
- Lower / fair IV, 60+ DTE or LEAPS
- Higher probability of profit
- Strategies: Long ITM Call (delta 0.70-0.85), LEAPS Call/Put

MODERATE (3 trades):
- Trend continuation, pullback entry, breakout setup
- 30-90 DTE, balanced reward/risk
- Strategies: Long Call (delta 0.55-0.70), Long Put, occasional Call Debit Spread

AGGRESSIVE (3 trades):
- Catalyst play, momentum breakout, reversal setup
- 14-45 DTE, higher upside, lower probability
- Strategies: ATM Long Call/Put (delta 0.45-0.55)

LOTTERY PICKS (3 trades — entertainment / speculative only):
- Tiny size 0.25%-1% of account
- Real catalyst or technical trigger required (NOT pure hype)
- Tight enough spreads, accept 100% loss possible
- ≥3× upside potential
- 7-30 DTE
- Strategies: short-dated Long Call or Long Put
- NEVER rank a lottery pick above a quality conservative/moderate trade

═══ SCREENING FACTORS (use what's in the article context) ═══
20/50/200 EMA, RSI, MACD, relative strength, relative volume, options volume,
open interest, bid/ask spread, IV Rank / IV Percentile, expected move,
support/resistance, breakouts, breakdowns, earnings/Fed/CPI/news catalysts.

═══ STRIKE & EXPIRATION RULES — PROFESSIONAL STRIKE SELECTION + CONTRACT SANITY ═══

DELTA BANDS (long single-leg) — match strike to user risk profile:
| Bucket       | Call Delta  | Put Delta      | Moneyness preference |
| Conservative | 0.65-0.80   | -0.65 to -0.80 | Slight ITM / ITM     |
| Moderate     | 0.50-0.65   | -0.50 to -0.65 | ATM / Slight ITM     |
| Aggressive   | 0.35-0.55   | -0.35 to -0.55 | ATM / Slight OTM     |
| Lottery      | 0.10-0.30   | -0.10 to -0.30 | OTM (small size)     |

CONTRACT SANITY — REJECT BEFORE RECOMMENDING:
1. CALL: if strike < playAt × 0.75 (>25% deep ITM) → REJECT. "Too deep ITM, poor leverage / expensive capital use." Use ATM call or call debit spread instead.
2. CALL: if strike > playAt × 1.25 (>25% OTM) → only Lottery. NEVER label Conservative or Moderate.
3. CALL: if strike > playAt × 1.50 (>50% OTM) → HARD REJECT.
4. PUT mirrors: strike > playAt × 1.25 = deep ITM reject; strike < playAt × 0.75 = lottery only; strike < playAt × 0.50 = hard reject.

REALISTIC MOVE CHECK:
- moveNeededPct = |strike - playAt| / playAt × 100
- If moveNeededPct > expectedMove × 1.5 → downgrade, label "Low probability strike"
- If moveNeededPct > expectedMove × 2.0 → REJECT unless Lottery

CAPITAL EFFICIENCY:
- premium > 8% of underlying AND delta > 0.85 → suggest stock or debit spread instead.
- naked long inefficient (premium > 5-10% of stock OR breakeven move > expected vol window) → use a debit spread and explain why.
- Never pick delta > 0.90 unless explicit Stock-Replacement justification.

LABEL CORRECTION (apply BEFORE returning):
- Strike > 15% OTM → max label = Aggressive
- Strike > 25% OTM → label = Lottery
- Delta < 0.30 → label = Lottery
- Delta > 0.75 AND liquid → may be Conservative

IV LOGIC:
- IV Rank > 80 → avoid naked longs unless catalyst; prefer debit spreads
- IV Rank < 40 → prefer naked long calls/puts and debit spreads

DTE → bucket:
- 0-7 DTE  → lottery only (event-driven)
- 7-30 DTE → aggressive / lottery
- 30-90 DTE → moderate / aggressive
- 90-180 DTE → moderate / conservative
- >180 DTE → LEAPS — conservative only, delta 0.60-0.75

SCORING PENALTIES (apply to confidenceScore):
- Deep ITM capital inefficient: -2 · Far OTM low prob: -2.5 · Wide spread: -1.5
- Low OI: -1.5 · IV overpriced no catalyst: -1.5 · Move unrealistic: -2

FINAL RULE: Do not recommend what merely exists in the chain. Recommend what is statistically and financially intelligent. If no good contract exists for a bucket, return [] for that bucket.

═══ RULES BY STRATEGY ═══
LONG CALLS — prefer in bullish regime, strong uptrend, pullback to support,
breakout volume, IV cheap/fair. Avoid when IV expensive, directly under
resistance, or weak market breadth.

LONG PUTS — prefer in bearish regime, breakdown, weak sector, failed rally.
Avoid in oversold bounce zones or strong bull tape.

LEAPS — strong companies / ETFs, multi-month thesis, pullback entries, fair IV.

DEBIT SPREADS — only when IV elevated, moderate expected move, defined risk
clearly superior, lower cost preferred. Always explain why the spread beats
the naked long.

═══ CONFIDENCE GRADING (weighted score 0-100) ═══
20% Technical setup · 20% Volatility edge · 15% Fundamentals · 15% Regime fit
· 10% News/catalyst · 10% Sentiment · 10% Liquidity
A=90+, B=75-89, C=60-74, D=<60. Return ONLY A/B/C picks. Drop D.

═══ RISK MANAGEMENT (hard rules) ═══
- Per-trade risk ≤ 1-2% of account. Never > 5%.
- Reject illiquid options.
- Always specify entry trigger, profit targets, stop loss, time exit, and
  invalidation level.
- Lottery total exposure ≤ 10% of total suggested capital.
- No naked premium buy right before earnings/FOMC unless explicit vol play.

═══ FORBIDDEN ═══
- Illiquid chains. Meme hype without confirmed momentum. Earnings lottos
  outside aggressive/lottery. Weak fundamentals on conservative/LEAPS.
  Vague entries.

═══ OUTPUT REQUIREMENTS ═══
Each pick MUST include: symbol, strategy ("Long Call" / "Long Put" / "LEAPS Call"
/ "LEAPS Put" / "Call Debit Spread" / "Put Debit Spread"), optionType (call|put),
direction ("long"), strike (USD), strikeShort (only for debit spreads, else
omit), expiry YYYY-MM-DD (real future weekly/monthly), playAt (entry underlying
USD), premiumEstimate (range), bias, expectedReturn %, probability %, riskLevel,
liquidityRating 1-10, confidenceScore 1-10, riskScore 1-10, thesis (Why This
Setup), whyStrike, whyExpiration, whyNow, profitTarget1, profitTarget2,
stopLoss, timeExit, invalidationLevel, betterThanAlternative (long vs spread
reasoning), avoidIf, grade (A/B/C), gradeRationale.

ALWAYS also return the FINAL SUMMARY block: marketRegime, marketRead,
bestOverallTrade, safestTrade, highestUpsideTrade, bestLeapsTrade,
bestLotteryPick, stayInCash (yes/no + reason).

If the market is poor or unclear: return FEWER trades. Quality over quantity.`;

    const userPrompt = `Web search results (Firecrawl, last 24h, grouped by suggested risk tier — but YOU make the final bucket call based on time-state and regime):

${context}

INSTRUCTIONS:
1. First classify the market regime and write a one-sentence MARKET READ.
2. Return up to 3 picks per bucket: conservative / moderate / aggressive / lottery.
   BUY-PREMIUM ONLY. NEVER recommend covered calls, CSPs, wheels, condors,
   credit spreads, or any short-premium strategy.
3. For every pick, fill in every output field — no vague entries.
4. If a bucket has no quality A/B/C setup at this time-state, return [] for it.
5. Return the FINAL SUMMARY block with stayInCash recommendation.`;

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
            description: "Return four buy-premium-only buckets of NOVA-graded options ideas plus regime + final summary.",
            parameters: {
              type: "object",
              properties: {
                marketRead: { type: "string", description: "One-sentence regime + time-state read." },
                regime: { type: "string", enum: ["bull", "bear", "sideways", "panic", "meltup", "defensive"], description: "Inferred market regime." },
                timeState: { type: "string" },
                bestStrategyNow: { type: "string" },
                avoidRightNow: { type: "string" },
                conservative: { type: "array", items: pickSchema() },
                moderate: { type: "array", items: pickSchema() },
                aggressive: { type: "array", items: pickSchema() },
                lottery: { type: "array", items: pickSchema() },
                summary: {
                  type: "object",
                  properties: {
                    bestOverallTrade: { type: "string" },
                    safestTrade: { type: "string" },
                    highestUpsideTrade: { type: "string" },
                    bestLeapsTrade: { type: "string" },
                    bestLotteryPick: { type: "string" },
                    stayInCash: { type: "string", description: "'yes' or 'no' followed by one-sentence reason." },
                  },
                  required: ["bestOverallTrade", "safestTrade", "highestUpsideTrade", "bestLeapsTrade", "bestLotteryPick", "stayInCash"],
                  additionalProperties: false,
                },
              },
              required: ["marketRead", "regime", "timeState", "bestStrategyNow", "avoidRightNow", "conservative", "moderate", "aggressive", "lottery", "summary"],
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
    const aiText = await aiResp.text();
    let aiJson: any = {};
    try { aiJson = aiText ? JSON.parse(aiText) : {}; }
    catch (e) { console.error("[options-scout] AI body not JSON:", aiText.slice(0, 200)); }
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let buckets: Record<string, unknown> = {
      marketRead: "", regime: "sideways", timeState: time.label, bestStrategyNow: "", avoidRightNow: "",
      conservative: [], moderate: [], aggressive: [], lottery: [], summary: {},
    };
    if (toolCall?.function?.arguments) {
      try { buckets = JSON.parse(toolCall.function.arguments); }
      catch (e) { console.error("[options-scout] parse failed", e); }
    }

    // Strict whitelist of allowed strategies (case-insensitive substring).
    const ALLOWED_STRATS = ["long call", "long put", "leaps call", "leaps put", "call debit spread", "put debit spread"];
    const isAllowed = (p: Record<string, unknown>) => {
      const strat = String(p.strategy ?? "").toLowerCase();
      const ot = String(p.optionType ?? "").toLowerCase();
      const dir = String(p.direction ?? "").toLowerCase();
      if (dir === "short") return false;
      if (ot !== "call" && ot !== "put") return false;
      return ALLOWED_STRATS.some((a) => strat.includes(a));
    };

    // ─── PROFESSIONAL STRIKE SELECTION + CONTRACT SANITY (server-side) ───
    // Even if the model drifts, these rules guarantee no absurd ITM / far-OTM
    // mislabeled picks reach the UI.
    type Tier = "conservative" | "moderate" | "aggressive" | "lottery";
    function sanityCheck(p: Record<string, unknown>, originalTier: Tier):
      { keep: boolean; tier: Tier; reason?: string; penalty: number } {
      const strike = Number(p.strike ?? 0);
      const playAt = Number(p.playAt ?? 0);
      const ot = String(p.optionType ?? "").toLowerCase();
      const isSpread = /debit spread/i.test(String(p.strategy ?? ""));
      if (!strike || !playAt) return { keep: true, tier: originalTier, penalty: 0 };

      const moneynessPct = ((strike - playAt) / playAt) * 100;
      const otmCallPct = ot === "call" ? moneynessPct : -moneynessPct;
      const itmCallPct = -otmCallPct;
      const otmPutPct = ot === "put" ? -moneynessPct : moneynessPct;
      const itmPutPct = -otmPutPct;

      if (ot === "call") {
        if (otmCallPct > 50) return { keep: false, tier: originalTier, reason: "Call >50% OTM hard reject", penalty: 0 };
        if (itmCallPct > 25 && !isSpread) return { keep: false, tier: originalTier, reason: "Call >25% deep ITM — capital inefficient", penalty: 0 };
      } else if (ot === "put") {
        if (otmPutPct > 50) return { keep: false, tier: originalTier, reason: "Put >50% OTM hard reject", penalty: 0 };
        if (itmPutPct > 25 && !isSpread) return { keep: false, tier: originalTier, reason: "Put >25% deep ITM — capital inefficient", penalty: 0 };
      }

      let tier: Tier = originalTier;
      const farOtm = ot === "call" ? otmCallPct : otmPutPct;
      if (farOtm > 25) tier = "lottery";
      else if (farOtm > 15 && (tier === "conservative" || tier === "moderate")) tier = "aggressive";

      let penalty = 0;
      if (farOtm > 25) penalty += 25;
      else if (farOtm > 15) penalty += 10;
      const deepItm = ot === "call" ? itmCallPct : itmPutPct;
      if (deepItm > 15 && !isSpread) penalty += 20;
      return { keep: true, tier, penalty };
    }

    const TIERS: Tier[] = ["conservative", "moderate", "aggressive", "lottery"];
    const sanitized: Record<Tier, Record<string, unknown>[]> = {
      conservative: [], moderate: [], aggressive: [], lottery: [],
    };
    for (const t of TIERS) {
      const arr = (buckets[t] as unknown[] | undefined) ?? [];
      for (const raw of arr) {
        const p = raw as Record<string, unknown>;
        if (!isAllowed(p)) continue;
        const res = sanityCheck(p, t);
        if (!res.keep) {
          console.log(`[options-scout] sanity rejected ${p.symbol} ${p.strategy} ${p.strike}: ${res.reason}`);
          continue;
        }
        if (res.penalty) {
          const cs = Number(p.confidenceScore ?? 7);
          p.confidenceScore = Math.max(1, cs - res.penalty / 10);
        }
        sanitized[res.tier].push(p);
      }
    }
    buckets.conservative = sanitized.conservative;
    buckets.moderate = sanitized.moderate;
    buckets.aggressive = sanitized.aggressive;
    buckets.lottery = sanitized.lottery;

    // 5) Persist this run + picks for history & performance tracking
    let runId: string | null = null;
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const tiers = ["conservative", "moderate", "aggressive", "lottery"] as const;
      const allPicks = tiers.flatMap((t) => ((buckets[t] as unknown[]) ?? [])
        .map((p) => ({ tier: t, pick: p as Record<string, unknown> }))
        .filter(({ pick }) => isAllowed(pick)));
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
          direction: String(pick.direction ?? "long"),
          strike: Number(pick.strike ?? 0),
          strike_short: pick.strikeShort != null ? Number(pick.strikeShort) : null,
          expiry: String(pick.expiry ?? new Date().toISOString().slice(0, 10)),
          play_at: Number(pick.playAt ?? 0),
          premium_estimate: pick.premiumEstimate ? String(pick.premiumEstimate) : null,
          thesis: String(pick.thesis ?? ""),
          risk: String(pick.risk ?? pick.avoidIf ?? ""),
          source: String(pick.source ?? ""),
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

    // Filter buckets in the response too — same whitelist guard.
    const filterBucket = (arr: unknown): unknown[] =>
      Array.isArray(arr) ? arr.filter((p) => isAllowed(p as Record<string, unknown>)) : [];

    return new Response(
      JSON.stringify({
        ...buckets,
        conservative: filterBucket(buckets.conservative),
        moderate: filterBucket(buckets.moderate),
        aggressive: filterBucket(buckets.aggressive),
        lottery: filterBucket(buckets.lottery),
        // Back-compat aliases for any UI still reading the old field names.
        safe: filterBucket(buckets.conservative),
        mild: filterBucket(buckets.moderate),
        swing: filterBucket(buckets.lottery),
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
      strategy: { type: "string", enum: ["Long Call", "Long Put", "LEAPS Call", "LEAPS Put", "Call Debit Spread", "Put Debit Spread"], description: "BUY-PREMIUM ONLY." },
      optionType: { type: "string", enum: ["call", "put"] },
      direction: { type: "string", enum: ["long"], description: "Always long. Short premium is forbidden." },
      strike: { type: "number" },
      strikeShort: { type: "number", description: "Short leg strike — REQUIRED for debit spreads, omit otherwise." },
      expiry: { type: "string", description: "YYYY-MM-DD, real future weekly/monthly." },
      playAt: { type: "number", description: "Entry underlying price (USD)." },
      premiumEstimate: { type: "string", description: "Per-contract premium range, e.g. '$1.20-1.40'." },
      bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      expectedReturn: { type: "string", description: "e.g. '40%' or '2x'." },
      probability: { type: "string", description: "Estimated probability of profit, e.g. '65%'." },
      riskLevel: { type: "string", enum: ["low", "medium", "high"] },
      liquidityRating: { type: "number", description: "1-10." },
      confidenceScore: { type: "number", description: "1-10." },
      riskScore: { type: "number", description: "1-10." },
      thesis: { type: "string", description: "Why This Setup — 1-2 sentences." },
      whyStrike: { type: "string" },
      whyExpiration: { type: "string" },
      whyNow: { type: "string" },
      profitTarget1: { type: "string" },
      profitTarget2: { type: "string" },
      stopLoss: { type: "string" },
      timeExit: { type: "string" },
      invalidationLevel: { type: "string" },
      betterThanAlternative: { type: "string", description: "Why this beats the alt structure (long vs spread)." },
      avoidIf: { type: "string" },
      bestEntry: { type: "string" },
      bestExit: { type: "string" },
      risk: { type: "string", description: "Main risk + invalidation scenario." },
      grade: { type: "string", enum: ["A", "B", "C"] },
      gradeRationale: { type: "string" },
      source: { type: "string" },
    },
    required: ["symbol", "strategy", "optionType", "direction", "strike", "expiry", "playAt", "bias", "expectedReturn", "probability", "riskLevel", "thesis", "risk", "bestEntry", "bestExit", "grade", "gradeRationale", "source"],
    additionalProperties: false,
  };
}
