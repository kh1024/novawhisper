// Portfolio Verdict — pulls live underlying, daily history (for RSI/EMA),
// real Greeks per position, runs the Conflict Resolution Layer, and asks Nova
// (Lovable AI) for a brutally honest plain-English verdict alongside the
// deterministic GO/WAIT/NO/EXIT signal.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface InPosition {
  id: string;
  symbol: string;
  optionType: string;
  direction: string;
  strike: number;
  strikeShort?: number | null;
  expiry: string;
  contracts: number;
  entryPremium?: number | null;
  entryUnderlying?: number | null;
  thesis?: string | null;
}

interface Quote { symbol: string; price: number; changePct: number; status: string }
interface History { symbol: string; closes: number[] }
interface OptionContract {
  type: string; strike: number; expiration: string; dte: number;
  delta: number | null; theta: number | null; iv: number | null; mid: number;
}

// ── helpers ────────────────────────────────────────────────────────────────
async function fetchJson<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch (e) {
    console.warn(`[portfolio-verdict] ${path} failed`, e);
    return null;
  }
}

function daysTo(expiry: string): number {
  const d = new Date(expiry + "T16:00:00Z").getTime();
  return Math.round((d - Date.now()) / 86_400_000);
}
function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}
function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function streak(closes: number[]): number {
  let s = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] > closes[i - 1]) s++;
    else break;
  }
  return s;
}
// Realized volatility over last `period` daily closes, annualized (252).
function realizedVolAnnualized(closes: number[], period = 30): number | null {
  if (closes.length < period + 1) return null;
  const slice = closes.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const r = Math.log(slice[i] / slice[i - 1]);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}
// IV Percentile estimate: where current IV sits between 0.5×RV and 2.5×RV
// (a common rule-of-thumb band when historical IV series isn't available).
function ivPercentileEstimate(iv: number | null, rv: number | null): number | null {
  if (iv == null || rv == null || rv <= 0) return null;
  const lo = rv * 0.5, hi = rv * 2.5;
  const pct = ((iv - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, +pct.toFixed(0)));
}
// Is "now" before 10:30 AM US-Eastern on a weekday? (Opening-range window.)
function beforeOpeningRange(now = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(get("hour"));
  const m = Number(get("minute"));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  // Market opens 09:30 ET. "Opening range" = 09:30–10:30. We only force WAIT
  // during that window itself (not pre-market, not after 10:30).
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes < 10 * 60 + 30;
}

type CrlVerdict = "GO" | "WAIT" | "NO" | "EXIT" | "NEUTRAL";
type RiskBadge = "Safe" | "Mild" | "Aggressive";
interface ValuationAlert {
  triggered: boolean;
  intrinsicValue: number | null;
  premiumPct: number | null;
  message: string | null;
}
interface CrlOutput {
  verdict: CrlVerdict;
  reason: string;
  riskBadge: RiskBadge | null;
  stopLossTriggered: boolean;
  emaDistancePct: number | null;
  highMomentum: boolean;
  flags: string[];
  valuationAlert: ValuationAlert;
  // Strategic Validation Layer
  trendGateBroken: boolean;          // price < SMA200 → no calls
  highPremium: boolean;              // IV percentile > 75
  openingRange: boolean;             // before 10:30 AM ET on a weekday
  premiumStopTriggered: boolean;     // option premium dropped ≥30% from entry
}

const VALUATION_OVERSHOOT_PCT = 15;
const EMA_OVERSHOOT_PCT = 15;
const PREMIUM_STOP_PCT = 30;        // hard stop-loss on option premium drop
const HIGH_PREMIUM_IVP = 75;        // IV percentile threshold for "High Premium"

// Expert risk classification — Greeks AND RSI together.
function classifyRisk(
  delta: number | null, theta: number | null, iv: number | null, rsi: number | null,
): RiskBadge | null {
  if (delta == null && theta == null && iv == null && rsi == null) return null;
  const aD = delta != null ? Math.abs(delta) : null;
  const aT = theta != null ? Math.abs(theta) : null;
  // Aggressive — any single hot signal.
  if (
    (aD != null && aD < 0.35) ||
    (aT != null && aT > 0.5) ||
    (iv != null && iv >= 0.6) ||
    (rsi != null && rsi > 70)
  ) return "Aggressive";
  // Safe — full deep-ITM stock-replacement profile.
  if (
    aD != null && aD > 0.8 &&
    aT != null && aT < 0.15 &&
    (rsi == null || rsi < 60)
  ) return "Safe";
  return "Mild";
}

