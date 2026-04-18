// Chart pattern + seasonality detection from daily closes.
// Pure functions — feed in `Bar[]` from quotes-history edge function.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Bar { date: string; close: number }

export interface SymbolHistory {
  symbol: string;
  closes: number[];
  bars: Bar[];
  source: string;
  error?: string;
}

export type PatternSeverity = "strong" | "medium" | "weak";

export interface DetectedPattern {
  symbol: string;
  pattern: string;
  description: string;
  severity: PatternSeverity;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number; // 0-100
  detectedAt: string; // last bar date
}

/* ──────────────── Indicators ──────────────── */

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

function streak(closes: number[]): number {
  let s = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] > closes[i - 1]) { if (s >= 0) s++; else break; }
    else if (closes[i] < closes[i - 1]) { if (s <= 0) s--; else break; }
    else break;
  }
  return s;
}

/* ──────────────── Pattern detectors ──────────────── */

function detectBreakout(symbol: string, bars: Bar[]): DetectedPattern | null {
  if (bars.length < 25) return null;
  const closes = bars.map((b) => b.close);
  const lookback = closes.slice(-21, -1); // last 20 excluding today
  const high20 = Math.max(...lookback);
  const low20 = Math.min(...lookback);
  const today = closes[closes.length - 1];
  const date = bars[bars.length - 1].date;
  if (today > high20 * 1.001) {
    const margin = ((today - high20) / high20) * 100;
    return {
      symbol, pattern: "20-Day Breakout", bias: "bullish",
      severity: margin > 2 ? "strong" : margin > 0.8 ? "medium" : "weak",
      description: `Closed at $${today.toFixed(2)}, above 20-day high $${high20.toFixed(2)} (+${margin.toFixed(2)}%)`,
      confidence: Math.min(95, 55 + margin * 8),
      detectedAt: date,
    };
  }
  if (today < low20 * 0.999) {
    const margin = ((low20 - today) / low20) * 100;
    return {
      symbol, pattern: "20-Day Breakdown", bias: "bearish",
      severity: margin > 2 ? "strong" : margin > 0.8 ? "medium" : "weak",
      description: `Closed at $${today.toFixed(2)}, below 20-day low $${low20.toFixed(2)} (-${margin.toFixed(2)}%)`,
      confidence: Math.min(95, 55 + margin * 8),
      detectedAt: date,
    };
  }
  return null;
}

function detectRsiExtreme(symbol: string, bars: Bar[]): DetectedPattern | null {
  const closes = bars.map((b) => b.close);
  const r = rsi(closes, 14);
  if (r == null) return null;
  const date = bars[bars.length - 1].date;
  if (r >= 75) {
    return {
      symbol, pattern: "Overbought (RSI)", bias: "bearish",
      severity: r >= 85 ? "strong" : "medium",
      description: `RSI(14) = ${r.toFixed(1)}. Statistically extended — pullback risk elevated.`,
      confidence: Math.min(90, 40 + (r - 70) * 3),
      detectedAt: date,
    };
  }
  if (r <= 25) {
    return {
      symbol, pattern: "Oversold (RSI)", bias: "bullish",
      severity: r <= 15 ? "strong" : "medium",
      description: `RSI(14) = ${r.toFixed(1)}. Mean-reversion bounce setup.`,
      confidence: Math.min(90, 40 + (30 - r) * 3),
      detectedAt: date,
    };
  }
  return null;
}

function detectStreak(symbol: string, bars: Bar[]): DetectedPattern | null {
  const closes = bars.map((b) => b.close);
  const s = streak(closes);
  if (Math.abs(s) < 5) return null;
  const date = bars[bars.length - 1].date;
  return {
    symbol, pattern: s > 0 ? "Win Streak" : "Loss Streak",
    bias: s > 0 ? "bullish" : "bearish",
    severity: Math.abs(s) >= 8 ? "strong" : Math.abs(s) >= 6 ? "medium" : "weak",
    description: `${Math.abs(s)} consecutive ${s > 0 ? "up" : "down"} days. Momentum is ${Math.abs(s) >= 7 ? "extended — fade risk." : "intact."}`,
    confidence: Math.min(85, 35 + Math.abs(s) * 6),
    detectedAt: date,
  };
}

function detectGoldenDeathCross(symbol: string, bars: Bar[]): DetectedPattern | null {
  const closes = bars.map((b) => b.close);
  if (closes.length < 55) return null;
  const today8 = ema(closes, 8);
  const today21 = ema(closes, 21);
  const yesterday8 = ema(closes.slice(0, -1), 8);
  const yesterday21 = ema(closes.slice(0, -1), 21);
  if (today8 == null || today21 == null || yesterday8 == null || yesterday21 == null) return null;
  const date = bars[bars.length - 1].date;
  if (yesterday8 <= yesterday21 && today8 > today21) {
    return {
      symbol, pattern: "8/21 Bullish Cross", bias: "bullish", severity: "medium",
      description: `Short-term EMA crossed above long-term — typical early trend signal.`,
      confidence: 65, detectedAt: date,
    };
  }
  if (yesterday8 >= yesterday21 && today8 < today21) {
    return {
      symbol, pattern: "8/21 Bearish Cross", bias: "bearish", severity: "medium",
      description: `Short-term EMA crossed below long-term — momentum rolling over.`,
      confidence: 65, detectedAt: date,
    };
  }
  return null;
}

