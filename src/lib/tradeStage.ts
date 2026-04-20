// Trade State Machine — single source of truth for "what state is this idea
// or position in?". Drives card styling, button availability, and whether the
// exit engine is even allowed to evaluate stops/targets.
//
// Scanner candidates:
//   WATCH_ONLY → SETUP_FORMING → CONFIRMATION_PENDING → ENTRY_CONFIRMED
//   (any) → OPEN_POSITION on user "Add to Portfolio"
//
// Portfolio rows always live in OPEN_POSITION → EXIT_MANAGEMENT → CLOSED.

import type { TradeStatusResult } from "@/lib/tradeStatus";

export type TradeStage =
  | "WATCH_ONLY"
  | "SETUP_FORMING"
  | "CONFIRMATION_PENDING"
  | "ENTRY_CONFIRMED"
  | "OPEN_POSITION"
  | "EXIT_MANAGEMENT"
  | "CLOSED";

/** Map the existing TradeStatus middleware result into a TradeStage for
 *  scanner cards. We keep this as the single bridge so we don't touch the
 *  setup/scoring pipeline. */
export function tradeStageFromStatus(
  status: TradeStatusResult,
  preMarket: boolean,
  hasContract: boolean,
): TradeStage {
  if (preMarket) return "WATCH_ONLY";
  if (!hasContract) return "WATCH_ONLY";
  if (status.tradeStatus === "Skip") return "WATCH_ONLY";
  if (status.tradeStatus === "WatchlistOnly") {
    // Direction Waiting + no critical reject = still forming.
    if (status.direction === "Waiting") return "CONFIRMATION_PENDING";
    return "CONFIRMATION_PENDING";
  }
  // TradeReady → all gates green.
  return "ENTRY_CONFIRMED";
}

export const STAGE_LABEL: Record<TradeStage, string> = {
  WATCH_ONLY:           "Watch Only",
  SETUP_FORMING:        "Setup Forming",
  CONFIRMATION_PENDING: "Wait for Confirmation",
  ENTRY_CONFIRMED:      "Entry Confirmed",
  OPEN_POSITION:        "Open Position",
  EXIT_MANAGEMENT:      "Managing Exit",
  CLOSED:               "Closed",
};

export const STAGE_TONE: Record<TradeStage, "muted" | "warning" | "bullish" | "bearish"> = {
  WATCH_ONLY:           "muted",
  SETUP_FORMING:        "muted",
  CONFIRMATION_PENDING: "warning",
  ENTRY_CONFIRMED:      "bullish",
  OPEN_POSITION:        "bullish",
  EXIT_MANAGEMENT:      "warning",
  CLOSED:               "muted",
};

export const STAGE_CLASSES: Record<TradeStage, string> = {
  WATCH_ONLY:           "border-border bg-muted/30 text-muted-foreground",
  SETUP_FORMING:        "border-border bg-muted/30 text-muted-foreground",
  CONFIRMATION_PENDING: "border-warning/40 bg-warning/10 text-warning",
  ENTRY_CONFIRMED:      "border-bullish/50 bg-bullish/15 text-bullish",
  OPEN_POSITION:        "border-bullish/40 bg-bullish/10 text-bullish",
  EXIT_MANAGEMENT:      "border-warning/40 bg-warning/10 text-warning",
  CLOSED:               "border-border bg-surface/40 text-muted-foreground",
};

/** Card-level visual treatment — how strongly should the whole card glow? */
export const STAGE_CARD_RING: Record<TradeStage, string> = {
  WATCH_ONLY:           "",
  SETUP_FORMING:        "",
  CONFIRMATION_PENDING: "ring-1 ring-warning/30",
  ENTRY_CONFIRMED:      "ring-2 ring-bullish/40 shadow-[0_0_16px_-4px_hsl(var(--bullish)/0.35)]",
  OPEN_POSITION:        "ring-1 ring-bullish/30",
  EXIT_MANAGEMENT:      "ring-1 ring-warning/30",
  CLOSED:               "",
};

/** Plain-English subtext for each stage. Used on cards and tooltips. */
export const STAGE_SUBTEXT: Record<TradeStage, string> = {
  WATCH_ONLY:           "Idea only. Conditions not checked yet.",
  SETUP_FORMING:        "Thesis detected. Waiting for the open to validate.",
  CONFIRMATION_PENDING: "Wait for confirmation — see required conditions below.",
  ENTRY_CONFIRMED:      "Direction + volume + liquidity confirmed. Trade is eligible.",
  OPEN_POSITION:        "You hold this contract. Exit guidance is armed.",
  EXIT_MANAGEMENT:      "Stop or target zone — pay attention.",
  CLOSED:               "Position is closed.",
};

/** Are buttons that initiate a real BUY allowed in this stage? */
export function isExecutableStage(stage: TradeStage): boolean {
  return stage === "ENTRY_CONFIRMED";
}

/** Should we render the "Add to Portfolio" button? Only when eligible. */
export function canAddToPortfolio(stage: TradeStage): boolean {
  return stage === "ENTRY_CONFIRMED";
}

/** Build the explicit list of conditions the user is waiting on, derived
 *  from the existing TradeStatus middleware. */
export function pendingConditions(status: TradeStatusResult): string[] {
  const out: string[] = [];
  if (status.direction === "Waiting") out.push("Direction must align with intraday momentum (price + RSI).");
  if (status.volume === "Weak")        out.push("Relative volume must be ≥ 0.8× average for this time of day.");
  if (status.gap === "DoNotChase")     out.push("Wait for a pullback to VWAP / opening-range high.");
  if (status.budget === "OverCap")     out.push("Trade size exceeds your per-trade budget cap.");
  if (status.liquidity === "Thin")     out.push("Options chain too thin — wait for tighter spreads / more OI.");
  if (out.length === 0) out.push("Pre-market window — re-validate after 9:35 AM ET.");
  return out;
}
