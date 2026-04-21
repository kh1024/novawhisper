// Community Signal Engine v2 — backtested r/options strategies.
//
// All four strategies are ADVISORY OVERLAYS. They never override the 7-gate
// validation pipeline; they appear as additional context chips on the pick
// card. The waterfall in generateOptionsSignal() picks the highest-confidence
// strategy that fits the inputs and returns it as a typed result.

// ── Configs ────────────────────────────────────────────────────────────────
export const STRATEGY_CONFIGS = {
  spxPutSpread: {
    name: "SPX 1DTE Short Put Spread",
    source: "reddit.com/r/options/comments/1hupq5g",
    winRate: 0.91,
    entryTime: "09:45",
    dte: 1,
    spreadWidth: 10,
    longPutOffset: -60,
    shortPutOffset: -50,
    maxIvRank: 20,
    minGapPct: -0.004,
    profitTargetPct: 0.30,
    stopLossPct: 0.55,
  },
  vixRegime: {
    name: "VIX 3-Zone Regime Switch",
    source: "reddit.com/r/options/comments/1rby5ea",
    zones: {
      low:  { max: 19,            strategy: "DOUBLE_DIAGONAL", legs: "1DTE short / 3DTE long" },
      mid:  { min: 19, max: 25,   strategy: "IRON_CONDOR",     delta: 0.20 },
      high: { min: 25,            strategy: "NO_TRADE",        reason: "Tail risk too high" },
    },
  },
  spyIronCondor: {
    name: "SPY Iron Condor Scale-In (4DTE)",
    source: "reddit.com/r/options/comments/1rgiezk",
    dte: 4,
    afternoonVariantDte: 2,
    strikeWidths: { SPY: 12, QQQ: 16, IWM: 7 } as Record<"SPY" | "QQQ" | "IWM", number>,
    scaleInWindows: [
      { window: 1, startHour: 10, endHour: 11, contracts: 5 },
      { window: 2, startHour: 12, endHour: 13, contracts: 5 },
      { window: 3, startHour: 14, endHour: 14, contracts: 5 },
    ],
    maxDailyContracts: 15,
    deltaRange: { min: 0.02, stable: 0.06, calm: 0.10 },
    afternoonCutoffHour: 13,
    holdDays: 2,
    afternoonVariantExpectedPnl: 0.40,
  },
  holdToExpiry: {
    name: "Hold-to-Expiry Override",
    source: "reddit.com/r/options/comments/1r0hoqa",
    shortVolRule: "HOLD_TO_EXPIRY",
    longVolRule: "PROFIT_TARGET",
    tailDayRule: "AVOID",
    deltaPreference: "LOWER_OTM",
  },
} as const;

// ── ET helpers ─────────────────────────────────────────────────────────────
function currentTimeToET(date: Date): number {
  const etStr = date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = etStr.split(":").map(Number);
  return h + m / 60;
}

// ── Public types ───────────────────────────────────────────────────────────
export type SignalStrategy =
  | "SPX_PUT_SPREAD_1DTE"
  | "VIX_REGIME_IC"
  | "VIX_REGIME_DIAGONAL"
  | "ADX_MFI"
  | "THETA"
  | "ORB"
  | "NONE";

export interface OptionsSignal {
  strategy: SignalStrategy;
  score: number;
  confidence: number;
  signal: unknown;
  rationale: string;
}

export interface SpxPutSpreadResult {
  eligible: boolean;
  score: number;
  spread: { longStrike: number; shortStrike: number } | null;
  hardBlocked: boolean;
  blockReason: string | null;
  rationale: string;
}

export interface VixRegimeResult {
  zone: "LOW" | "MID" | "HIGH";
  strategy: "DOUBLE_DIAGONAL" | "IRON_CONDOR" | "NO_TRADE";
  deltaTarget: number | null;
  legDescription: string;
  rationale: string;
}

export interface SpyIcResult {
  eligible: boolean;
  score: number;
  scaleInWindow: 1 | 2 | 3 | null;
  strikes: {
    callShort: number; callLong: number;
    putShort: number;  putLong: number;
  } | null;
  dte: number;
  useAfternoonVariant: boolean;
  rationale: string;
}

