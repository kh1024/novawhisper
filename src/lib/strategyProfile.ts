// Master Strategy Profile — the trading persona the entire app follows.
//
// Persisted to public.strategy_profiles (Supabase) keyed by getOwnerKey().
// Cached in localStorage for synchronous reads (Scanner/Portfolio adapters
// can't await React Query). React state is driven by useStrategyProfile(),
// which subscribes to react-query and rebroadcasts via a tiny pub/sub so
// non-React code paths can stay in sync too.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerKeySync } from "@/lib/ownerKey";

// ─── Types ──────────────────────────────────────────────────────────────────
export type RiskTolerance = "Conservative" | "Moderate" | "Aggressive";
export type Horizon = "Day Trade" | "Swing" | "Position" | "LEAP";
export type MarketBias =
  | "Bullish" | "Slightly Bullish" | "Neutral"
  | "Slightly Bearish" | "Bearish" | "Uncertain";
export type IvStance = "Low (buyer)" | "Average" | "High (seller)";
export type CatalystMode = "No Catalyst" | "Earnings Ahead" | "Macro Release" | "Any";
export type TickerUniverse = "All" | "Mega Cap Only" | "Under $50" | "ETFs Only" | "Custom";

export interface AllowedStructures {
  longCall: boolean;
  longPut: boolean;
  leapsCall: boolean;
  leapsPut: boolean;
  callDebitSpread: boolean;
  putDebitSpread: boolean;
}

/**
 * Community Signal Engine v2 overrides — control the four backtested
 * r/options strategies. Defaults shipped with each profile via mergeProfile.
 */
export interface SignalEngineOverrides {
  /** SPX 1DTE Put Spread — IV Rank hard cap (default 20). */
  spxIvRankMax: number;
  /** SPX 1DTE Put Spread — enforce -0.4% gap filter (default true). */
  spxGapFilterEnabled: boolean;
  /** VIX Low/Mid zone boundary (default 19). */
  vixLowMidBoundary: number;
  /** VIX Mid/High zone boundary (default 25). */
  vixMidHighBoundary: number;
  /** SPY/QQQ/IWM IC scale-in window toggles. */
  icWindow1Enabled: boolean;
  icWindow2Enabled: boolean;
  icWindow3Enabled: boolean;
  /** Tail-day avoidance for short vol exits (default true — strongly recommended). */
  tailDayAvoidanceEnabled: boolean;
}

export const DEFAULT_SIGNAL_ENGINE_OVERRIDES: SignalEngineOverrides = {
  spxIvRankMax: 20,
  spxGapFilterEnabled: true,
  vixLowMidBoundary: 19,
  vixMidHighBoundary: 25,
  icWindow1Enabled: true,
  icWindow2Enabled: true,
  icWindow3Enabled: true,
  tailDayAvoidanceEnabled: true,
};

export interface GateOverrides {
  orbLockEnabled: boolean;
  ivpMaxThreshold: number;     // Gate 6 (default 80)
  hardStopLossPct: number;     // Gate 7 (default 30)
  rsiExhaustionEnabled: boolean;
  trendGateEnabled: boolean;
  /**
   * Pre-Market Preview Mode. When true (default), picks blocked ONLY by
   * Gate 5 (ORB Lock) stay visible in Scanner / Chains as research-only
   * cards with a 10:30 AM ET unlock countdown. Watchlist queue still works;
   * portfolio Save is locked. When false the original strict hide behavior
   * applies.
   */
  preMarketPreviewEnabled: boolean;
}

export interface StrategyProfile {
  // WHO YOU ARE
  riskTolerance: RiskTolerance;
  horizon: Horizon;
  accountSize: number;
  maxPerTradePct: number;       // 1–10
  maxOpenPositions: number;     // 1–20

  // WHAT YOU BELIEVE
  marketBias: MarketBias;
  ivStance: IvStance;
  catalystMode: CatalystMode;

  // WHAT YOU TRADE
  allowedStructures: AllowedStructures;

  // GATE OVERRIDES
  gateOverrides: GateOverrides;

  // COMMUNITY SIGNAL ENGINE v2
  signalEngineOverrides: SignalEngineOverrides;

  // SCANNER BEHAVIOR
  tickerUniverse: TickerUniverse;
  customTickers: string[];
  minOptionsLiquidity: number;     // 0–100
  excludeEarningsWithinDays: number;
  minDTE: number;
  maxDTE: number;

