// Global app settings — localStorage-backed with a tiny pub/sub.
// Used across Settings page, TickerTape, liveData hooks, ResearchDrawer.
import { useEffect, useState } from "react";

export type RiskProfile = "safe" | "mild" | "aggressive";
export type AiModel =
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-pro"
  | "google/gemini-3-flash-preview"
  | "openai/gpt-5-mini"
  | "openai/gpt-5";

export interface AppSettings {
  refreshMs: number;          // quote polling interval
  tickerSymbols: string[];    // symbols shown in the top tape
  aiModel: AiModel;
  riskProfile: RiskProfile;
}

const KEY = "nova_settings";
const DEFAULTS: AppSettings = {
  refreshMs: 30_000,           // safe default — Finnhub free = 60 calls/min
  tickerSymbols: [],           // empty = use full universe
  aiModel: "google/gemini-3-flash-preview",
  riskProfile: "mild",
};

function read(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    // Migrate: anyone with the old 5s default gets bumped to safe 30s.
    if (merged.refreshMs < 15_000) merged.refreshMs = 30_000;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<(s: AppSettings) => void>();

export function setSettings(patch: Partial<AppSettings>) {
  const next = { ...read(), ...patch };
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [state, setLocal] = useState<AppSettings>(() => read());
  useEffect(() => {
    const cb = (s: AppSettings) => setLocal(s);
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setLocal(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [state, setSettings];
}

export const REFRESH_OPTIONS: { label: string; ms: number; hint: string }[] = [
  { label: "15s", ms: 15_000, hint: "Aggressive — may hit Finnhub free-tier limit (60/min) on full universe." },
  { label: "30s", ms: 30_000, hint: "Recommended balance." },
  { label: "1m",  ms: 60_000, hint: "Conservative — stays well within free quotas." },
  { label: "5m",  ms: 300_000, hint: "Light usage." },
];

export const AI_MODELS: { value: AiModel; label: string; hint: string }[] = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", hint: "Fast + cheap. Default." },
  { value: "google/gemini-2.5-flash",       label: "Gemini 2.5 Flash", hint: "Balanced reasoning." },
  { value: "google/gemini-2.5-pro",         label: "Gemini 2.5 Pro",   hint: "Deepest reasoning, slower." },
  { value: "openai/gpt-5-mini",             label: "GPT-5 Mini",       hint: "OpenAI alternative." },
  { value: "openai/gpt-5",                  label: "GPT-5",            hint: "Top tier, most expensive." },
];

export const RISK_PROFILES: { value: RiskProfile; label: string; hint: string; emoji: string }[] = [
  { value: "safe",       label: "Safe",       hint: "Deep ITM, Δ ≥ 0.70. Acts like the stock.", emoji: "🟢" },
  { value: "mild",       label: "Mild",       hint: "Balanced 2–5 day swings, Δ 0.40–0.69.",   emoji: "🟡" },
  { value: "aggressive", label: "Aggressive", hint: "High leverage, Δ < 0.40. Theta risk.",     emoji: "🔴" },
];
