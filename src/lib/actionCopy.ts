// Smart, context-aware copy for action chips and empty states.
// Keeps the canonical ActionLabel (drives filters/colors) while letting the
// UI surface friendlier sub-labels like "Wait for Open" or "Buy Zone Ready".
import type { ActionLabel } from "@/lib/finalRank";
import { detectTimeState, type TimeState } from "@/lib/novaBrain";

export type Bias = "bullish" | "bearish" | "neutral";

/** Display label for an action chip — varies by time state + bias. */
export function smartActionLabel(
  label: ActionLabel,
  opts: { bias?: Bias; timeState?: TimeState; score?: number } = {},
): string {
  const ts = opts.timeState ?? detectTimeState().state;
  const bias = opts.bias ?? "neutral";

  // Strong picks stay BUY NOW — only soften when price is hot.
  if (label === "BUY NOW") {
    if (ts === "premarket" || ts === "afterHours") return "Buy Zone Ready · open";
    return "BUY NOW";
  }

  if (label === "WATCHLIST") return "Watch Closely";
  if (label === "WATCHLIST ONLY") return "Watchlist Only";
  if (label === "WAIT PULLBACK") return "Wait for Pullback";
  if (label === "EXPENSIVE ENTRY") return "Expensive Entry";
  if (label === "OVEREXTENDED") return "Wait — Cool Off";

  if (label === "WAIT") {
    if (ts === "premarket" || ts === "weekend" || ts === "closed") return "Wait for Open";
    if (ts === "openingHour") return "Wait for Confirmation";
    if (ts === "midday") return "Wait for Power Hour";
    if (bias === "bullish") return "Wait for Pullback";
    if (bias === "bearish") return "Wait for Breakdown";
    return "Watch Closely";
  }

  if (label === "AVOID") return "AVOID";
  if (label === "EXIT") return "EXIT";
  return label;
}

/** Tooltip copy explaining the smart action label. */
export function smartActionTooltip(
  label: ActionLabel,
  opts: { bias?: Bias; timeState?: TimeState } = {},
): string {
  const ts = opts.timeState ?? detectTimeState().state;
  switch (label) {
    case "BUY NOW":
      return ts === "premarket" || ts === "afterHours"
        ? "Conviction is high (≥ 80). Stage the order — execute at the regular-session open."
        : "High conviction — score ≥ 80. Take the trade now.";
    case "WATCHLIST":      return "Solid setup — score 70-79. Confirm the entry trigger before sizing in.";
    case "WATCHLIST ONLY": return "Decent setup but one concern (liquidity / IV / no edge). Track, don't trade.";
    case "WAIT PULLBACK":  return "Strong thesis but price is extended. Wait for a pullback to support before entering.";
    case "EXPENSIVE ENTRY":return "Thesis is good but the strike is deep ITM — capital-inefficient. Look for a cheaper one.";
    case "OVEREXTENDED":   return "Already up big today — chase risk. Let it cool off before entering.";
    case "WAIT":
      if (ts === "premarket" || ts === "weekend" || ts === "closed") return "Market closed — verdict is staged. Confirm at the regular-session open.";
      if (ts === "openingHour") return "Opening hour — wait for volume + range break to confirm direction.";
      if (ts === "midday") return "Midday chop — directional edges fade. Reassess into the power hour.";
      return "Mixed signals — score 50-69. Monitor, no action yet.";
    case "AVOID":          return "Avoid — bearish setup or hard-blocked (liquidity / IV trap / earnings binary).";
    case "EXIT":           return "Exit — held position has tripped a safety rule.";
  }
}

/** Empty-state copy by risk bucket — never blank, always actionable. */
export function emptyStateCopy(
  bucket: "safe" | "mild" | "aggressive" | "lottery",
  ctx: { fallbackBucket?: string; isWeekendOrClosed?: boolean } = {},
): { headline: string; sub: string } {
  const closed = ctx.isWeekendOrClosed;
  switch (bucket) {
    case "safe":
      return {
        headline: closed ? "Conservative trades load at the open" : "Conservative setups are limited today",
        sub: closed
          ? "NOVA stages safe trades from overnight news. Live picks return when the market opens."
          : "The tape isn't offering high-probability income trades right now. Try Moderate for a stronger menu.",
      };
    case "mild":
      return {
        headline: closed ? "Moderate ideas load at the open" : "Moderate menu is thin right now",
        sub: closed
          ? "Swing setups are best graded on live tape. NOVA will refresh when the bell rings."
          : "Most directional swings need a fresh trigger today. Conservative income trades may be cleaner.",
      };
    case "aggressive":
      return {
        headline: closed ? "Aggressive plays load at the open" : "Aggressive setups are quiet",
        sub: closed
          ? "High-beta names need live volume to grade. Check back at 9:30 ET."
          : "Momentum is flat. Look at the Watchlist for tomorrow's runners or downshift to Moderate.",
      };
    case "lottery":
      return {
        headline: closed ? "Lottos return at the open" : "No clean lotto setups right now",
        sub: closed
          ? "Lotto ideas need today's gamma + flow. NOVA will surface them after the open."
          : "Lottos require a hot catalyst. None graded above the floor today — Moderate is healthier.",
      };
  }
}