  // ALERTS
  alertOnNewBuy: boolean;
  alertOnGateFlip: boolean;
  alertOnStopLoss: boolean;
}

export const DEFAULT_PROFILE: StrategyProfile = {
  riskTolerance: "Moderate",
  horizon: "Swing",
  accountSize: 10_000,
  maxPerTradePct: 5,
  maxOpenPositions: 5,
  marketBias: "Neutral",
  ivStance: "Average",
  catalystMode: "Any",
  allowedStructures: {
    longCall: true,
    longPut: true,
    leapsCall: true,
    leapsPut: false,
    callDebitSpread: true,
    putDebitSpread: false,
  },
  gateOverrides: {
    orbLockEnabled: true,
    ivpMaxThreshold: 80,
    hardStopLossPct: 30,
    rsiExhaustionEnabled: true,
    trendGateEnabled: true,
    preMarketPreviewEnabled: true,
  },
  signalEngineOverrides: { ...DEFAULT_SIGNAL_ENGINE_OVERRIDES },
  tickerUniverse: "All",
  customTickers: [],
  minOptionsLiquidity: 60,
  excludeEarningsWithinDays: 7,
  minDTE: 7,
  maxDTE: 365,
  alertOnNewBuy: true,
  alertOnGateFlip: true,
  alertOnStopLoss: true,
};

// ─── Presets ────────────────────────────────────────────────────────────────
export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  profile: Partial<StrategyProfile>;
}

export const PRESETS: StrategyPreset[] = [
  {
    id: "capital-preservation",
    name: "Capital Preservation",
    description: "Conservative · Deep ITM only · all gates locked. Smallest exposure, tightest filters.",
    profile: {
      riskTolerance: "Conservative",
      horizon: "Position",
      maxPerTradePct: 2,
      maxOpenPositions: 3,
      ivStance: "Low (buyer)",
      catalystMode: "No Catalyst",
      allowedStructures: {
        longCall: true, longPut: true,
        leapsCall: true, leapsPut: false,
        callDebitSpread: true, putDebitSpread: true,
      },
      gateOverrides: {
        orbLockEnabled: true,
        ivpMaxThreshold: 60,
        hardStopLossPct: 25,
        rsiExhaustionEnabled: true,
        trendGateEnabled: true,
        preMarketPreviewEnabled: true,
      },
      minOptionsLiquidity: 75,
      excludeEarningsWithinDays: 14,
      minDTE: 30,
      maxDTE: 365,
    },
  },
  {
    id: "swing-trader",
    name: "Swing Trader",
    description: "Moderate risk · 30–60 DTE · long calls + debit spreads. The default everyday persona.",
    profile: {
      riskTolerance: "Moderate",
      horizon: "Swing",
      maxPerTradePct: 5,
      maxOpenPositions: 5,
      catalystMode: "Any",
      allowedStructures: {
        longCall: true, longPut: true,
        leapsCall: false, leapsPut: false,
        callDebitSpread: true, putDebitSpread: true,
      },
      minDTE: 30,
      maxDTE: 60,
    },
  },
  {
    id: "leap-investor",
    name: "LEAP Investor",
    description: "Position trades · 180+ DTE · deep ITM calls only. Stock replacement style.",
    profile: {
      riskTolerance: "Conservative",
      horizon: "LEAP",
      maxPerTradePct: 8,
      maxOpenPositions: 4,
      ivStance: "Low (buyer)",
      catalystMode: "No Catalyst",
      allowedStructures: {
        longCall: true, longPut: false,
        leapsCall: true, leapsPut: false,
        callDebitSpread: false, putDebitSpread: false,
      },
      minDTE: 180,
      maxDTE: 730,
      excludeEarningsWithinDays: 0,
    },
  },
  {
    id: "earnings-hunter",
    name: "Earnings Hunter",
    description: "Aggressive · short DTE · trades the catalyst. Higher IV tolerance, smaller per-trade size.",
    profile: {
      riskTolerance: "Aggressive",
      horizon: "Day Trade",
      maxPerTradePct: 3,
      maxOpenPositions: 6,
      ivStance: "High (seller)",
      catalystMode: "Earnings Ahead",
      allowedStructures: {
        longCall: true, longPut: true,
        leapsCall: false, leapsPut: false,
        callDebitSpread: true, putDebitSpread: true,
      },
      gateOverrides: {
        orbLockEnabled: true,
        ivpMaxThreshold: 95,
        hardStopLossPct: 40,
        rsiExhaustionEnabled: false,
        trendGateEnabled: false,
        preMarketPreviewEnabled: true,
      },
      minDTE: 0,
      maxDTE: 14,
      excludeEarningsWithinDays: 0,
    },
  },
];

