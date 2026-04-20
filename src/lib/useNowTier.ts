// useNowTier — re-evaluate the live scanner tier for symbols the user
// currently owns. The scanner already scores the full universe on every
// refresh; this hook just indexes that result by symbol so the Portfolio
// page can show "Entry tier" (saved on the position row) next to
// "Now tier" (live from the scanner) without a second network round-trip.
//
// Returned tier is one of: CLEAN | NEAR-LIMIT | BEST-OF-WAIT | EXCLUDED.
// EXCLUDED means the symbol failed safety OR was hard-dropped by budget,
// OR the scanner currently has no opinion (universe filter excluded it).
import { useMemo } from "react";
import { useScannerPicks } from "@/lib/useScannerPicks";
import type { PickTier } from "@/lib/pickTier";

export interface NowTierEntry {
  tier: PickTier;
  /** Adjusted score 0-100 (only meaningful for non-EXCLUDED). */
  score: number | null;
  /** Why it's NEAR-LIMIT/BEST-OF-WAIT/EXCLUDED. */
  caveat: string | null;
  /** Origin of the classification — useful for the tooltip. */
  source: "approved" | "safety_blocked" | "budget_blocked" | "not_in_scan";
}

export function useNowTier(symbols: string[]): {
  bySymbol: Map<string, NowTierEntry>;
  isLoading: boolean;
} {
  // Use bucket "All" so we don't accidentally mark a Conservative-bucket
  // position as EXCLUDED just because the user is currently filtering by
  // Aggressive on the Scanner page.
  const scan = useScannerPicks({ bucket: "All", includeBudgetBlocked: true, includeSafetyBlocked: true });

  const bySymbol = useMemo(() => {
    const m = new Map<string, NowTierEntry>();
    if (symbols.length === 0) return m;
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));

    for (const p of scan.approved) {
      const sym = p.row.symbol.toUpperCase();
      if (!wanted.has(sym)) continue;
      // Keep the first (highest-tier) hit per symbol — approved is sorted.
      if (m.has(sym)) continue;
      m.set(sym, {
        tier: p.pickTier,
        score: p.adjustedScore,
        caveat: p.tierCaveat,
        source: "approved",
      });
    }
    for (const b of scan.safetyBlocked) {
      const sym = b.row.symbol.toUpperCase();
      if (!wanted.has(sym) || m.has(sym)) continue;
      m.set(sym, { tier: "EXCLUDED", score: null, caveat: b.reason, source: "safety_blocked" });
    }
    for (const b of scan.budgetBlocked) {
      const sym = b.row.symbol.toUpperCase();
      if (!wanted.has(sym) || m.has(sym)) continue;
      m.set(sym, { tier: "EXCLUDED", score: null, caveat: b.reason, source: "budget_blocked" });
    }
    // Anything we wanted but didn't see at all → not in current scan.
    for (const sym of wanted) {
      if (!m.has(sym)) {
        m.set(sym, { tier: "EXCLUDED", score: null, caveat: "Not in current scanner universe.", source: "not_in_scan" });
      }
    }
    return m;
  }, [scan.approved, scan.safetyBlocked, scan.budgetBlocked, symbols.join("|")]);

  return { bySymbol, isLoading: scan.isLoading };
}
