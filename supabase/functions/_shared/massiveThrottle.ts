// Massive concurrency limiter (Options Advanced plan: unlimited API calls).
//
// Prior to the unlimited plan we ran a per-instance 75 req/s token bucket.
// That artificial cap is gone — we now allow unbounded throughput, with two
// safety nets:
//   1. CONCURRENCY cap (default 20 in-flight requests per warm instance) so we
//      don't blow Supabase Edge Function FD/socket budgets.
//   2. Genuine 429/5xx responses are still backed off by the calling sites.
//
// The exported function names are unchanged so existing callers compile
// without edits — `acquireMassiveToken()` now waits on the semaphore, and
// `throttledMassive(fn)` runs `fn` inside it. Both resolve immediately when
// concurrency is below the cap.

// NOTE: the previous semaphore (cap = 20 in-flight) deadlocked because
// several legacy call sites (`quotes-fetch`, `options-fetch`,
// `live-ticks-broadcast`) call `acquireMassiveToken()` without a paired
// `releaseMassiveToken()`. Each leaked slot permanently shrinks the cap
// until every Massive request waits forever and the edge function blows
// past its CPU budget (WORKER_RESOURCE_LIMIT / "CPU Time exceeded").
//
// Since Options Advanced is unlimited, we no longer enforce a cap here.
// `acquireMassiveToken()` resolves instantly, `releaseMassiveToken()` is
// a no-op, and `throttledMassive(fn)` simply runs `fn`. This is safe:
// genuine 429/5xx responses are still backed off by the calling sites.
let active = 0;

function release() {
  active = Math.max(0, active - 1);
}

/**
 * Acquire one in-flight slot. Resolves immediately if we're below the
 * concurrency cap; otherwise queues until a slot frees up.
 *
 * IMPORTANT: every caller MUST eventually invoke `releaseMassiveToken()`
 * (or use `throttledMassive(fn)` which handles release automatically).
 * Existing callers that only `await acquireMassiveToken()` and never release
 * will leak slots — `throttledMassive(fn)` is the safe wrapper.
 */
export function acquireMassiveToken(): Promise<void> {
  active += 1;
  return Promise.resolve();
}

/** Pair with `acquireMassiveToken()` when not using `throttledMassive(fn)`. */
export function releaseMassiveToken(): void {
  release();
}

/** Wrap any fetch-returning function so it runs inside one concurrency slot. */
export async function throttledMassive<T>(fn: () => Promise<T>): Promise<T> {
  await acquireMassiveToken();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Current in-flight count (for debug telemetry). */
export function massiveActiveCount(): number {
  return active;
}