export function applyPreset(current: StrategyProfile, preset: StrategyPreset): StrategyProfile {
  return mergeProfile(current, preset.profile);
}

export function mergeProfile(base: StrategyProfile, patch: Partial<StrategyProfile>): StrategyProfile {
  return {
    ...base,
    ...patch,
    allowedStructures: { ...base.allowedStructures, ...(patch.allowedStructures ?? {}) },
    gateOverrides: { ...base.gateOverrides, ...(patch.gateOverrides ?? {}) },
    customTickers: patch.customTickers ?? base.customTickers,
  };
}

// ─── Persona name (UI helper) ───────────────────────────────────────────────
export function personaName(p: StrategyProfile): string {
  const bias = p.marketBias.replace("Slightly ", "").replace("Uncertain", "Neutral");
  return `${p.horizon} ${p.riskTolerance} ${bias}`.trim();
}

export function gateProfileLabel(g: GateOverrides): "Standard" | "Relaxed" | "Custom" {
  const isStandard = g.orbLockEnabled && g.rsiExhaustionEnabled && g.trendGateEnabled
    && g.ivpMaxThreshold === 80 && g.hardStopLossPct === 30;
  if (isStandard) return "Standard";
  const allOff = !g.orbLockEnabled && !g.rsiExhaustionEnabled && !g.trendGateEnabled;
  if (allOff) return "Relaxed";
  return "Custom";
}

export function allowedStructureCount(s: AllowedStructures): number {
  return Object.values(s).filter(Boolean).length;
}

export function maxPerTradeDollars(p: StrategyProfile): number {
  return Math.max(50, Math.round((p.accountSize * p.maxPerTradePct) / 100));
}

// ─── localStorage cache (synchronous read for non-React code) ───────────────
const LS_KEY = "nova_strategy_profile_v1";
const LS_OWNER_KEY = "nova_strategy_profile_v1_owner";

function readCache(): { profile: StrategyProfile; owner: string | null } {
  if (typeof window === "undefined") return { profile: DEFAULT_PROFILE, owner: null };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const owner = window.localStorage.getItem(LS_OWNER_KEY);
    if (!raw) return { profile: DEFAULT_PROFILE, owner };
    const parsed = JSON.parse(raw);
    return { profile: mergeProfile(DEFAULT_PROFILE, parsed), owner };
  } catch {
    return { profile: DEFAULT_PROFILE, owner: null };
  }
}

function writeCache(profile: StrategyProfile, owner: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(profile));
    if (owner) window.localStorage.setItem(LS_OWNER_KEY, owner);
  } catch { /* quota / SSR — ignore */ }
}

const subscribers = new Set<(p: StrategyProfile) => void>();
function broadcast(p: StrategyProfile) {
  subscribers.forEach((cb) => cb(p));
}

/**
 * Synchronous read of the active profile. Safe to call from non-React code
 * (gate adapter, options-scout payload builders, etc.). Returns the cached
 * value, falling back to defaults pre-hydration.
 */
export function getActiveStrategyProfile(): StrategyProfile {
  return readCache().profile;
}

