// Per-instance token-bucket throttle for Massive API calls.
//
// IMPORTANT CAVEAT: Supabase edge functions run as multiple warm instances,
// each with its own module state. This bucket therefore caps Massive calls at
// ~75/s **per warm instance**, not globally. In practice that's enough to
// virtually eliminate 429s while staying well under the plan's 100/s ceiling
// even with 1-2 concurrent instances. A truly global throttle would need
// Redis/KV which the backend doesn't expose yet.

const RATE_PER_SEC = 75;
const BUCKET_MAX = RATE_PER_SEC; // allow a 1-second burst, then steady state

let tokens = BUCKET_MAX;
let lastRefill = Date.now();

function refill() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed > 0) {
    tokens = Math.min(BUCKET_MAX, tokens + elapsed * RATE_PER_SEC);
    lastRefill = now;
  }
}

/** Acquire one token; resolves once a Massive call may proceed. */
export async function acquireMassiveToken(): Promise<void> {
  // Loop in case multiple callers race for the same refill window.
  // Each iteration sleeps just long enough to mint at least one token.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    const needed = 1 - tokens;
    const waitMs = Math.max(5, Math.ceil((needed / RATE_PER_SEC) * 1000));
    await new Promise((res) => setTimeout(res, waitMs));
  }
}

/** Wrap any fetch-returning function so it waits for a Massive token first. */
export function throttledMassive<T>(fn: () => Promise<T>): Promise<T> {
  return acquireMassiveToken().then(fn);
}
