// ============================================================================
// NOVA GUARDS — institutional-grade safety rails applied to every pick/position.
// Pure functions, no React, easy to unit-test and reuse across pages.
//
// 1. Stale Quote Guard   — pick.playAt vs live price diverges > $1 → STALE DATA
// 2. Intrinsic Audit     — "Safe" call w/ strike > spot → High-Risk Speculation
// 3. 200-day SMA Gate    — long calls blocked when spot < SMA200
// 4. Capital Guard 30%   — open long position lost ≥30% of premium → SELL AT LOSS
//
// The shouldBlockSignal flag tells the UI to suppress GO/Buy CTAs.
// ============================================================================

export type GuardSeverity = "info" | "warning" | "danger";

export interface GuardFlag {
  id: "stale" | "intrinsic" | "trend200" | "capital30";
  label: string;            // chip label
  severity: GuardSeverity;
  message: string;          // tooltip / explanation
  blocksSignal: boolean;    // if true, picks should not show GO / Buy
}

export interface GuardEvalInput {
  symbol: string;
  /** The price the pick was originated at (playAt / entry / cached). */
  pickPrice?: number | null;
  /** Live price right now from quotes-fetch. */
  livePrice?: number | null;
  /** "safe" | "mild" | "aggressive" — only safe gets the intrinsic audit. */
  riskBucket?: "safe" | "mild" | "moderate" | "aggressive" | "swing" | string | null;
  /** Long call / put / spread etc. — used to decide if SMA gate applies. */
  optionType?: string | null;
  direction?: "long" | "short" | null;
  strike?: number | null;
  /** 200-day SMA from history hook (null when unknown — gate is skipped). */
  sma200?: number | null;
  /** Open position P&L for capital guard. */
  position?: {
    entryPremium?: number | null;
    currentPremium?: number | null;          // mark, if known
    estimatedUnrealized?: number | null;     // $ P&L (intrinsic-based ok)
    contracts?: number;
    direction?: "long" | "short";
  } | null;
}

export interface GuardEval {
  flags: GuardFlag[];
  shouldBlockSignal: boolean;
  /** Highest-severity flag, useful for a single overall badge. */
  worst: GuardFlag | null;
}

export const STALE_PRICE_USD = 1.0;
export const CAPITAL_STOP_PCT = 30;     // alert when -30% of entry premium

const SEV_RANK: Record<GuardSeverity, number> = { info: 1, warning: 2, danger: 3 };

function isCallish(opt?: string | null): boolean {
  if (!opt) return false;
  const o = opt.toLowerCase();
  return o.includes("call") && !o.includes("put");
}
function isPutish(opt?: string | null): boolean {
  if (!opt) return false;
  return opt.toLowerCase().includes("put");
}

export function evaluateGuards(i: GuardEvalInput): GuardEval {
  const flags: GuardFlag[] = [];

  // 1. Stale Quote Guard — diff > $1 between pick origination price & live.
  if (i.pickPrice != null && i.livePrice != null && Number.isFinite(i.pickPrice) && Number.isFinite(i.livePrice)) {
    const diff = Math.abs(i.livePrice - i.pickPrice);
    if (diff > STALE_PRICE_USD) {
      flags.push({
        id: "stale",
        label: "STALE DATA",
        severity: "danger",
        message: `Pick was generated at $${i.pickPrice.toFixed(2)} but live is $${i.livePrice.toFixed(2)} (Δ $${diff.toFixed(2)}). Trade signal blocked until refreshed.`,
        blocksSignal: true,
      });
    }
  }

  // 2. Intrinsic Audit — a "safe" call whose strike > spot is OTM speculation, not intrinsic-backed.
  const bucket = (i.riskBucket ?? "").toLowerCase();
  if (
    bucket === "safe" &&
    isCallish(i.optionType) &&
    i.direction !== "short" &&
    i.strike != null &&
    i.livePrice != null &&
    i.strike > i.livePrice
  ) {
    flags.push({
      id: "intrinsic",
      label: "High-Risk Speculation",
      severity: "warning",
      message: `"Safe" calls must be ITM. Strike $${i.strike} is above spot $${i.livePrice.toFixed(2)} — this is OTM speculation, not intrinsic-backed exposure.`,
      blocksSignal: true,
    });
  }

  // 3. 200-day SMA Gate — long calls below the 200-SMA are fighting the long-term trend.
  if (
    i.sma200 != null && i.livePrice != null &&
    isCallish(i.optionType) &&
    i.direction !== "short" &&
    i.livePrice < i.sma200
  ) {
    const distPct = ((i.livePrice - i.sma200) / i.sma200) * 100;
    flags.push({
      id: "trend200",
      label: "Below 200-SMA",
      severity: "danger",
      message: `Spot $${i.livePrice.toFixed(2)} is ${distPct.toFixed(1)}% below 200-day SMA $${i.sma200.toFixed(2)}. Long-term trend is broken — no GO on calls.`,
      blocksSignal: true,
    });
  }

  // 4. Capital Guard — long position down ≥30% of entry premium → SELL AT LOSS.
  const pos = i.position;
  if (pos && pos.direction === "long" && pos.entryPremium != null && pos.entryPremium > 0) {
    let lossPct: number | null = null;
    if (pos.currentPremium != null) {
      lossPct = ((pos.currentPremium - pos.entryPremium) / pos.entryPremium) * 100;
    } else if (pos.estimatedUnrealized != null) {
      const cost = pos.entryPremium * (pos.contracts ?? 1) * 100;
      if (cost > 0) lossPct = (pos.estimatedUnrealized / cost) * 100;
    }
    if (lossPct != null && lossPct <= -CAPITAL_STOP_PCT) {
      flags.push({
        id: "capital30",
        label: "SELL AT LOSS −30%",
        severity: "danger",
        message: `Premium is ${lossPct.toFixed(0)}% below entry. Capital Guard says cut now to preserve buying power.`,
        blocksSignal: true,
      });
    }
  }

  const worst = flags.length === 0
    ? null
    : flags.reduce((a, b) => (SEV_RANK[b.severity] > SEV_RANK[a.severity] ? b : a));

  return {
    flags,
    shouldBlockSignal: flags.some((f) => f.blocksSignal),
    worst,
  };
}

/** Style tokens for guard badges — use semantic theme tokens. */
export const GUARD_STYLE: Record<GuardSeverity, string> = {
  info:    "bg-muted/40 text-muted-foreground border-border",
  warning: "bg-warning/15 text-warning border-warning/40",
  danger:  "bg-bearish/20 text-bearish border-bearish/50",
};