function computeValuationAlert(spot: number | null, intrinsic: number | null): ValuationAlert {
  if (spot == null || intrinsic == null || intrinsic <= 0) {
    return { triggered: false, intrinsicValue: intrinsic, premiumPct: null, message: null };
  }
  const premiumPct = (spot / intrinsic - 1) * 100;
  if (premiumPct < VALUATION_OVERSHOOT_PCT) {
    return { triggered: false, intrinsicValue: intrinsic, premiumPct, message: null };
  }
  return {
    triggered: true,
    intrinsicValue: intrinsic,
    premiumPct,
    message: `Risk Alert: trading ${premiumPct.toFixed(1)}% above intrinsic ($${intrinsic.toFixed(2)})`,
  };
}

function runCrl(args: {
  rsi: number | null; ema8: number | null; spot: number | null;
  winningStreak: number; delta: number | null; theta: number | null;
  iv: number | null; dte: number | null; isLong: boolean; isCall: boolean;
  intrinsicValue?: number | null;
  unrealizedPnl?: number | null;
  // Strategic Validation Layer inputs
  sma200?: number | null;
  ivPercentile?: number | null;
  beforeOpeningRange?: boolean;
  entryPremium?: number | null;
  currentPremium?: number | null;
}): CrlOutput {
  const {
    rsi: r, ema8, spot, winningStreak, delta, theta, iv, dte, isLong, isCall,
    intrinsicValue, unrealizedPnl,
    sma200, ivPercentile, beforeOpeningRange: opening, entryPremium, currentPremium,
  } = args;
  const emaDistancePct = ema8 != null && spot != null && ema8 > 0 ? ((spot - ema8) / ema8) * 100 : null;
  const highMomentum = winningStreak >= 3;
  const riskBadge = classifyRisk(delta, theta, iv, r);
  const flags: string[] = [];
  if (highMomentum) flags.push("High momentum (3+ day streak)");

  // Risk Alert (orthogonal — fires even on Safe calls)
  const valuationAlert = computeValuationAlert(spot, intrinsicValue ?? null);
  if (valuationAlert.triggered && valuationAlert.message) flags.push(valuationAlert.message);

  // High Premium / IV Percentile flag (orthogonal)
  const highPremium = ivPercentile != null && ivPercentile > HIGH_PREMIUM_IVP;
  if (highPremium) flags.push(`High Premium (IVP ${ivPercentile}% > ${HIGH_PREMIUM_IVP})`);

  // Trend Gate — long-term support broken (only matters for CALL suggestions)
  const trendGateBroken = isCall && spot != null && sma200 != null && spot < sma200;

  // Premium hard stop — for open longs only
  let premiumStopTriggered = false;
  let premiumDropPct: number | null = null;
  if (isLong && entryPremium != null && entryPremium > 0 && currentPremium != null) {
    premiumDropPct = ((currentPremium - entryPremium) / entryPremium) * 100;
    if (premiumDropPct <= -PREMIUM_STOP_PCT) premiumStopTriggered = true;
  }

  let stopLoss = false;
  if (isLong && spot != null && ema8 != null) {
    if (isCall && spot < ema8) stopLoss = true;
    if (!isCall && spot > ema8) stopLoss = true;
  }

  const make = (verdict: CrlVerdict, reason: string, sl = stopLoss): CrlOutput => ({
    verdict, reason, riskBadge, stopLossTriggered: sl, emaDistancePct, highMomentum, flags, valuationAlert,
    trendGateBroken, highPremium, openingRange: !!opening, premiumStopTriggered,
  });

  // ── Hard Stop-Loss (overrides EMA / everything else for open longs) ──
  if (premiumStopTriggered) {
    flags.push(`Hard stop −${Math.abs(premiumDropPct!).toFixed(0)}% premium`);
    return make(
      "EXIT",
      `Premium dropped ${premiumDropPct!.toFixed(0)}% from entry $${entryPremium!.toFixed(2)} → $${currentPremium!.toFixed(2)}. Hard stop hit — sell at loss now.`,
      true,
    );
  }

  // ── Trend Gate — block CALL suggestions when price is below 200-SMA ──
  if (trendGateBroken) {
    flags.push("Trend Gate: below 200-SMA");
    return make(
      "NO",
      `Price $${spot!.toFixed(2)} is below 200-SMA $${sma200!.toFixed(2)} — long-term trend is broken. No calls until support reclaims.`,
    );
  }

  // Trap a — Early Exit on losing trade with steep theta + tiny DTE
  if (
    unrealizedPnl != null && unrealizedPnl < 0 &&
    theta != null && theta < -0.5 &&
    dte != null && dte < 2
  ) {
    flags.push("Sell at loss (losing + theta bleed + ≤2 DTE)");
    return make(
      "EXIT",
      `Losing trade with theta ${theta.toFixed(2)} and only ${dte}d left — paying $${Math.abs(theta * 100).toFixed(0)}/contract/day to hope. Cut now, don't ride to zero.`,
      true,
    );
  }

  // Trap b — Mathematical Trap (DTE < 5 AND theta < -0.50)
  if (theta != null && dte != null && theta < -0.5 && dte < 5) {
    flags.push("Mathematical trap (time decay)");
    return make("NO", `Theta ${theta.toFixed(2)} with only ${dte}d to expiry — premium melts faster than any move can recover.`);
  }

  // Trap c — EMA Overshoot (spot > 8-EMA × 1.15)
  if (emaDistancePct != null && emaDistancePct > EMA_OVERSHOOT_PCT) {
    flags.push(`EMA overshoot (+${emaDistancePct.toFixed(1)}% vs 8-EMA)`);
    return make(
      "NO",
      `Price is ${emaDistancePct.toFixed(1)}% above 8-EMA $${ema8?.toFixed(2)} — too stretched. NO-GO until it retouches the EMA.`,
    );
  }

  // Trap d — Technical Overextension (RSI > 70)
  if (r != null && r > 70) {
    flags.push("Overextended (RSI > 70)");
    const dist = emaDistancePct != null ? ` and ${emaDistancePct.toFixed(1)}% vs 8-EMA` : "";
    return make("WAIT", `RSI ${r.toFixed(0)}${dist} — chasing the peak. Wait for a pullback.`);
  }

  // Trap e — Stop-loss EXIT (broke 8-EMA)
  if (stopLoss) {
    flags.push("Broke 8-EMA — sell at loss");
    return make("EXIT", `Price ${spot?.toFixed(2)} broke ${isCall ? "below" : "above"} 8-EMA ${ema8?.toFixed(2)} — discipline says cut now, don't wait for expiration.`, true);
  }

  // Helper to apply opening-range filter to GO signals.
  const applyOpening = (out: CrlOutput): CrlOutput => {
    if (out.verdict !== "GO" || !opening) return out;
    out.flags.push("Opening Range Testing (before 10:30 AM ET)");
    return { ...out, verdict: "WAIT", reason: `Opening Range Testing — first hour is noisy, wait for 10:30 AM ET to confirm ${out.reason}` };
  };

  if (highMomentum && r != null && r >= 40 && r <= 60) {
    flags.push("Fresh breakout (RSI 40-60)");
    return applyOpening(make("GO", `3+ day streak with RSI ${r.toFixed(0)} — fresh momentum, not exhausted.`, false));
  }
  if (highMomentum && r != null && r > 60) {
    return make("WAIT", `Momentum is up but RSI ${r.toFixed(0)} is hot — wait for a cooldown.`);
  }
  if (!highMomentum && r != null && r < 40) {
    return make("WAIT", `Weak streak and RSI ${r.toFixed(0)} — no edge here, sit it out.`);
  }
  return make("NEUTRAL", "No conflict — but no clean GO signal either.");
}

