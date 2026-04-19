// Unified Action Label system — ONE vocabulary across the whole app.
//   BUY NOW · WATCHLIST · WAIT · AVOID · EXIT · BLOCKED
//
// Single source of truth that converts each page's domain object (Scanner row,
// Web Pick grade, Portfolio verdict) into the same six labels. Used by the
// Scanner, Top Opportunities, Web Picks, and Portfolio so users see the same
// language everywhere.
import { actionFromScore, labelClasses, type ActionLabel } from "@/lib/finalRank";
import type { Verdict } from "@/lib/portfolioVerdict";
import type { ScoutPick } from "@/lib/optionsScout";

export type UnifiedLabel = ActionLabel | "BLOCKED";

export const UNIFIED_HINTS: Record<UnifiedLabel, string> = {
  "BUY NOW":   "BUY NOW — High conviction. Setup triggered, take the trade now per the playbook.",
  WATCHLIST:   "WATCHLIST — Solid setup. Near trigger; wait for break/volume confirmation before entering.",
  WAIT:        "WAIT — Mixed signals. Monitor and revisit; no edge yet.",
  AVOID:       "AVOID — No edge or hard-blocker (poor liquidity, IV trap, earnings risk, broken chart).",
  EXIT:        "EXIT — You hold this and the thesis is broken (stop hit, trend flipped, theta bleeding). Close it.",
  BLOCKED:     "BLOCKED — A NOVA Guard prevented this signal (stale data, intrinsic-value trap, broken trend, capital stop).",
};

/** Pick a Tailwind class set for any unified label. */
export function unifiedClasses(label: UnifiedLabel): string {
  if (label === "BLOCKED") return "bg-bearish/20 text-bearish border-bearish/50";
  return labelClasses(label);
}

// ── Web Picks (ScoutPick) ─────────────────────────────────────────────────
// We don't have a 0–100 score per pick — translate Grade A/B/C + risk bucket
// into the same vocabulary the Scanner and Dashboard use.
export function labelFromWebPick(p: ScoutPick, opts?: { blocked?: boolean }): UnifiedLabel {
  if (opts?.blocked) return "BLOCKED";
  // Aggressive/lottery picks should never be "BUY NOW" by themselves — they
  // require active confirmation.
  const isHotBucket = p.riskLevel === "high";
  if (p.grade === "A") return isHotBucket ? "WATCHLIST" : "BUY NOW";
  if (p.grade === "B") return "WATCHLIST";
  if (p.grade === "C") return "WAIT";
  return "WAIT";
}

// ── Portfolio (Verdict) ───────────────────────────────────────────────────
// Convert Nova's verdict into the unified vocabulary held positions speak.
//   • CRL EXIT or stop-loss / cut / take_profit → EXIT
//   • CRL GO + winning/running fine             → BUY NOW (i.e. "stay in")
//   • CRL WAIT or neutral                       → WAIT
//   • CRL NO / bleeding / expiring worthless    → AVOID
//   • else                                      → WATCHLIST
export function labelFromVerdict(v: Verdict | undefined | null, opts?: { blocked?: boolean }): UnifiedLabel {
  if (opts?.blocked) return "BLOCKED";
  if (!v) return "WATCHLIST";
  if (v.crl?.stopLossTriggered) return "EXIT";
  if (v.action === "cut" || v.action === "take_profit") return "EXIT";
  if (v.crl?.verdict === "EXIT") return "EXIT";
  if (v.crl?.verdict === "GO" || v.status === "winning" || v.status === "running fine") return "BUY NOW";
  if (v.crl?.verdict === "NO" || v.status === "bleeding" || v.status === "in trouble" || v.status === "expiring worthless") return "AVOID";
  if (v.crl?.verdict === "WAIT" || v.status === "neutral") return "WAIT";
  return "WATCHLIST";
}

// Re-export for convenience so call sites only import from one place.
export { actionFromScore, type ActionLabel };
