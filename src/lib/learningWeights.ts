// Pulls the latest learning_weights from the backend and caches them in
// localStorage. The ranker reads `applyLearningMultiplier()` to gently bias
// the final score per label based on the AI's own historical performance.
import { supabase } from "@/integrations/supabase/client";
import type { ActionLabel } from "./finalRank";

const CACHE_KEY = "nova_learning_weights_v1";
const CACHE_TTL_MS = 30 * 60_000; // 30 min

export interface LearningWeight {
  label: string;
  multiplier: number;
  sample_size: number;
  hit_rate: number | null;
  avg_return: number | null;
  rationale: string | null;
  updated_at: string;
}

interface CachedWeights {
  fetchedAt: number;
  weights: LearningWeight[];
}

let memoryCache: CachedWeights | null = null;

function readCache(): CachedWeights | null {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) return memoryCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWeights;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(weights: LearningWeight[]) {
  const payload: CachedWeights = { fetchedAt: Date.now(), weights };
  memoryCache = payload;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch { /* ignore quota */ }
  }
}

export async function fetchLearningWeights(force = false): Promise<LearningWeight[]> {
  if (!force) {
    const cached = readCache();
    if (cached) return cached.weights;
  }
  const { data, error } = await supabase.from("learning_weights").select("*");
  if (error || !data) return readCache()?.weights ?? [];
  writeCache(data as LearningWeight[]);
  return data as LearningWeight[];
}

/** Synchronous accessor — returns whatever's in cache (1.0 fallback). */
export function getLabelMultiplier(label: ActionLabel): number {
  const cached = readCache();
  if (!cached) return 1.0;
  const row = cached.weights.find((w) => w.label === label);
  return row?.multiplier ?? 1.0;
}

/** Apply the multiplier to a score, clamped to [0, 100]. */
export function applyLearningMultiplier(score: number, label: ActionLabel): number {
  const m = getLabelMultiplier(label);
  return Math.max(0, Math.min(100, Math.round(score * m)));
}
