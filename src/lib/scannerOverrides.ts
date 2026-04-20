// Session-scoped Scanner overrides — temporary "loosen to see picks" toggles.
//
// These never touch the persisted StrategyProfile. They live in a tab-scoped
// in-memory store + a tiny pub/sub so the Scanner can re-render when the user
// flips one. Refreshing the page clears them — the user's saved profile is
// the source of truth.
//
// Spec (section 4): each override shows an amber dot + "Override active" pill
// in the Scanner header so the user always sees that defaults are bypassed.
import { useEffect, useState } from "react";

export interface ScannerOverrides {
  /** Show budget-blocked picks (ignore per-trade cap). */
  showBudgetBlocked: boolean;
  /** Bypass the ORB pre-market lock for THIS session. */
  bypassOrbLock: boolean;
  /** Allow IVP > strategy threshold (Gate 6). */
  allowHighIv: boolean;
  /** Treat profile as if reset to Moderate defaults for filtering. */
  treatAsModerate: boolean;
  /**
   * Temporary per-trade cap override (USD). When > 0 it REPLACES the
   * profile-derived cap for this session. Lets the user "Raise cap to $2,500
   * for today" with one click without rewriting their saved profile.
   */
  perTradeCapOverride: number;
  /**
   * Restrict the scanner universe to Conservative-Cheap sub-$50 tickers
   * (SOFI, F, PLTR, RIVN, BAC, T, XLF, KRE…) so a Conservative profile with
   * a small cap can actually find affordable Deep-ITM calls.
   */
  conservativeCheapOnly: boolean;
}

const DEFAULTS: ScannerOverrides = {
  showBudgetBlocked: false,
  bypassOrbLock: false,
  allowHighIv: false,
  treatAsModerate: false,
  perTradeCapOverride: 0,
  conservativeCheapOnly: false,
};

let state: ScannerOverrides = { ...DEFAULTS };
const subs = new Set<(s: ScannerOverrides) => void>();

function emit() {
  subs.forEach((cb) => cb(state));
}

export function getScannerOverrides(): ScannerOverrides {
  return state;
}

export function setScannerOverride<K extends keyof ScannerOverrides>(key: K, value: ScannerOverrides[K]) {
  state = { ...state, [key]: value };
  emit();
}

export function clearScannerOverrides() {
  state = { ...DEFAULTS };
  emit();
}

export function useScannerOverrides(): {
  overrides: ScannerOverrides;
  set: typeof setScannerOverride;
  clear: typeof clearScannerOverrides;
  activeCount: number;
} {
  const [s, setLocal] = useState<ScannerOverrides>(state);
  useEffect(() => {
    const cb = (v: ScannerOverrides) => setLocal(v);
    subs.add(cb);
    return () => { subs.delete(cb); };
  }, []);
  const activeCount = (Object.keys(DEFAULTS) as (keyof ScannerOverrides)[])
    .filter((k) => s[k] !== DEFAULTS[k]).length;
  return { overrides: s, set: setScannerOverride, clear: clearScannerOverrides, activeCount };
}

export const OVERRIDE_LABELS: Record<keyof ScannerOverrides, string> = {
  showBudgetBlocked: "Budget cap relaxed",
  bypassOrbLock: "ORB Lock off",
  allowHighIv: "IV Guard off",
  treatAsModerate: "Profile reset",
  perTradeCapOverride: "Per-trade cap raised",
  conservativeCheapOnly: "Conservative-Cheap universe",
};
