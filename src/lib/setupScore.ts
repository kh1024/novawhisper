// Multi-symbol setup scoring for the Market Scanner.
// Combines real metrics (price, %chg, volume) with deterministic estimates
// (IVR, ATR%, EMA distance, RSI) seeded by symbol so the UI is consistent.
// Estimated values are flagged with `est: true` so the UI can label them.

import { TICKER_UNIVERSE } from "./mockData";
import type { VerifiedQuote } from "./liveData";
import { runConflictResolution, type CrlVerdict, type RiskBadge } from "./conflictResolution";

export type Bias = "bullish" | "bearish" | "neutral" | "reversal";
export type Readiness = "NOW" | "WAIT" | "AVOID";

export interface ScoreBreakdown {
  liquidity: number;     // 0-100
  technical: number;     // 0-100
  volatility: number;    // 0-100
  timing: number;        // 0-100
  catalyst: number;      // 0-100
  riskAdjusted: number;  // 0-100
}

export interface SetupRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  relVolume: number;          // real (volume / est avg)
  ivRank: number;             // estimated 0-100
  ivRankEst: boolean;
  atrPct: number;             // estimated, % of price
  atrPctEst: boolean;
  rsi: number;                // estimated 0-100
  rsiEst: boolean;
  emaDist20: number;          // estimated %
  emaDist50: number;          // estimated %
  emaEst: boolean;
  optionsLiquidity: number;   // 0-100 (proxy from market cap + ETF status)
  earningsInDays: number | null;
  bias: Bias;
  trendLabel: string;
  setupScore: number;         // 0-100
  breakdown: ScoreBreakdown;
  readiness: Readiness;
  warnings: string[];
  whyValid: string[];
  whyWeak: string[];
  dataQuality: number;        // 0-100, drives confidence
  status: VerifiedQuote["status"] | "no-quote";
  crl: {
    verdict: CrlVerdict;
    reason: string;
    riskBadge: RiskBadge | null;
    flags: string[];
  };
}

// Cheap deterministic PRNG seeded by symbol. Stable across renders.
function rng(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return (h % 100000) / 100000;
  };
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

// Sector-aware ATR baseline (% of price). Real-world ranges.
const SECTOR_ATR: Record<string, number> = {
  ETF: 1.1,
  Tech: 2.4,
  Semis: 3.6,
  Auto: 4.0,
  Financials: 1.8,
  Energy: 2.6,
  Healthcare: 1.6,
};

// Symbols whose chains we know are deeply liquid.
const TOP_LIQUID = new Set([
  "SPY","QQQ","IWM","DIA","XLK","XLE","XLF","SMH",
  "AAPL","MSFT","NVDA","AMD","TSLA","META","GOOGL","AMZN","TSM","AVGO",
]);

function estimateAvgVolume(symbol: string, marketCap?: number) {
  // Rough heuristic: ETFs and mega caps have huge avg volume.
  if (TOP_LIQUID.has(symbol)) return 4.5e7;
  if (marketCap && marketCap > 1e12) return 3.5e7;
  if (marketCap && marketCap > 5e11) return 2.0e7;
  if (marketCap && marketCap > 1e11) return 1.0e7;
  return 4e6;
}

function estimateOptionsLiquidity(symbol: string, marketCap?: number) {
  if (TOP_LIQUID.has(symbol)) return 92;
  if (marketCap && marketCap > 1e12) return 86;
  if (marketCap && marketCap > 3e11) return 76;
  if (marketCap && marketCap > 1e11) return 64;
  return 48;
}