/** Subscribe to profile changes from any module. Returns an unsubscribe fn. */
export function subscribeToStrategyProfile(cb: (p: StrategyProfile) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// ─── Supabase load + save ───────────────────────────────────────────────────
async function fetchProfile(ownerKey: string | null): Promise<StrategyProfile> {
  if (!ownerKey || ownerKey.length < 16) return readCache().profile;
  const { data, error } = await supabase
    .from("strategy_profiles" as never)
    .select("profile")
    .eq("owner_key", ownerKey)
    .maybeSingle();
  if (error) {
    console.warn("[strategyProfile] fetch error", error.message);
    return readCache().profile;
  }
  if (!data) return readCache().profile;
  const remote = (data as { profile: Partial<StrategyProfile> }).profile;
  return mergeProfile(DEFAULT_PROFILE, remote);
}

async function upsertProfile(ownerKey: string, profile: StrategyProfile): Promise<void> {
  if (!ownerKey || ownerKey.length < 16) return;
  const { error } = await supabase
    .from("strategy_profiles" as never)
    .upsert({ owner_key: ownerKey, profile, updated_at: new Date().toISOString() } as never,
            { onConflict: "owner_key" });
  if (error) {
    console.error("[strategyProfile] save failed", error.message);
    throw error;
  }
}

// ─── React hook ─────────────────────────────────────────────────────────────
const QUERY_KEY = ["strategy-profile"] as const;

export interface UseStrategyProfileResult {
  profile: StrategyProfile;
  update: (patch: Partial<StrategyProfile>) => void;
  reset: () => void;
  isLoading: boolean;
  isSaving: boolean;
  ownerKey: string | null;
}

export function useStrategyProfile(): UseStrategyProfileResult {
  const qc = useQueryClient();
  const [ownerKey, setOwnerKey] = useState<string | null>(() => getOwnerKeySync());

  // Track auth changes so we re-pull the profile on sign-in.
  useEffect(() => {
    const apply = (uid: string | null | undefined) => setOwnerKey(uid ?? null);
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => apply(s?.user?.id));
    return () => sub.subscription.unsubscribe();
  }, []);

  const query = useQuery({
    queryKey: [...QUERY_KEY, ownerKey ?? "anon"],
    queryFn: () => fetchProfile(ownerKey),
    staleTime: 60_000,
    initialData: () => readCache().profile,
  });

  // Mirror the active profile into the localStorage cache + broadcast.
  useEffect(() => {
    if (query.data) {
      writeCache(query.data, ownerKey);
      broadcast(query.data);
    }
  }, [query.data, ownerKey]);

  const mutation = useMutation({
    mutationFn: async (next: StrategyProfile) => {
      writeCache(next, ownerKey);
      broadcast(next);
      if (ownerKey) await upsertProfile(ownerKey, next);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData([...QUERY_KEY, ownerKey ?? "anon"], next);
    },
  });

  const update = (patch: Partial<StrategyProfile>) => {
    const next = mergeProfile(query.data ?? DEFAULT_PROFILE, patch);
    mutation.mutate(next);
  };
  const reset = () => mutation.mutate(DEFAULT_PROFILE);

  return {
    profile: query.data ?? DEFAULT_PROFILE,
    update,
    reset,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    ownerKey,
  };
}

// ─── Compliance helpers (Portfolio + Scanner) ───────────────────────────────
export function structureKeyForOption(optionType: string, dteDays: number): keyof AllowedStructures {
  const isCall = optionType.toLowerCase().includes("call");
  const isPut = optionType.toLowerCase().includes("put");
  // Treat ≥ 180 DTE as LEAPS, anything else as the regular long.
  if (dteDays >= 180) return isCall ? "leapsCall" : "leapsPut";
  return isCall ? "longCall" : "longPut";
}

export function isStructureAllowed(p: StrategyProfile, optionType: string, dteDays: number): boolean {
  const key = structureKeyForOption(optionType, dteDays);
  return p.allowedStructures[key] === true;
}

export interface ComplianceCheck {
  onStrategy: boolean;
  reasons: string[];
}

/** Check whether a saved position still matches the active profile. */
export function checkPositionCompliance(
  p: StrategyProfile,
  pos: { option_type: string; expiry: string; entry_premium: number | null; contracts: number },
): ComplianceCheck {
  const reasons: string[] = [];
  const dte = Math.max(0, Math.round((new Date(pos.expiry + "T16:00:00Z").getTime() - Date.now()) / 86_400_000));
  if (!isStructureAllowed(p, pos.option_type, dte)) {
    reasons.push(`${pos.option_type.toUpperCase()} disabled in current strategy`);
  }
  if (dte < p.minDTE) reasons.push(`DTE ${dte} below min ${p.minDTE}`);
  if (dte > p.maxDTE) reasons.push(`DTE ${dte} above max ${p.maxDTE}`);
  const cost = pos.entry_premium != null ? Number(pos.entry_premium) * 100 * pos.contracts : 0;
  const cap = maxPerTradeDollars(p);
  if (cost > 0 && cost > cap) {
    reasons.push(`Cost $${Math.round(cost)} > per-trade cap $${cap}`);
  }
  return { onStrategy: reasons.length === 0, reasons };
}
