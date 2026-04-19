// ============================================================================
// NOVA BRAIN — shared institutional-grade reasoning core.
// Used by:
//   • Scanner (setupScore.ts)        → adjust verdicts by regime + time-state
//   • Options Scout (edge fn)        → time-aware system prompt, A-D grading
//   • Portfolio Verdict / Planning   → consistent regime + grade language
//
// Philosophy: NOVA must NOT analyze markets the same way at all times.
// Behavior shifts with day, time, and market session. We infer regime from
// the data we already have (index quotes + news) — no new APIs.
// ============================================================================

export type TimeState =
  | "weekend"
  | "holiday"
  | "premarket"
  | "openingHour"
  | "midday"
  | "powerHour"
  | "afterHours"
  | "closed";

export type MarketRegime = "bull" | "bear" | "sideways" | "panic" | "meltup";

export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface TimeContext {
  state: TimeState;
  label: string;            // "Power Hour", "Pre-Market", etc
  bestStrategy: string;     // one sentence
  avoid: string;            // one sentence
  isFriday: boolean;
  isMonday: boolean;
  isMonthEnd: boolean;
  /** Nova should down-weight intraday momentum after this much closed time. */
  staleHours: number;
}

export interface RegimeContext {
  regime: MarketRegime;
  confidence: number;       // 0-100 — how sure we are
  description: string;      // one sentence summary
  preferredStrategies: string[];
  avoidStrategies: string[];
}