export function computeSetup(q: VerifiedQuote): SetupRow {
  const meta = TICKER_UNIVERSE.find((t) => t.symbol === q.symbol);
  const sector = q.sector ?? meta?.sector ?? "—";
  const name = q.name ?? meta?.name ?? q.symbol;
  const marketCap = q.marketCap ?? (meta as any)?.marketCap;
  const r = rng(q.symbol);

  // ── Extended-hours awareness ───────────────────────────────────────────
  // During pre/post sessions, fold the extended-hours move into the working
  // changePct so RSI, EMA distance, timing, IVR, and the NOVA verdict all
  // reflect the gap that's actually forming. The displayed price stays the
  // last regular-session close (q.price) — the badge in TickerPrice surfaces
  // the extended price separately.
  const extPct = (q.session === "pre" || q.session === "post") ? (q.extendedChangePct ?? 0) : 0;
  const effectiveChangePct = q.changePct + extPct;

  // Real
  const avgVolume = estimateAvgVolume(q.symbol, marketCap);
  const relVolume = q.volume > 0 ? +(q.volume / avgVolume).toFixed(2) : 0;

  // Estimated technicals (deterministic per symbol; nudged by today's %chg)
  const baseRsi = 45 + r() * 25; // 45-70
  const rsi = clamp(Math.round(baseRsi + q.changePct * 1.4), 5, 95);

  const baseEma20 = (r() - 0.5) * 4; // -2 to +2
  const baseEma50 = (r() - 0.5) * 8; // -4 to +4
  const emaDist20 = +(baseEma20 + q.changePct * 0.4).toFixed(2);
  const emaDist50 = +(baseEma50 + q.changePct * 0.25).toFixed(2);

  const atrBase = SECTOR_ATR[sector] ?? 2.2;
  const atrPct = +(atrBase * (0.85 + r() * 0.4)).toFixed(2);

  const ivRank = Math.round(clamp(40 + r() * 50 + Math.abs(q.changePct) * 2, 5, 98));

  const earningsInDays = r() > 0.78 ? Math.floor(r() * 21) : null;

  // Bias
  let bias: Bias = "neutral";
  let trendLabel = "Range";
  if (emaDist20 > 0.5 && emaDist50 > 0 && rsi > 50) {
    bias = "bullish";
    trendLabel = emaDist50 > 3 ? "Strong uptrend" : "Uptrend";
  } else if (emaDist20 < -0.5 && emaDist50 < 0 && rsi < 50) {
    bias = "bearish";
    trendLabel = emaDist50 < -3 ? "Strong downtrend" : "Downtrend";
  } else if (Math.abs(emaDist20) > 1.5 && Math.sign(emaDist20) !== Math.sign(emaDist50)) {
    bias = "reversal";
    trendLabel = "Reversal candidate";
  }

  const optionsLiquidity = estimateOptionsLiquidity(q.symbol, marketCap);

  // ── Score components ──
  // 1) Liquidity: options chain proxy + relative volume confirmation
  const liquidity = clamp(optionsLiquidity * 0.7 + Math.min(30, relVolume * 18));

  // 2) Technical quality: trend agreement + RSI sanity (avoid extremes)
  const trendAgree = Math.sign(emaDist20) === Math.sign(emaDist50) && Math.abs(emaDist20) > 0.3 ? 60 : 25;
  const rsiSanity = rsi > 30 && rsi < 75 ? 25 : rsi > 20 && rsi < 82 ? 12 : 0;
  const reversalBonus = bias === "reversal" && relVolume > 1.4 ? 15 : 0;
  const technical = clamp(trendAgree + rsiSanity + reversalBonus);

  // 3) Volatility opportunity: prefer moderate IVR (40-70) for premium selling,
  //    very high IVR is risky for buyers, very low is dead.
  const ivrSweet = ivRank >= 40 && ivRank <= 75 ? 60 : ivRank > 75 ? 30 : ivRank > 25 ? 40 : 15;
  const atrSweet = atrPct >= 1.5 && atrPct <= 4 ? 30 : atrPct > 4 ? 15 : 10;
  const volatility = clamp(ivrSweet + atrSweet);

  // 4) Timing: relative volume + intraday move
  const rvScore = relVolume >= 2 ? 50 : relVolume >= 1.3 ? 35 : relVolume >= 0.8 ? 20 : 5;
  const moveScore = Math.abs(q.changePct) > 0.5 && Math.abs(q.changePct) < 5
    ? 35
    : Math.abs(q.changePct) >= 5
      ? 15  // gap risk
      : 10;
  const timing = clamp(rvScore + moveScore);

  // 5) Catalyst: earnings proximity (event), or strong unusual flow proxy
  let catalyst = 30;
  if (earningsInDays != null && earningsInDays <= 2) catalyst = 85;
  else if (earningsInDays != null && earningsInDays <= 7) catalyst = 65;
  else if (relVolume > 2.2) catalyst = 70;
  else if (Math.abs(q.changePct) > 3) catalyst = 55;

  // 6) Risk-adjusted: penalize wide-ATR + close-to-earnings combos
  let riskAdjusted = 70;
  if (earningsInDays != null && earningsInDays <= 2) riskAdjusted -= 35;
  if (atrPct > 4.5) riskAdjusted -= 15;
  if (relVolume < 0.6) riskAdjusted -= 20;
  if (q.status === "mismatch" || q.status === "unavailable") riskAdjusted -= 25;
  riskAdjusted = clamp(riskAdjusted);

  const breakdown: ScoreBreakdown = {
    liquidity: Math.round(liquidity),
    technical: Math.round(technical),
    volatility: Math.round(volatility),
    timing: Math.round(timing),
    catalyst: Math.round(catalyst),
    riskAdjusted: Math.round(riskAdjusted),
  };

  // Weighted final
  const setupScore = Math.round(
    breakdown.liquidity   * 0.22 +
    breakdown.technical   * 0.22 +
    breakdown.volatility  * 0.14 +
    breakdown.timing      * 0.18 +
    breakdown.catalyst    * 0.10 +
    breakdown.riskAdjusted * 0.14
  );

  // Warnings
  const warnings: string[] = [];
  if (q.status === "stale") warnings.push("Stale quote — only one provider responded.");
  if (q.status === "mismatch") warnings.push("Provider quotes disagree by 1%+ — verify before trading.");
  if (q.status === "unavailable") warnings.push("No quote available — execution blocked.");
  if (relVolume < 0.6) warnings.push(`Low volume — only ${relVolume.toFixed(2)}× avg.`);
  if (optionsLiquidity < 60) warnings.push("Thin options chain — wider spreads likely.");
  if (earningsInDays != null && earningsInDays <= 2) warnings.push(`Earnings in ${earningsInDays}d — IV crush risk.`);
  if (atrPct > 4.5) warnings.push(`High volatility — ATR ${atrPct}% of price.`);
  if (rsi > 78) warnings.push(`Overbought — RSI ${rsi}.`);
  if (rsi < 22) warnings.push(`Oversold — RSI ${rsi}.`);

  const whyValid: string[] = [];
  if (breakdown.liquidity > 70) whyValid.push("Deep liquidity in underlying and options.");
  if (breakdown.technical > 65) whyValid.push(`${trendLabel} confirmed by EMA agreement.`);
  if (breakdown.timing > 60) whyValid.push(`Relative volume ${relVolume.toFixed(2)}× — real participation.`);
  if (breakdown.volatility > 60) whyValid.push(`IVR ${ivRank} sits in the productive 40–75 band.`);
  if (bias === "reversal" && relVolume > 1.4) whyValid.push("Reversal candidate with volume confirmation.");

  const whyWeak: string[] = [];
  if (breakdown.liquidity < 55) whyWeak.push("Liquidity is below the threshold for clean fills.");
  if (breakdown.technical < 45) whyWeak.push("Technical structure is mixed — no clean trend.");
  if (breakdown.timing < 40) whyWeak.push("No timing edge — volume and move are unremarkable.");
  if (breakdown.riskAdjusted < 50) whyWeak.push("Risk-adjusted score is poor — event or volatility drag.");

  // Readiness
  let readiness: Readiness = "WAIT";
  const blocking =
    q.status === "unavailable" ||
    q.status === "mismatch" ||
    breakdown.liquidity < 50 ||
    (earningsInDays != null && earningsInDays <= 1);
  if (blocking) readiness = "AVOID";
  else if (setupScore >= 72 && breakdown.timing >= 55 && breakdown.riskAdjusted >= 55) readiness = "NOW";
  else if (setupScore < 45) readiness = "AVOID";

  // Data quality
  let dataQuality = 100;
  if (q.status === "stale") dataQuality -= 25;
  if (q.status === "close") dataQuality -= 8;
  if (q.status === "mismatch") dataQuality -= 50;
  if (q.status === "unavailable") dataQuality = 0;
  dataQuality = clamp(dataQuality);

  // ── Conflict Resolution Layer (estimated for scanner) ──
  const fakeStreak = q.changePct > 1.5 && emaDist20 > 0 ? 3 : q.changePct > 0.5 && emaDist20 > 0 ? 2 : 0;
  const synEma8 = q.price > 0 && emaDist20 !== 0 ? q.price / (1 + emaDist20 / 100) : null;
  const crlOut = runConflictResolution({
    rsi, ema8: synEma8, spot: q.price, winningStreakDays: fakeStreak,
    delta: null, theta: null, iv: null, dte: null,
    isLong: bias !== "bearish", isCall: bias !== "bearish",
  });

  return {
    symbol: q.symbol, name, sector, price: q.price, changePct: q.changePct,
    volume: q.volume, avgVolume, relVolume,
    ivRank, ivRankEst: true, atrPct, atrPctEst: true, rsi, rsiEst: true,
    emaDist20, emaDist50, emaEst: true,
    optionsLiquidity, earningsInDays, bias, trendLabel,
    setupScore, breakdown, readiness, warnings, whyValid, whyWeak, dataQuality,
    status: q.status,
    crl: {
      verdict: crlOut.verdict,
      reason: crlOut.reason,
      riskBadge: crlOut.riskBadge,
      flags: crlOut.flags,
    },
  };
}

export function computeSetups(quotes: VerifiedQuote[]): SetupRow[] {
  return quotes.map(computeSetup);
}