export interface ExitModeResult {
  mode: "HOLD_TO_EXPIRY" | "PROFIT_TARGET" | "STOP_LOSS" | "TIME_STOP";
  profitTargetPct: number | null;
  stopLossPct: number | null;
  rationale: string;
}

// ── 1. SPX 1DTE Short Put Spread ──────────────────────────────────────────
export function scoreSpxPutSpread(params: {
  ivRank: number;
  gapPct: number;
  currentTime: Date;
  underlyingPrice: number;
  /** Optional override: max IV rank threshold (default 20). */
  maxIvRankOverride?: number;
  /** Optional override: enable/disable gap filter (default true). */
  gapFilterEnabled?: boolean;
}): SpxPutSpreadResult {
  const cfg = STRATEGY_CONFIGS.spxPutSpread;
  const maxIvRank = params.maxIvRankOverride ?? cfg.maxIvRank;
  const gapEnabled = params.gapFilterEnabled !== false;
  const etHour = currentTimeToET(params.currentTime);

  if (params.ivRank > maxIvRank) {
    return {
      eligible: false, score: 0, spread: null, hardBlocked: true,
      blockReason: `IV Rank ${params.ivRank.toFixed(0)} exceeds max ${maxIvRank} — hard block (91% WR filter)`,
      rationale: "IV Rank hard block active. Strategy WR depends critically on IV Rank ≤ threshold.",
    };
  }
  if (gapEnabled && params.gapPct < cfg.minGapPct) {
    return {
      eligible: false, score: 20, spread: null, hardBlocked: false,
      blockReason: `Open gap ${(params.gapPct * 100).toFixed(2)}% below -0.4% threshold`,
      rationale: "Excessive downside gap — short put spread risk/reward unfavorable.",
    };
  }
  const [entryH, entryM] = cfg.entryTime.split(":").map(Number);
  const etMinutes = etHour * 60;
  const entryMinutes = entryH * 60 + entryM;
  if (etMinutes < entryMinutes) {
    return {
      eligible: false, score: 0, spread: null, hardBlocked: false,
      blockReason: "Before 9:45 AM ET entry window",
      rationale: "Entry time not yet reached. Strategy enters at 9:45 AM ET only.",
    };
  }

  const shortStrike = Math.round(params.underlyingPrice + cfg.shortPutOffset);
  const longStrike = Math.round(params.underlyingPrice + cfg.longPutOffset);
  const ivPenalty = (params.ivRank / maxIvRank) * 15;
  const score = Math.round(91 - ivPenalty);

  return {
    eligible: true, score, spread: { longStrike, shortStrike },
    hardBlocked: false, blockReason: null,
    rationale:
      `SPX 1DTE Put Spread eligible. IV Rank ${params.ivRank.toFixed(0)}/${maxIvRank}, ` +
      `gap ${(params.gapPct * 100).toFixed(2)}%. Strikes: Long ${longStrike}P / Short ${shortStrike}P. ` +
      `Exit at +30% / -55%. Source: 91% WR backtest r/options.`,
  };
}

// ── 2. VIX Regime Classifier ──────────────────────────────────────────────
export function classifyVixRegime(
  absoluteVix: number,
  opts: { lowMidBoundary?: number; midHighBoundary?: number } = {},
): VixRegimeResult {
  const lowMid = opts.lowMidBoundary ?? STRATEGY_CONFIGS.vixRegime.zones.low.max;
  const midHigh = opts.midHighBoundary ?? STRATEGY_CONFIGS.vixRegime.zones.mid.max;

  if (absoluteVix < lowMid) {
    return {
      zone: "LOW",
      strategy: "DOUBLE_DIAGONAL",
      deltaTarget: null,
      legDescription: "1DTE short leg / 3DTE long leg",
      rationale:
        `VIX ${absoluteVix.toFixed(1)} < ${lowMid} → Double Diagonal. ` +
        `Low-vol regime favours short-date spread income.`,
    };
  }
  if (absoluteVix <= midHigh) {
    return {
      zone: "MID",
      strategy: "IRON_CONDOR",
      deltaTarget: 0.20,
      legDescription: "SPX Iron Condor at 0.20 delta",
      rationale:
        `VIX ${absoluteVix.toFixed(1)} in ${lowMid}–${midHigh} → Iron Condor at 0.20 delta. ` +
        `Historical: VIX < ${midHigh} filter delivered +103% return on put-selling strategies.`,
    };
  }
  return {
    zone: "HIGH",
    strategy: "NO_TRADE",
    deltaTarget: null,
    legDescription: "No position — tail risk unacceptable",
    rationale:
      `VIX ${absoluteVix.toFixed(1)} > ${midHigh} → NO TRADE. ` +
      `Backtests show selling puts without VIX > ${midHigh} filter cost ~50% of capital. Hard stop.`,
  };
}

