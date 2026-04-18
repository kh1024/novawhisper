// Conflict Resolution Layer (CRL)
// Pure logic — given technicals + Greeks (+ optional fundamental anchor),
// returns GO / WAIT / NO + reasoning, risk badge, stop-loss flag, and an
// orthogonal "Risk Alert" badge for valuation overshoots.
//
// Expert Audit rules (current product spec):
//   1. Risk classification (deterministic from Greeks + RSI)
//      - Safe       — |Δ| > 0.80 AND |Θ| < 0.15 AND RSI < 60   (deep ITM, stock-replacement)
//      - Mild       — near-ATM (|Δ| 0.40–0.60), |Θ| 0.20–0.40, RSI 60–70
//      - Aggressive — |Δ| < 0.35 OR |Θ| > 0.50 OR RSI > 70 OR IV ≥ 0.60
//   2. Trap filters (override verdict, evaluated in order)
//      a. Early Exit (losing trade)  — open position AND unrealizedPnl < 0
//                                       AND theta < -0.50 AND DTE < 2  ⇒ EXIT (sell at loss)
//      b. Mathematical Trap          — DTE < 5 AND theta < -0.50       ⇒ NO
//      c. EMA Overshoot              — spot > 8-EMA × 1.15              ⇒ NO-GO until EMA retouch
//      d. Technical Overextension    — RSI > 70                         ⇒ WAIT (no chasing the peak)
//      e. Stop-loss                  — long & price breaks 8-EMA        ⇒ EXIT
//   3. GO Signal — High momentum (3+ up-days) AND RSI ∈ [40, 60].
//   4. Risk Alert (orthogonal — fires on top of any verdict including Safe):
//        spot > intrinsicValue × 1.15  ⇒ flag "Overvalued vs intrinsic"

export type CrlVerdict = "GO" | "WAIT" | "NO" | "EXIT" | "NEUTRAL";
export type RiskBadge = "Safe" | "Mild" | "Aggressive";

export interface CrlInputs {
  // Technicals
  rsi: number | null;                  // 0-100, RSI(14)
  ema8: number | null;                 // current 8-day EMA value
  spot: number | null;                 // current price
  winningStreakDays: number | null;    // consecutive up-days (close > prev close)
  // Greeks (optional — only known after options-fetch)
  delta: number | null;
  theta: number | null;
  iv: number | null;                   // 0-1 (e.g. 0.45 = 45%)
  dte: number | null;                  // days to expiry
  // Position direction
  isLong: boolean;
  isCall: boolean;
  // Optional context for live positions only
  unrealizedPnl?: number | null;       // dollars; negative = losing — used for early-exit rule
  intrinsicValue?: number | null;      // analyst / model fair-value estimate
}

export interface CrlOutput {
  verdict: CrlVerdict;
  reason: string;
  highMomentum: boolean;
  emaDistancePct: number | null;       // (spot - ema8) / ema8 * 100
  riskBadge: RiskBadge | null;
  stopLossTriggered: boolean;
  flags: string[];
  valuationAlert: {
    triggered: boolean;
    intrinsicValue: number | null;
    premiumPct: number | null;
    message: string | null;
  };
}

const VALUATION_OVERSHOOT_PCT = 15;   // spot > intrinsic × 1.15 ⇒ Risk Alert
const EMA_OVERSHOOT_PCT = 15;         // spot > 8-EMA × 1.15 ⇒ NO-GO

