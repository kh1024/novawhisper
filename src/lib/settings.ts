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

// ─── Trader profile (drives the Strategy Builder) ───────────────────────────
export type RiskTolerance = "low" | "medium" | "high";
export type Horizon = "intraday" | "swing" | "position";
export type Outlook = "bullish" | "slightly_bullish" | "neutral" | "slightly_bearish" | "bearish" | "uncertain";
export type EventBias = "earnings" | "macro" | "none";
export type AccountSize = "small" | "medium" | "large";

export interface TraderProfile {
  risk: RiskTolerance;
  horizon: Horizon;
  outlook: Outlook;
  event: EventBias;
  account: AccountSize;
  // Heuristic IV stance — user picks how rich premium feels right now.
  ivStance: "low" | "average" | "high";
}

export interface AppSettings {
  refreshMs: number;          // quote polling interval
  tickerSymbols: string[];    // symbols shown in the top tape
  aiModel: AiModel;
  riskProfile: RiskProfile;
  webhookUrl: string;         // Make.com / n8n / Slack incoming webhook
  webhookEnabled: boolean;    // master toggle
  webhookOnWait: boolean;     // also fire on new WAIT signals
  // Trading fees applied to P&L. Defaults match Robinhood retail options:
  // $0 commission + ~$0.03/contract regulatory pass-through (ORF + OCC + SEC + FINRA TAF, round-tripped).
  brokerPreset: BrokerPreset;
  feePerContract: number;     // per contract, per side (entry & exit each charged)
  feePerTrade: number;        // flat per trade, per side
  regulatoryFeePerContract: number; // ORF/OCC/SEC pass-through, per side
  paperMode: boolean;         // when true, new saves are tagged is_paper=true
  // Trader profile — used by /strategy to tailor suggestions.
  traderProfile: TraderProfile;
}

export type BrokerPreset = "robinhood" | "webull" | "schwab" | "ibkr" | "tastytrade" | "custom";

const KEY = "nova_settings";
const DEFAULTS: AppSettings = {
  refreshMs: 30_000,           // safe default — Finnhub free = 60 calls/min
  tickerSymbols: [],           // empty = use full universe
  aiModel: "google/gemini-3-flash-preview",
  riskProfile: "mild",
  webhookUrl: "",
  webhookEnabled: false,
  webhookOnWait: false,
  brokerPreset: "robinhood",
  feePerContract: 0,
  feePerTrade: 0,
  regulatoryFeePerContract: 0.08,
  paperMode: false,
  traderProfile: {
    risk: "medium",
    horizon: "swing",
    outlook: "slightly_bullish",
    event: "none",
    account: "small",
    ivStance: "average",
  },
};

export const BROKER_PRESETS: { value: BrokerPreset; label: string; feePerContract: number; feePerTrade: number; regulatoryFeePerContract: number; hint: string }[] = [
  { value: "robinhood", label: "Robinhood",  feePerContract: 0,    feePerTrade: 0,    regulatoryFeePerContract: 0.08, hint: "$0 commission + ~$0.08/contract regulatory pass-through." },
  { value: "webull",    label: "Webull",     feePerContract: 0,    feePerTrade: 0,    regulatoryFeePerContract: 0.05, hint: "$0 commission + ~$0.05/contract regulatory." },
  { value: "schwab",    label: "Schwab",     feePerContract: 0.65, feePerTrade: 0,    regulatoryFeePerContract: 0.03, hint: "$0.65/contract + regulatory pass-through." },
  { value: "ibkr",      label: "IBKR Lite",  feePerContract: 0.65, feePerTrade: 0,    regulatoryFeePerContract: 0.03, hint: "Tiered: $0.65/contract typical retail." },
  { value: "tastytrade",label: "tastytrade", feePerContract: 1.00, feePerTrade: 0,    regulatoryFeePerContract: 0.03, hint: "$1/contract open, $0 close (capped)." },
  { value: "custom",    label: "Custom",     feePerContract: 0,    feePerTrade: 0,    regulatoryFeePerContract: 0,    hint: "Set your own values below." },
];

function read(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    const merged: AppSettings = {
      ...DEFAULTS,
      ...parsed,
      // Deep-merge traderProfile so we don't lose new fields added later.
      traderProfile: { ...DEFAULTS.traderProfile, ...(parsed?.traderProfile ?? {}) },
    };
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