// ── 3. SPY/QQQ/IWM Iron Condor Scale-In ───────────────────────────────────
export function scoreSPYIronCondor(params: {
  ticker: "SPY" | "QQQ" | "IWM";
  currentTime: Date;
  underlyingPrice: number;
  vix: number;
  isEventDay: boolean;
  /** Optional toggles — when explicitly set to false the corresponding window
   *  is treated as disabled and the scorer returns ineligible inside it. */
  windowEnabled?: { 1: boolean; 2: boolean; 3: boolean };
  /** Override midHigh VIX boundary (default 25). */
  vixMidHighBoundary?: number;
}): SpyIcResult {
  const cfg = STRATEGY_CONFIGS.spyIronCondor;
  const vixMax = params.vixMidHighBoundary ?? 25;

  if (params.isEventDay) {
    return {
      eligible: false, score: 0, scaleInWindow: null, strikes: null, dte: 0, useAfternoonVariant: false,
      rationale: "Event day (FOMC/CPI/NFP/extended weekend) — skip per strategy rules.",
    };
  }
  if (params.vix > vixMax) {
    return {
      eligible: false, score: 0, scaleInWindow: null, strikes: null, dte: 0, useAfternoonVariant: false,
      rationale: `VIX > ${vixMax} — VIX regime override blocks all IC entries.`,
    };
  }

  const etHour = currentTimeToET(params.currentTime);
  const strikeWidth = cfg.strikeWidths[params.ticker] ?? cfg.strikeWidths.SPY;
  const useAfternoonVariant = etHour >= cfg.afternoonCutoffHour;
  const dte = useAfternoonVariant ? cfg.afternoonVariantDte : cfg.dte;

  let scaleInWindow: 1 | 2 | 3 | null = null;
  for (const win of cfg.scaleInWindows) {
    if (etHour >= win.startHour && etHour < win.endHour + 1) {
      scaleInWindow = win.window as 1 | 2 | 3;
      break;
    }
  }
  if (scaleInWindow === null) {
    return {
      eligible: false, score: 0, scaleInWindow: null, strikes: null, dte, useAfternoonVariant,
      rationale: `Outside scale-in windows (10–11 AM, 12–1 PM, 2 PM ET). Current ET: ${etHour.toFixed(1)}h.`,
    };
  }
  if (params.windowEnabled && params.windowEnabled[scaleInWindow] === false) {
    return {
      eligible: false, score: 0, scaleInWindow, strikes: null, dte, useAfternoonVariant,
      rationale: `Scale-in window ${scaleInWindow}/3 disabled in user strategy profile.`,
    };
  }

  const halfWidth = strikeWidth / 2;
  const otmOffset = Math.round(params.underlyingPrice * 0.008); // ~0.06 delta proxy
  const callShort = Math.round(params.underlyingPrice + otmOffset);
  const callLong = callShort + halfWidth;
  const putShort = Math.round(params.underlyingPrice - otmOffset);
  const putLong = putShort - halfWidth;

  const score = useAfternoonVariant ? 75 : 70;

  return {
    eligible: true, score, scaleInWindow,
    strikes: { callShort, callLong, putShort, putLong },
    dte, useAfternoonVariant,
    rationale:
      `${params.ticker} IC eligible. Window ${scaleInWindow}/3, ` +
      `${dte}DTE, ${useAfternoonVariant ? "afternoon variant (+40% by AM expected)" : "standard 4DTE"}. ` +
      `Strike width: $${strikeWidth}. Scale-in: 5 contracts this window, max 15/day.`,
  };
}

