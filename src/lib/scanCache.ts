// Stable Scan Cache — kills row-flicker between poll cycles.
//
// Problem: the Scanner re-ranks on every quote tick (every 60s). Tiny score
// deltas push picks in/out of the top-N, so cards appear and vanish even
// though nothing meaningful changed. That looks broken AND erodes trust in
// the "Buy Now" verdicts.
//
// Solution: a per-session in-memory cache keyed by symbol+strike+expiry that
// applies three rules on every tick:
//   1. STICKY DISPLAY  — anything shown in the last 90s stays visible if
//      gates still pass, even if score dropped out of top-N.
//   2. HYSTERESIS IN   — a NEW pick must outrank the cached MIN by ≥5 pts
//      to enter (prevents two near-tied picks ping-ponging).
//   3. HYSTERESIS OUT  — a cached pick exits only if gates newly fail OR
//      score falls > 10 pts below the current display minimum.
// Plus a "On board Xm Ys" age badge so the user can see stability.
//
// Client-only — survives quote refetches but resets on hard reload.

const STICKY_MS = 90_000;            // sec.2 spec — minimum 90s display life
const HYSTERESIS_IN_PTS = 5;
const HYSTERESIS_OUT_PTS = 10;

export interface CachedPickKey {
  symbol: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
}

export interface CachedPick<T> {
  key: string;
  payload: T;
  score: number;
  passing: boolean;       // gates currently pass
  firstSeenAt: number;    // ms epoch — drives age badge
  lastSeenAt: number;     // ms epoch — drives sticky window
}

export function cacheKeyOf(k: CachedPickKey): string {
  return `${k.symbol.toUpperCase()}|${k.optionType}|${k.strike}|${k.expiry}`;
}

interface CandidateInput<T> extends CachedPickKey {
  payload: T;
  score: number;
  passing: boolean;
}

export interface CacheReconcileOpts {
  /** Max picks the UI wants to display this tick. */
  maxDisplay?: number;
  /** Override "now" for tests. */
  now?: number;
}

export class ScanCache<T> {
  private map = new Map<string, CachedPick<T>>();

  /** Returns the current cached snapshot ordered by score desc. */
  snapshot(): CachedPick<T>[] {
    return [...this.map.values()].sort((a, b) => b.score - a.score);
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * Reconcile this tick's candidates against the cache. Returns the picks
   * the UI should render (already sorted by score desc), each tagged with
   * cache-age info for the "On board" badge.
   */
  reconcile(candidates: CandidateInput<T>[], opts: CacheReconcileOpts = {}): CachedPick<T>[] {
    const now = opts.now ?? Date.now();
    const maxDisplay = opts.maxDisplay ?? candidates.length;

    // Index candidates so we can look up freshly.
    const candByKey = new Map<string, CandidateInput<T>>();
    for (const c of candidates) candByKey.set(cacheKeyOf(c), c);

    // 1) Refresh any cached entry that's still in the candidate set —
    //    update payload + score + passing + lastSeenAt, keep firstSeenAt.
    for (const [key, cached] of this.map) {
      const next = candByKey.get(key);
      if (!next) {
        // Not in this tick's candidates at all — only drop if outside sticky
        // window OR gates flipped to failing in a previous tick already.
        const age = now - cached.lastSeenAt;
        if (age > STICKY_MS || !cached.passing) {
          this.map.delete(key);
        }
        continue;
      }
      cached.payload = next.payload;
      cached.score = next.score;
      cached.passing = next.passing;
      cached.lastSeenAt = now;
    }

    // Determine the current display floor (the lowest-scoring cached pick
    // we'd plan to show this tick). Used for hysteresis decisions.
    const cachedSorted = [...this.map.values()].sort((a, b) => b.score - a.score);
    const displayed = cachedSorted.slice(0, maxDisplay);
    const displayMin = displayed.length ? displayed[displayed.length - 1].score : -Infinity;

    // 2) Consider NEW candidates (not yet cached). They enter only if they
    //    outrank the current display minimum by ≥ HYSTERESIS_IN_PTS, or if
    //    we have free display slots (cache below maxDisplay).
    for (const cand of candidates) {
      const key = cacheKeyOf(cand);
      if (this.map.has(key)) continue;
      if (!cand.passing) continue;       // never auto-cache failing picks
      const hasRoom = this.map.size < maxDisplay;
      if (hasRoom || cand.score >= displayMin + HYSTERESIS_IN_PTS) {
        this.map.set(key, {
          key,
          payload: cand.payload,
          score: cand.score,
          passing: cand.passing,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }

    // 3) Apply outbound hysteresis — drop cached entries that are clearly
    //    dominated AND outside the sticky window.
    for (const [key, cached] of this.map) {
      const age = now - cached.firstSeenAt;
      if (age <= STICKY_MS) continue; // sticky window — keep
      if (!cached.passing) {
        this.map.delete(key);
        continue;
      }
      if (cached.score < displayMin - HYSTERESIS_OUT_PTS) {
        this.map.delete(key);
      }
    }

    return [...this.map.values()].sort((a, b) => b.score - a.score).slice(0, maxDisplay);
  }
}

/** Format "On board 3m 12s" for a firstSeenAt timestamp. */
export function formatCacheAge(firstSeenAt: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - firstSeenAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
