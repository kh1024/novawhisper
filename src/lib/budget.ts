// Shared budget store: localStorage-backed with a tiny pub/sub so multiple
// components (Settings, ResearchDrawer, Scout filters) stay in sync.
//
// The per-trade budget is now DERIVED from two user inputs:
//   • portfolio size  (total capital, default $25k)
//   • risk percent    (max % of capital per single trade, default 2%)
//
// Effective per-trade cap = portfolio × risk%  — applied GLOBALLY. No
// recommendation, regardless of NOVA's score, may exceed this dollar cap.
import { useEffect, useState } from "react";

const KEY = "nova_budget";              // legacy key — fixed dollar fallback
const PORTFOLIO_KEY = "nova_portfolio_size";
const RISK_PCT_KEY  = "nova_risk_pct";

const DEFAULT_PORTFOLIO = 25_000;
const DEFAULT_RISK_PCT  = 2;            // 2% per trade
const MIN_BUDGET        = 50;

function readNum(key: string, fallback: number, min = 0): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function readPortfolio(): number {
  return readNum(PORTFOLIO_KEY, DEFAULT_PORTFOLIO, 100);
}
function readRiskPct(): number {
  // clamp 0.1% .. 100%
  const v = readNum(RISK_PCT_KEY, DEFAULT_RISK_PCT, 0.1);
  return Math.min(100, v);
}
function readLegacyBudget(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= MIN_BUDGET ? n : null;
}

/** Effective per-trade cap = portfolio × risk%. */
export function computeBudget(portfolio: number, riskPct: number): number {
  return Math.max(MIN_BUDGET, Math.round((portfolio * riskPct) / 100));
}

function readBudget(): number {
  return computeBudget(readPortfolio(), readRiskPct());
}

const listeners = new Set<(v: number) => void>();
const stateListeners = new Set<(s: { portfolio: number; riskPct: number; budget: number }) => void>();

function emit() {
  const portfolio = readPortfolio();
  const riskPct = readRiskPct();
  const budget = computeBudget(portfolio, riskPct);
  listeners.forEach((l) => l(budget));
  stateListeners.forEach((l) => l({ portfolio, riskPct, budget }));
}

/**
 * Legacy direct setter — kept for back-compat. If a caller still writes a
 * raw dollar amount, we translate it into a portfolio size at the current
 * risk %, so the global "% of capital" rule remains the source of truth.
 */
export function setBudget(v: number) {
  const clamped = Math.max(MIN_BUDGET, Math.round(v));
  if (typeof window === "undefined") return;
  const riskPct = readRiskPct();
  const impliedPortfolio = Math.max(100, Math.round((clamped * 100) / riskPct));
  window.localStorage.setItem(PORTFOLIO_KEY, String(impliedPortfolio));
  window.localStorage.removeItem(KEY); // drop the stale fixed value
  emit();
}

export function setPortfolioSize(v: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PORTFOLIO_KEY, String(Math.max(100, Math.round(v))));
  emit();
}

export function setRiskPct(v: number) {
  if (typeof window === "undefined") return;
  const clamped = Math.min(100, Math.max(0.1, Number(v)));
  window.localStorage.setItem(RISK_PCT_KEY, String(clamped));
  emit();
}

// One-shot migration: if a user has a legacy fixed budget but no portfolio
// size yet, derive a portfolio size from it (assume default 2% risk).
if (typeof window !== "undefined") {
  const legacy = readLegacyBudget();
  const hasPortfolio = window.localStorage.getItem(PORTFOLIO_KEY) != null;
  if (legacy && !hasPortfolio) {
    const implied = Math.round((legacy * 100) / DEFAULT_RISK_PCT);
    window.localStorage.setItem(PORTFOLIO_KEY, String(implied));
    window.localStorage.setItem(RISK_PCT_KEY, String(DEFAULT_RISK_PCT));
  }
}

/** Subscribe to the derived per-trade budget (back-compat shape). */
export function useBudget(): [number, (v: number) => void] {
  const [budget, setLocal] = useState<number>(() => readBudget());
  useEffect(() => {
    const cb = (v: number) => setLocal(v);
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === PORTFOLIO_KEY || e.key === RISK_PCT_KEY) {
        setLocal(readBudget());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [budget, setBudget];
}

/** Full state: portfolio + risk% + derived budget, with setters. */
export function useCapitalSettings() {
  const [state, setLocal] = useState(() => ({
    portfolio: readPortfolio(),
    riskPct: readRiskPct(),
    budget: readBudget(),
  }));
  useEffect(() => {
    const cb = (s: typeof state) => setLocal(s);
    stateListeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === PORTFOLIO_KEY || e.key === RISK_PCT_KEY) {
        setLocal({ portfolio: readPortfolio(), riskPct: readRiskPct(), budget: readBudget() });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      stateListeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return {
    ...state,
    setPortfolioSize,
    setRiskPct,
  };
}