// ── 4. Exit Mode Selector ─────────────────────────────────────────────────
export function selectExitMode(params: {
  isShortVol: boolean;
  isLongVol: boolean;
  dte: number;
  currentPnlPct: number;
  isNearTailDay: boolean;
  /** When false, the tail-day override is disabled (user opted out). */
  tailDayAvoidanceEnabled?: boolean;
}): ExitModeResult {
  const tailGuard = params.tailDayAvoidanceEnabled !== false;

  if (tailGuard && params.isNearTailDay && params.isShortVol) {
    return {
      mode: "TIME_STOP",
      profitTargetPct: null,
      stopLossPct: null,
      rationale:
        "Tail day detected (FOMC/NFP/CPI). Exiting short vol position early to avoid catastrophic " +
        "tail event. This is non-negotiable per backtest research.",
    };
  }
  if (params.isLongVol) {
    return {
      mode: "PROFIT_TARGET",
      profitTargetPct: 0.50,
      stopLossPct: 0.30,
      rationale:
        "Long vol position — use profit targets per hold-to-expiry research. Early exit preserves " +
        "gains on directional moves.",
    };
  }
  if (params.isShortVol) {
    return {
      mode: "HOLD_TO_EXPIRY",
      profitTargetPct: null,
      stopLossPct: 2.00,
      rationale:
        "Short vol position on non-tail day — hold to expiry. Backtests show early exits reduce " +
        "profitability on theta/IC strategies. Stop at 200% of credit received for catastrophic protection.",
    };
  }
  return {
    mode: "PROFIT_TARGET",
    profitTargetPct: 0.50,
    stopLossPct: 1.00,
    rationale: "Default exit mode — profit target at 50%, stop at 100%.",
  };
}

// ── Confidence ranking (highest WR first) ─────────────────────────────────
export const STRATEGY_RANK: Record<SignalStrategy, number> = {
  SPX_PUT_SPREAD_1DTE: 91,
  VIX_REGIME_IC: 72,
  ADX_MFI: 65,
  THETA: 60,
  ORB: 41,
  VIX_REGIME_DIAGONAL: 35,
  NONE: 0,
};

// ── Top-level waterfall ───────────────────────────────────────────────────
/**
 * Lightweight orchestrator: returns the highest-WR signal that fits.
 * Existing scanner logic remains the authoritative pick source — this layer
 * is purely advisory and used to label cards.
 */
export function generateOptionsSignal(params: {
  ticker: string;
  ivRank: number;
  gapPct?: number;
  currentTime?: Date;
  underlyingPrice: number;
  vix?: number;
  /** Strategy profile overrides. */
  spxIvRankMax?: number;
  spxGapFilterEnabled?: boolean;
  vixLowMidBoundary?: number;
  vixMidHighBoundary?: number;
}): OptionsSignal {
  const t = params.ticker.toUpperCase();
  const now = params.currentTime ?? new Date();

  if (t === "SPX" || t === "SPXW") {
    const r = scoreSpxPutSpread({
      ivRank: params.ivRank,
      gapPct: params.gapPct ?? 0,
      currentTime: now,
      underlyingPrice: params.underlyingPrice,
      maxIvRankOverride: params.spxIvRankMax,
      gapFilterEnabled: params.spxGapFilterEnabled,
    });
    if (r.eligible) {
      return {
        strategy: "SPX_PUT_SPREAD_1DTE",
        score: r.score,
        confidence: r.score / 100,
        signal: r,
        rationale: r.rationale,
      };
    }
  }

  const vix = params.vix ?? 15;
  const regime = classifyVixRegime(vix, {
    lowMidBoundary: params.vixLowMidBoundary,
    midHighBoundary: params.vixMidHighBoundary,
  });
  if (regime.strategy === "IRON_CONDOR") {
    return {
      strategy: "VIX_REGIME_IC",
      score: 72,
      confidence: 0.72,
      signal: regime,
      rationale: regime.rationale,
    };
  }
  if (regime.strategy === "DOUBLE_DIAGONAL") {
    return {
      strategy: "VIX_REGIME_DIAGONAL",
      score: 65,
      confidence: 0.65,
      signal: regime,
      rationale: regime.rationale,
    };
  }

  return {
    strategy: "NONE",
    score: 0,
    confidence: 0,
    signal: regime,
    rationale: regime.rationale,
  };
}
