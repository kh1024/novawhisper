// Shared budget store: localStorage-backed with a tiny pub/sub so multiple
// components (Settings, ResearchDrawer) stay in sync without prop drilling.
import { useEffect, useState } from "react";

const KEY = "nova_budget";
const DEFAULT = 500;

function read(): number {
  if (typeof window === "undefined") return DEFAULT;
  const raw = window.localStorage.getItem(KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 50 ? n : DEFAULT;
}

const listeners = new Set<(v: number) => void>();

export function setBudget(v: number) {
  const clamped = Math.max(50, Math.round(v));
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, String(clamped));
  listeners.forEach((l) => l(clamped));
}

export function useBudget(): [number, (v: number) => void] {
  const [budget, setLocal] = useState<number>(() => read());
  useEffect(() => {
    const cb = (v: number) => setLocal(v);
    listeners.add(cb);
    // sync across tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLocal(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [budget, setBudget];
}
