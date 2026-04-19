// User-controlled per-edge-function kill switch. When a function name is in
// the disabled set, supabase.functions.invoke short-circuits and returns a
// synthetic { error } so no network call (and no quota usage) happens.
//
// Persisted to localStorage so the choice survives reloads on this device.
const STORAGE_KEY = "lov.disabledEdgeFunctions.v1";

function load(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

let disabled: Set<string> = load();
const listeners = new Set<() => void>();

function persist() {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...disabled])); } catch { /* ignore */ }
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

export function isDisabled(fn: string): boolean { return disabled.has(fn); }
export function getDisabled(): string[] { return [...disabled]; }
export function areAnyDisabled(fns: string[]): boolean { return fns.some((f) => disabled.has(f)); }

export function setDisabled(fn: string, off: boolean): void {
  if (off) disabled.add(fn); else disabled.delete(fn);
  persist();
}

export function setManyDisabled(fns: string[], off: boolean): void {
  for (const f of fns) { if (off) disabled.add(f); else disabled.delete(f); }
  persist();
}

export function subscribeDisabled(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sync across tabs. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      disabled = load();
      listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    }
  });
}