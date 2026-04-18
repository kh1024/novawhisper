// Conflict Resolution Layer (CRL)
// Pure logic — given technicals + Greeks, returns GO / WAIT / NO + reasoning,
// risk badge, and stop-loss flag. Used by both Portfolio (real Greeks via
// options-fetch) and Scanner (estimated until row expanded).
//
// Rules (verbatim from product spec):
//   1. Momentum Check  — 3+ day winning streak ⇒ "High Momentum".
//   2. Trap Filters
//      - RSI > 70  AND  |distance from 8-EMA| > 5%  ⇒ WAIT (Technical Overextension)
//      - Theta < -0.50  AND  DTE < 4               ⇒ NO   (Time Decay Trap)
//   3. GO Signal      — High momentum AND RSI ∈ [40,60] (fresh breakout).
//   4. Stop-loss      — price breaks below 8-EMA on a long ⇒ SELL AT LOSS.
//
// Risk badge (orthogonal to verdict):
//   - Safe       — ITM (|delta| ≥ 0.65) AND |theta| < 0.30
//   - Aggressive — OTM (|delta| < 0.35) OR  IV ≥ 0.60 (60%)
//   - Mild       — everything else (near-the-money)

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
  isCall: boolean;                     // for stop-loss direction
}

export interface CrlOutput {
  verdict: CrlVerdict;
  reason: string;                      // one-liner explaining the call
  highMomentum: boolean;
  emaDistancePct: number | null;       // (spot - ema8) / ema8 * 100
  riskBadge: RiskBadge | null;
  stopLossTriggered: boolean;          // long & price broke below 8-EMA
  flags: string[];                     // bullet flags for UI ("Overextended", "Time decay trap"...)
}

export function runConflictResolution(input: CrlInputs): CrlOutput {
  const { rsi, ema8, spot, winningStreakDays, delta, theta, iv, dte, isLong, isCall } = input;

  const emaDistancePct =
    ema8 != null && spot != null && ema8 > 0 ? ((spot - ema8) / ema8) * 100 : null;
  const highMomentum = (winningStreakDays ?? 0) >= 3;
  const flags: string[] = [];
  if (highMomentum) flags.push("High momentum (3+ day streak)");

  // ── Stop-loss check (long calls only — bearish stop is symmetric for puts) ──
  let stopLossTriggered = false;
  if (isLong && spot != null && ema8 != null) {
    if (isCall && spot < ema8) stopLossTriggered = true;
    if (!isCall && spot > ema8) stopLossTriggered = true; // long put, price above 8-EMA
  }

  // ── Trap filter 1: Time Decay Trap ──
  if (theta != null && dte != null && theta < -0.5 && dte < 4) {
    flags.push("Time decay trap");
    return {
      verdict: "NO",
      reason: `Theta ${theta.toFixed(2)} with only ${dte}d to expiry — premium melts faster than any move can recover.`,
      highMomentum,
      emaDistancePct,
      riskBadge: classifyRisk({ delta, theta, iv }),
      stopLossTriggered,
      flags,
    };
  }

  // ── Trap filter 2: Technical Overextension ──
  if (rsi != null && rsi > 70 && emaDistancePct != null && Math.abs(emaDistancePct) > 5) {
    flags.push("Overextended (RSI > 70, > 5% from 8-EMA)");
    return {
      verdict: "WAIT",
      reason: `RSI ${rsi.toFixed(0)} and ${emaDistancePct.toFixed(1)}% above 8-EMA — pullback risk outweighs the trend. Wait for a 10:30 AM support test.`,
      highMomentum,
      emaDistancePct,
      riskBadge: classifyRisk({ delta, theta, iv }),
      stopLossTriggered,
      flags,
    };
  }

  // ── Stop-loss EXIT (long position broke key level) ──
  if (stopLossTriggered) {
    flags.push("Broke 8-EMA — sell at loss");
    return {
      verdict: "EXIT",
      reason: `Price ${spot?.toFixed(2)} broke below 8-EMA ${ema8?.toFixed(2)} — discipline says cut now, don't wait for expiration.`,
      highMomentum,
      emaDistancePct,
      riskBadge: classifyRisk({ delta, theta, iv }),
      stopLossTriggered: true,
      flags,
    };
  }

  // ── GO Signal: high momentum + fresh RSI ──
  if (highMomentum && rsi != null && rsi >= 40 && rsi <= 60) {
    flags.push("Fresh breakout (RSI 40-60)");
    return {
      verdict: "GO",
      reason: `3+ day streak with RSI ${rsi.toFixed(0)} — fresh momentum, not exhausted. Clean entry.`,
      highMomentum,
      emaDistancePct,
      riskBadge: classifyRisk({ delta, theta, iv }),
      stopLossTriggered: false,
      flags,
    };
  }

  // ── Default: NEUTRAL with the most useful reason we can give ──
  let reason = "No conflict — but no clean GO signal either.";
  if (highMomentum && rsi != null && rsi > 60) {
    reason = `Momentum is up but RSI ${rsi.toFixed(0)} is hot — wait for a cooldown before chasing.`;
    flags.push("Momentum hot but RSI extended");
    return { verdict: "WAIT", reason, highMomentum, emaDistancePct, riskBadge: classifyRisk({ delta, theta, iv }), stopLossTriggered, flags };
  }
  if (!highMomentum && rsi != null && rsi < 40) {
    reason = `Weak streak and RSI ${rsi.toFixed(0)} — no edge here, sit it out.`;
    return { verdict: "WAIT", reason, highMomentum, emaDistancePct, riskBadge: classifyRisk({ delta, theta, iv }), stopLossTriggered, flags };
  }

  return {
    verdict: "NEUTRAL",
    reason,
    highMomentum,
    emaDistancePct,
    riskBadge: classifyRisk({ delta, theta, iv }),
    stopLossTriggered,
    flags,
  };
}

function classifyRisk({
  delta, theta, iv,
}: { delta: number | null; theta: number | null; iv: number | null }): RiskBadge | null {
  if (delta == null && theta == null && iv == null) return null;
  const aDelta = delta != null ? Math.abs(delta) : null;
  const aTheta = theta != null ? Math.abs(theta) : null;
  // Aggressive — far OTM or expensive IV
  if ((aDelta != null && aDelta < 0.35) || (iv != null && iv >= 0.6)) return "Aggressive";
  // Safe — ITM with modest theta
  if (aDelta != null && aDelta >= 0.65 && (aTheta == null || aTheta < 0.3)) return "Safe";
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
