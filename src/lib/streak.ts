// Shared helper — compute the current consecutive-green-day streak from a
// daily-close array. Used by Gate 4 (Exhaustion Filter) and the Conflict
// Resolution Layer. Counts back from the most recent close until it hits a
// red day (close <= prev close).
export function computeStreakDays(closes: number[]): number {
  if (!Array.isArray(closes) || closes.length < 2) return 0;
  const tail = closes.slice(-10);
  let count = 0;
  for (let i = tail.length - 1; i >= 1; i--) {
    if (tail[i] > tail[i - 1]) count++;
    else break;
  }
  return count;
}

/**
 * Wilder-style RSI(14) computed from a tail of daily closes. Pure +
 * deterministic — given the same closes array it always returns the same
 * value. Returns 50 (neutral) when there isn't enough history.
 */
export function computeRSI14(closes: number[]): number {
  if (!Array.isArray(closes) || closes.length < 15) return 50;
  const tail = closes.slice(-15);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < tail.length; i++) {
    const diff = tail[i] - tail[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.round(Math.max(0, Math.min(100, rsi)));
}