function detectDoubleTopBottom(symbol: string, bars: Bar[]): DetectedPattern | null {
  if (bars.length < 30) return null;
  const closes = bars.map((b) => b.close);
  const window = closes.slice(-30);
  const max = Math.max(...window);
  const min = Math.min(...window);
  const date = bars[bars.length - 1].date;
  // count peaks within 1.5% of max
  const peaks = window.filter((v) => v >= max * 0.985).length;
  const troughs = window.filter((v) => v <= min * 1.015).length;
  if (peaks >= 2 && peaks <= 5 && closes[closes.length - 1] < max * 0.97) {
    return {
      symbol, pattern: "Double Top", bias: "bearish", severity: "medium",
      description: `Tested ~$${max.toFixed(2)} ${peaks} times in 30 days and rolled over.`,
      confidence: 60, detectedAt: date,
    };
  }
  if (troughs >= 2 && troughs <= 5 && closes[closes.length - 1] > min * 1.03) {
    return {
      symbol, pattern: "Double Bottom", bias: "bullish", severity: "medium",
      description: `Held ~$${min.toFixed(2)} ${troughs} times in 30 days and bounced.`,
      confidence: 60, detectedAt: date,
    };
  }
  return null;
}

export function detectPatterns(symbol: string, bars: Bar[]): DetectedPattern[] {
  if (!bars || bars.length < 22) return [];
  const out: DetectedPattern[] = [];
  const detectors = [detectBreakout, detectRsiExtreme, detectStreak, detectGoldenDeathCross, detectDoubleTopBottom];
  for (const fn of detectors) {
    const p = fn(symbol, bars);
    if (p) out.push(p);
  }
  return out;
}

/* ──────────────── Seasonality ──────────────── */

export interface SeasonalityStat {
  symbol: string;
  bucket: string;        // "Mondays", "First trading day of month", etc.
  hitRate: number;       // 0..1 = fraction up
  avgReturnPct: number;  // average daily return on those days
  sampleSize: number;
  bias: "bullish" | "bearish" | "neutral";
}

const DOW_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function dayReturns(bars: Bar[]): { date: Date; ret: number }[] {
  const out: { date: Date; ret: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
    out.push({ date: new Date(bars[i].date + "T00:00:00"), ret });
  }
  return out;
}

export function computeSeasonality(symbol: string, bars: Bar[]): SeasonalityStat[] {
  if (bars.length < 30) return [];
  const rets = dayReturns(bars);
  const byDow = new Map<number, number[]>();
  for (const r of rets) {
    const d = r.date.getDay();
    if (d === 0 || d === 6) continue; // skip weekends if any sneak in
    const arr = byDow.get(d) ?? [];
    arr.push(r.ret);
    byDow.set(d, arr);
  }
  const stats: SeasonalityStat[] = [];
  for (const [dow, arr] of byDow) {
    if (arr.length < 5) continue;
    const ups = arr.filter((x) => x > 0).length;
    const hitRate = ups / arr.length;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const bias: SeasonalityStat["bias"] =
      hitRate >= 0.6 || avg > 0.003 ? "bullish" :
      hitRate <= 0.4 || avg < -0.003 ? "bearish" : "neutral";
    stats.push({
      symbol, bucket: DOW_NAMES[dow], hitRate,
      avgReturnPct: avg * 100, sampleSize: arr.length, bias,
    });
  }
  // Month-of-year bias (only if we have enough data)
  const byMonth = new Map<number, number[]>();
  for (const r of rets) {
    const m = r.date.getMonth();
    const arr = byMonth.get(m) ?? [];
    arr.push(r.ret);
    byMonth.set(m, arr);
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (const [m, arr] of byMonth) {
    if (arr.length < 8) continue;
    const ups = arr.filter((x) => x > 0).length;
    const hitRate = ups / arr.length;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (Math.abs(hitRate - 0.5) < 0.12 && Math.abs(avg) < 0.003) continue;
    const bias: SeasonalityStat["bias"] =
      hitRate >= 0.58 || avg > 0.003 ? "bullish" :
      hitRate <= 0.42 || avg < -0.003 ? "bearish" : "neutral";
    stats.push({
      symbol, bucket: `Month: ${MONTHS[m]}`, hitRate,
      avgReturnPct: avg * 100, sampleSize: arr.length, bias,
    });
  }
  // Sort: most extreme first
  stats.sort((a, b) => Math.abs(b.hitRate - 0.5) - Math.abs(a.hitRate - 0.5));
  return stats.slice(0, 6);
}

/* ──────────────── Hook: fetch histories ──────────────── */

export function useHistories(symbols: string[], lookbackDays = 120) {
  const key = symbols.slice().sort().join(",");
  return useQuery({
    queryKey: ["pattern-histories", key, lookbackDays],
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async (): Promise<SymbolHistory[]> => {
      // Edge function caps at 25 symbols per call → batch.
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += 25) chunks.push(symbols.slice(i, i + 25));
      const all: SymbolHistory[] = [];
      for (const chunk of chunks) {
        const { data, error } = await supabase.functions.invoke("quotes-history", {
          body: { symbols: chunk, lookbackDays },
        });
        if (error) throw error;
        const histories = (data?.histories ?? []) as SymbolHistory[];
        all.push(...histories);
      }
      return all;
    },
  });
}
