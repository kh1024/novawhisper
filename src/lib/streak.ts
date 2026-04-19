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