// ─── Time-state detection (US/Eastern) ─────────────────────────────────────
// We use Intl rather than hard-coding offsets so DST behaves correctly.
function nyParts(now = new Date()): { hour: number; minute: number; weekday: number; date: number } {
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

export function detectTimeState(now = new Date()): TimeContext {
  const { hour, minute, weekday, date } = nyParts(now);
  const mins = hour * 60 + minute;

  let state: TimeState;
  let label: string;
  let bestStrategy: string;
  let avoid: string;
  let staleHours = 0;

  if (weekday === 0 || weekday === 6) {
    state = "weekend";
    label = "Weekend";
    bestStrategy = "Build Monday watchlists, gap-up/down candidates, and hedge ideas. Treat Friday momentum as stale.";
    avoid = "Avoid intraday momentum trades — wait for futures + Monday open.";
    staleHours = weekday === 0 ? 60 : 36;
  } else if (mins < 4 * 60) {
    state = "closed";
    label = "Overnight";
    bestStrategy = "Watch futures and overnight news. Stage orders, do not chase.";
    avoid = "No live intraday signals — momentum is stale.";
    staleHours = 12;
  } else if (mins < 9 * 60 + 30) {
    state = "premarket";
    label = "Pre-Market";
    bestStrategy = "Focus on overnight news, earnings reactions, premarket movers, and gap continuation candidates.";
    avoid = "Avoid full-size positioning — wait for opening-range confirmation.";
  } else if (mins < 10 * 60 + 30) {
    state = "openingHour";
    label = "Opening Hour";
    bestStrategy = "Demand volume confirmation. Favor opening-range breakouts and gap fills with institutional flow.";
    avoid = "Avoid stale overnight signals and unconfirmed breakouts (fakeouts common).";
  } else if (mins < 14 * 60) {
    state = "midday";
    label = "Midday Chop";
    bestStrategy = "Theta trades, scaling entries, and watchlist prep. Volume is thin — be patient.";
    avoid = "Avoid chasing breakouts — midday moves often reverse.";
  } else if (mins < 16 * 60) {
    state = "powerHour";
    label = "Power Hour";
    bestStrategy = "Watch closing strength, end-of-day breakouts, and institutional positioning for tomorrow.";
    avoid = "Avoid late-day lottery options — gamma risk into close.";
  } else if (mins < 20 * 60) {
    state = "afterHours";
    label = "After-Hours";
    bestStrategy = "Focus on earnings reactions and news releases. Stage tomorrow's setups.";
    avoid = "Avoid trading thin AH liquidity unless catalyst is clean.";
  } else {
    state = "closed";
    label = "Closed";
    bestStrategy = "Plan tomorrow. Review today's tape and unusual flow.";
    avoid = "No live execution — momentum signals are stale.";
    staleHours = 8;
  }

  return {
    state, label, bestStrategy, avoid,
    isFriday: weekday === 5,
    isMonday: weekday === 1,
    isMonthEnd: date >= 28,   // approximation; rebalancing window
    staleHours,
  };
}

// ─── Regime inference ──────────────────────────────────────────────────────
// Light-weight regime classifier. Caller passes whatever index quotes it has;
// we infer from changePct + breadth. Not perfect — Nova refines from articles.
export interface RegimeInput {
  spyChangePct?: number | null;
  qqqChangePct?: number | null;
  iwmChangePct?: number | null;
  diaChangePct?: number | null;
  /** Optional VIX level if available. */
  vix?: number | null;
  /** Optional fraction of universe up on day, 0..1. */
  breadth?: number | null;
}

export function inferRegime(input: RegimeInput): RegimeContext {
  const changes = [input.spyChangePct, input.qqqChangePct, input.iwmChangePct, input.diaChangePct]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (changes.length === 0) {
    return {
      regime: "sideways",
      confidence: 30,
      description: "Insufficient index data — defaulting to neutral regime.",
      preferredStrategies: ["theta selling", "credit spreads", "iron condors"],
      avoidStrategies: ["naked long premium without catalyst"],
    };
  }

  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  const allUp = changes.every((c) => c > 0);
  const allDown = changes.every((c) => c < 0);
  const vix = input.vix ?? null;
  const breadth = input.breadth ?? null;

  // Panic: VIX spike > 28 OR avg < -2.5%
  if ((vix != null && vix > 28) || avg < -2.5) {
    return {
      regime: "panic",
      confidence: 85,
      description: `Risk-off — indexes ${avg.toFixed(2)}% on average${vix ? `, VIX ${vix.toFixed(1)}` : ""}.`,
      preferredStrategies: ["puts", "put spreads", "VIX calls", "cash"],
      avoidStrategies: ["long calls", "naked puts", "bullish spreads"],
    };
  }

  // Melt-up: avg > 1.5% with breadth > 0.7
  if (avg > 1.5 && (breadth == null || breadth > 0.65)) {
    return {
      regime: "meltup",
      confidence: 80,
      description: `Broad rally — indexes ${avg.toFixed(2)}% on average.`,
      preferredStrategies: ["long calls", "bull call spreads", "LEAPS calls", "covered calls on extended names"],
      avoidStrategies: ["fading strength", "naked puts on weak names"],
    };
  }

  if (allUp && avg > 0.5) {
    return {
      regime: "bull",
      confidence: 70,
      description: `Bullish trend — all major indexes green, avg ${avg.toFixed(2)}%.`,
      preferredStrategies: ["long calls", "bull call spreads", "LEAPS calls", "cash-secured puts on dips"],
      avoidStrategies: ["aggressive shorts", "long puts without catalyst"],
    };
  }

  if (allDown && avg < -0.5) {
    return {
      regime: "bear",
      confidence: 70,
      description: `Bearish trend — all major indexes red, avg ${avg.toFixed(2)}%.`,
      preferredStrategies: ["puts", "put spreads", "inverse ETFs", "hedges"],
      avoidStrategies: ["dip-buying without confirmation", "naked puts on weak names"],
    };
  }

  return {
    regime: "sideways",
    confidence: 60,
    description: `Mixed tape — indexes ${avg.toFixed(2)}% on average, no clean direction.`,
    preferredStrategies: ["covered calls", "cash-secured puts", "iron condors", "credit spreads"],
    avoidStrategies: ["long premium without catalyst", "directional swing trades"],
  };
}

// ─── Confidence grading ────────────────────────────────────────────────────
// 90+ → A, 75-89 → B, 60-74 → C, < 60 → D
export function scoreToGrade(score: number): ConfidenceGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

export const GRADE_META: Record<ConfidenceGrade, { label: string; cls: string; description: string }> = {
  A: { label: "A", cls: "bg-bullish/20 text-bullish border-bullish/40",   description: "High conviction · 90+ score" },
  B: { label: "B", cls: "bg-primary/15 text-primary border-primary/40",   description: "Solid setup · 75-89 score" },
  C: { label: "C", cls: "bg-warning/15 text-warning border-warning/40",   description: "Marginal · 60-74 score" },
  D: { label: "D", cls: "bg-bearish/15 text-bearish border-bearish/40",   description: "Sub-threshold · below 60" },
};

// ─── Regime-aware setup adjustment ─────────────────────────────────────────
// Nudges a raw setup score based on regime fit + time state.
// Used by the scanner so the same chart flips behavior in different regimes.
export interface RegimeAdjustInput {
  rawScore: number;
  bias: "bullish" | "bearish" | "neutral" | "reversal";
  ivRank: number;
  timeState: TimeState;
  regime: MarketRegime;
}

export function adjustForRegime(i: RegimeAdjustInput): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = i.rawScore;

  // Regime fit
  if (i.regime === "bull" || i.regime === "meltup") {
    if (i.bias === "bullish") { score += 5; notes.push("Bias matches bullish regime."); }
    if (i.bias === "bearish") { score -= 8; notes.push("Bearish bias fights the regime."); }
  } else if (i.regime === "bear" || i.regime === "panic") {
    if (i.bias === "bearish") { score += 5; notes.push("Bias matches bearish regime."); }
    if (i.bias === "bullish") { score -= 10; notes.push("Bullish bias fights the regime."); }
  } else if (i.regime === "sideways") {
    if (i.bias === "neutral") { score += 4; notes.push("Range-bound regime favors neutral structures."); }
    if (i.ivRank > 60) { score += 3; notes.push("Elevated IV in chop — premium-selling edge."); }
  }

  // Time-state nudges
  if (i.timeState === "openingHour" && i.rawScore >= 65) {
    notes.push("Opening hour — demand volume confirmation before entry.");
  }
  if (i.timeState === "midday") {
    score -= 3; notes.push("Midday chop — directional edges fade.");
  }
  if (i.timeState === "powerHour" && i.bias !== "neutral") {
    score += 2; notes.push("Power hour — institutional positioning supports directional setups.");
  }
  if (i.timeState === "weekend" || i.timeState === "closed") {
    score -= 5; notes.push("Market closed — verdict is staged, not actionable.");
  }
  if (i.timeState === "afterHours" || i.timeState === "premarket") {
    notes.push("Extended hours — confirm at the open.");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), notes };
}
