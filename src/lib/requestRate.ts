// Rolling 60-second request counter per edge-function name.
//
// We monkey-patch `supabase.functions.invoke` exactly once at module load so
// EVERY call from anywhere in the app (hooks, components, background jobs)
// is counted — not just the ones inside apiHealth.ts. This gives the Settings
// API-health card an accurate "are we under 100 req/s on Massive?" readout.
import { supabase } from "@/integrations/supabase/client";

const WINDOW_MS = 60_000;
/** function-name → array of timestamp (ms) for calls in the last WINDOW_MS */
const buckets = new Map<string, number[]>();
/** subscribers notified whenever a new call is recorded */
const listeners = new Set<() => void>();

function record(fn: string) {
  const now = Date.now();
  const arr = buckets.get(fn) ?? [];
  arr.push(now);
  // Drop anything older than the window — keeps memory bounded even under load.
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  buckets.set(fn, i > 0 ? arr.slice(i) : arr);
  listeners.forEach((l) => {
    try { l(); } catch { /* listener errors must not break invokes */ }
  });
}

/** Calls in the trailing 60s for a given edge function name. */
export function getCount60s(fn: string): number {
  const arr = buckets.get(fn);
  if (!arr || arr.length === 0) return 0;
  const cutoff = Date.now() - WINDOW_MS;
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  return arr.length - i;
}

/** Subscribe to counter changes; returns unsubscribe. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Clear the rolling counter for one or more function names. */
export function resetCounts(fns: string[]): void {
  for (const fn of fns) buckets.set(fn, []);
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

// ── One-time instrumentation ─────────────────────────────────────────────
// Guard against HMR double-patching in dev.
const SUPA = supabase as unknown as {
  functions: {
    invoke: (fn: string, opts?: unknown) => Promise<unknown>;
    __rateInstrumented?: boolean;
  };
};
if (!SUPA.functions.__rateInstrumented) {
  const orig = SUPA.functions.invoke.bind(SUPA.functions);
  SUPA.functions.invoke = ((fn: string, opts?: unknown) => {
    record(fn);
    return orig(fn, opts);
  }) as typeof SUPA.functions.invoke;
  SUPA.functions.__rateInstrumented = true;
}