// Match a position to its real option contract from a chain.
function matchContract(chain: OptionContract[], strike: number, expiry: string, isCall: boolean): OptionContract | null {
  const wanted = chain.filter((c) =>
    c.expiration === expiry &&
    (isCall ? c.type === "call" : c.type === "put")
  );
  if (!wanted.length) return null;
  return wanted.reduce((best, c) =>
    Math.abs(c.strike - strike) < Math.abs(best.strike - strike) ? c : best
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = await req.json();
    const positions: InPosition[] = body?.positions ?? [];
    if (!positions.length) {
      return new Response(JSON.stringify({ verdicts: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const symbols = [...new Set(positions.map((p) => p.symbol.toUpperCase()))];

    // ── Fetch quotes, daily history (≥220d for SMA200), option chains in parallel ──
    const opening = beforeOpeningRange();
    const [quotesResp, histResp, ...chainResps] = await Promise.all([
      fetchJson<{ quotes: Quote[] }>("quotes-fetch", { symbols }),
      fetchJson<{ histories: History[] }>("quotes-history", { symbols, lookbackDays: 220 }),
      ...symbols.map((s) => fetchJson<{ contracts: OptionContract[] }>("options-fetch", { underlying: s, limit: 250 })),
    ]);
    const quotes = quotesResp?.quotes ?? [];
    const qMap = new Map(quotes.map((q) => [q.symbol, q]));
    const hMap = new Map((histResp?.histories ?? []).map((h) => [h.symbol, h.closes]));
    const cMap = new Map<string, OptionContract[]>();
    chainResps.forEach((c, i) => cMap.set(symbols[i], c?.contracts ?? []));

    // ── Enrich + run CRL per position ──
    const enriched = positions.map((p) => {
      const sym = p.symbol.toUpperCase();
      const q = qMap.get(sym);
      const dte = daysTo(p.expiry);
      const spot = q?.price ?? null;
      const isCall = p.optionType.includes("call");
      const closes = hMap.get(sym) ?? [];
      const ema8 = ema(closes, 8);
      const sma200 = sma(closes, 200);
      const rsi14 = rsi(closes, 14);
      const winningStreak = streak(closes);
      const realizedVol = realizedVolAnnualized(closes, 30);
      const contract = matchContract(cMap.get(sym) ?? [], Number(p.strike), p.expiry, isCall);
      const ivPercentile = ivPercentileEstimate(contract?.iv ?? null, realizedVol);
      // Estimate unrealized $ P&L using contract mid if available, else intrinsic.
      let unrealizedPnl: number | null = null;
      if (p.entryPremium != null && contract?.mid != null) {
        const sign = p.direction === "long" ? 1 : -1;
        unrealizedPnl = sign * (Number(contract.mid) - Number(p.entryPremium)) * (p.contracts ?? 1) * 100;
      } else if (p.entryPremium != null && spot != null) {
        const intrinsic = isCall
          ? Math.max(0, spot - Number(p.strike))
          : Math.max(0, Number(p.strike) - spot);
        const sign = p.direction === "long" ? 1 : -1;
        unrealizedPnl = sign * (intrinsic - Number(p.entryPremium)) * (p.contracts ?? 1) * 100;
      }
      const crl = runCrl({
        rsi: rsi14, ema8, spot, winningStreak,
        delta: contract?.delta ?? null,
        theta: contract?.theta ?? null,
        iv: contract?.iv ?? null,
        dte, isLong: p.direction === "long", isCall,
        unrealizedPnl,
        sma200,
        ivPercentile,
        beforeOpeningRange: opening,
        entryPremium: p.entryPremium ?? null,
        currentPremium: contract?.mid ?? null,
      });
      return {
        ...p, spot, dte, ema8, sma200, rsi14, winningStreak,
        delta: contract?.delta ?? null,
        theta: contract?.theta ?? null,
        iv: contract?.iv ?? null,
        ivPercentile,
        currentMid: contract?.mid ?? null,
        unrealizedPnl,
        crl,
        dayChangePct: q?.changePct ?? null,
      };
    });

    // ── Ask Nova for a plain-English verdict, fed with the CRL conclusion ──
    const systemPrompt = `You are Nova, a brutally honest options coach. For each position you receive a deterministic Conflict Resolution Layer ("crl") result with verdict (GO/WAIT/NO/EXIT/NEUTRAL), reason, risk badge, and flags. Your job is to produce a 1-2 sentence verdict that respects the CRL — never contradict it. Speak like a friend at the bar. No disclaimers.`;
    const userPrompt = `Open positions with live data + Conflict Resolution Layer output:\n${JSON.stringify(enriched, null, 2)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "score_positions",
            description: "Return one verdict per position id, consistent with crl.verdict.",
            parameters: {
              type: "object",
              properties: {
                verdicts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      status: { type: "string", enum: ["winning", "bleeding", "in trouble", "expiring worthless", "running fine", "neutral"] },
                      verdict: { type: "string" },
                      action: { type: "string", enum: ["hold", "take_profit", "cut", "roll", "let_expire"] },
                    },
                    required: ["id", "status", "verdict", "action"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["verdicts"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "score_positions" } },
      }),
    });

    let novaVerdicts: Array<{ id: string; status: string; verdict: string; action: string }> = [];
    if (aiResp.ok) {
      const aiJson = await aiResp.json();
      const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try { novaVerdicts = JSON.parse(toolCall.function.arguments).verdicts ?? []; }
        catch (e) { console.error("[portfolio-verdict] parse failed", e); }
      }
    } else if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit on AI gateway." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      console.warn("[portfolio-verdict] AI gateway", aiResp.status);
    }

    // ── Merge Nova text with CRL output ──
    const novaMap = new Map(novaVerdicts.map((v) => [v.id, v]));
    const verdicts = enriched.map((p) => {
      const nova = novaMap.get(p.id);
      return {
        id: p.id,
        // Nova's narrative
        status: nova?.status ?? "neutral",
        verdict: nova?.verdict ?? p.crl.reason,
        action: nova?.action ?? (p.crl.verdict === "EXIT" ? "cut" : p.crl.verdict === "GO" ? "hold" : "hold"),
        // CRL deterministic layer
        crl: {
          verdict: p.crl.verdict,
          reason: p.crl.reason,
          riskBadge: p.crl.riskBadge,
          stopLossTriggered: p.crl.stopLossTriggered,
          highMomentum: p.crl.highMomentum,
          emaDistancePct: p.crl.emaDistancePct,
          flags: p.crl.flags,
        },
        // Raw inputs (so UI can show "RSI 76 · 8-EMA 410.50")
        metrics: {
          rsi14: p.rsi14, ema8: p.ema8, winningStreak: p.winningStreak,
          delta: p.delta, theta: p.theta, iv: p.iv, dte: p.dte, currentMid: p.currentMid,
        },
      };
    });

    return new Response(
      JSON.stringify({ verdicts, quotes, fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("portfolio-verdict error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