export function runConflictResolution(input: CrlInputs): CrlOutput {
  const {
    rsi, ema8, spot, winningStreakDays,
    delta, theta, iv, dte,
    isLong, isCall,
    intrinsicValue, unrealizedPnl,
  } = input;

  const emaDistancePct =
    ema8 != null && spot != null && ema8 > 0 ? ((spot - ema8) / ema8) * 100 : null;
  const highMomentum = (winningStreakDays ?? 0) >= 3;
  const flags: string[] = [];
  if (highMomentum) flags.push("High momentum (3+ day streak)");
  const riskBadge = classifyRisk({ delta, theta, iv, rsi });

  // Risk Alert (orthogonal — fires on top of any verdict)
  const valuationAlert = computeValuationAlert(spot, intrinsicValue ?? null);
  if (valuationAlert.triggered && valuationAlert.message) flags.push(valuationAlert.message);

  // Stop-loss check (long calls breaking down, long puts breaking up)
  let stopLossTriggered = false;
  if (isLong && spot != null && ema8 != null) {
    if (isCall && spot < ema8) stopLossTriggered = true;
    if (!isCall && spot > ema8) stopLossTriggered = true;
  }

  const build = (
    verdict: CrlVerdict,
    reason: string,
    overrides: Partial<Pick<CrlOutput, "stopLossTriggered">> = {},
  ): CrlOutput => ({
    verdict,
    reason,
    highMomentum,
    emaDistancePct,
    riskBadge,
    stopLossTriggered: overrides.stopLossTriggered ?? stopLossTriggered,
    flags,
    valuationAlert,
  });

  // ── Trap a: Early Exit on losing trade with steep theta + tiny DTE ──
  // "Don't marry a losing trade" — sell now for a 30% loss instead of 100% at expiry.
  if (
    unrealizedPnl != null && unrealizedPnl < 0 &&
    theta != null && theta < -0.5 &&
    dte != null && dte < 2
  ) {
    flags.push("Sell at loss (losing + theta bleed + ≤2 DTE)");
    return build(
      "EXIT",
      `Losing trade with theta ${theta.toFixed(2)} and only ${dte}d left — paying $${Math.abs(theta * 100).toFixed(0)}/contract/day to hope. Cut now, don't ride to zero.`,
      { stopLossTriggered: true },
    );
  }

  // ── Trap b: Mathematical Trap (DTE < 5 AND theta < -0.50) ──
  if (theta != null && dte != null && theta < -0.5 && dte < 5) {
    flags.push("Mathematical trap (time decay)");
    return build(
      "NO",
      `Theta ${theta.toFixed(2)} with only ${dte}d to expiry — premium melts faster than any move can recover.`,
    );
  }

  // ── Trap c: EMA Overshoot (spot > 8-EMA × 1.15) ──
  if (emaDistancePct != null && emaDistancePct > EMA_OVERSHOOT_PCT) {
    flags.push(`EMA overshoot (+${emaDistancePct.toFixed(1)}% vs 8-EMA)`);
    return build(
      "NO",
      `Price is ${emaDistancePct.toFixed(1)}% above 8-EMA $${ema8?.toFixed(2)} — too stretched. NO-GO until it retouches the EMA.`,
    );
  }

  // ── Trap d: Technical Overextension (RSI > 70) ──
  if (rsi != null && rsi > 70) {
    flags.push("Overextended (RSI > 70)");
    const dist = emaDistancePct != null ? ` and ${emaDistancePct.toFixed(1)}% vs 8-EMA` : "";
    return build(
      "WAIT",
      `RSI ${rsi.toFixed(0)}${dist} — chasing the peak. Wait for a pullback before entering.`,
    );
  }

  // ── Trap e: Stop-loss EXIT (long position broke key level) ──
  if (stopLossTriggered) {
    flags.push("Broke 8-EMA — sell at loss");
    return build(
      "EXIT",
      `Price ${spot?.toFixed(2)} broke ${isCall ? "below" : "above"} 8-EMA ${ema8?.toFixed(2)} — discipline says cut now, don't wait for expiration.`,
      { stopLossTriggered: true },
    );
  }

  // ── GO Signal ──
  if (highMomentum && rsi != null && rsi >= 40 && rsi <= 60) {
    flags.push("Fresh breakout (RSI 40-60)");
    return build(
      "GO",
      `3+ day streak with RSI ${rsi.toFixed(0)} — fresh momentum, not exhausted. Clean entry.`,
      { stopLossTriggered: false },
    );
  }

  // ── Defaults ──
  if (highMomentum && rsi != null && rsi > 60) {
    flags.push("Momentum hot but RSI extended");
    return build("WAIT", `Momentum is up but RSI ${rsi.toFixed(0)} is hot — wait for a cooldown before chasing.`);
  }
  if (!highMomentum && rsi != null && rsi < 40) {
    return build("WAIT", `Weak streak and RSI ${rsi.toFixed(0)} — no edge here, sit it out.`);
  }
  return build("NEUTRAL", "No conflict — but no clean GO signal either.");
}

function computeValuationAlert(spot: number | null, intrinsic: number | null): CrlOutput["valuationAlert"] {
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

// Expert risk classification — combines Greeks AND RSI.
// Safe       — deep ITM stock-replacement: |Δ|>0.80, |Θ|<0.15, RSI<60
// Aggressive — far OTM / hot IV / overbought: |Δ|<0.35 OR |Θ|>0.50 OR RSI>70 OR IV≥0.60
// Mild       — everything else (typically near-ATM with moderate Greeks).
function classifyRisk({
  delta, theta, iv, rsi,
}: {
  delta: number | null; theta: number | null; iv: number | null; rsi: number | null;
}): RiskBadge | null {
  if (delta == null && theta == null && iv == null && rsi == null) return null;
  const aDelta = delta != null ? Math.abs(delta) : null;
  const aTheta = theta != null ? Math.abs(theta) : null;

  // Aggressive — any single hot signal is enough.
  if (
    (aDelta != null && aDelta < 0.35) ||
    (aTheta != null && aTheta > 0.5) ||
    (iv != null && iv >= 0.6) ||
    (rsi != null && rsi > 70)
  ) return "Aggressive";

  // Safe — needs the full deep-ITM profile.
  if (
    aDelta != null && aDelta > 0.8 &&
    aTheta != null && aTheta < 0.15 &&
    (rsi == null || rsi < 60)
  ) return "Safe";

  return "Mild";
}

// Simple winning-streak helper (number of consecutive up-closes ending at last bar).
export function streakFromCloses(closes: number[]): number {
  let s = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i] > closes[i - 1]) s++;
    else break;
  }
  return s;
}

// 8-day EMA from a closes array (returns last EMA value, or null if too few bars).
export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

// Wilder's RSI(14) from closes. Returns last value, or null if too few bars.
export function rsi(closes: number[], period = 14): number | null {
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
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
