// ─── EXECUTION SCORE ─────────────────────────────────────────────────────────
// Grades whether it is a good time to enter RIGHT NOW.
// Separate from setup quality and contract quality.
//
// Returns 0–100. Below 50 = not Buy Now. Below 30 = Watchlist / Needs Recheck.

import { getSessionMode } from "@/lib/marketHours";
import { QUOTE_THRESHOLDS } from "@/lib/quotes/quoteProvider";
import type { NormalizedUnderlyingQuote } from "@/lib/quotes/quoteTypes";

export interface ExecutionScoreInput {
  currentPrice: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  snapshotPrice: number;
  relativeVolume: number;
  liveTriggerConfirmed: boolean;
  quoteAgeSeconds: number;
  quoteConfidenceScore: number;
  daysToEarnings?: number;
  majorEventToday: boolean;
  eventName?: string;
  currentHourET: number;
  underlyingQuote: NormalizedUnderlyingQuote;
  vix?: number;
  dte: number;
}

export interface ExecutionComponent {
  label: string;
  points: number;
  note: string;
}

export interface ExecutionScoreResult {
  execution_score: number;
  execution_label: "TRADE_READY" | "WATCH_FOR_TRIGGER" | "NEEDS_RECHECK" | "AVOID_ENTRY";
  session_mode: string;
  price_vs_zone: "INSIDE" | "BELOW" | "EXTENDED" | "TOO_EXTENDED";
  trigger_confirmed: boolean;
  volume_confirmed: boolean;
  quote_fresh_enough: boolean;
  session_allows_buy_now: boolean;
  score_components: ExecutionComponent[];
  plain_english_reason: string;
}

export function computeExecutionScore(input: ExecutionScoreInput): ExecutionScoreResult {
  const {
    currentPrice, entryZoneLow, entryZoneHigh,
    relativeVolume, liveTriggerConfirmed,
    quoteAgeSeconds, quoteConfidenceScore,
    daysToEarnings, majorEventToday, eventName, currentHourET,
    vix, dte,
  } = input;

  const components: ExecutionComponent[] = [];
  let score = 50;

  const sessionMode = getSessionMode();
  let sessionAllowsBuyNow = sessionMode === "MARKET_OPEN";

  switch (sessionMode) {
    case "MARKET_OPEN":
      components.push({ label: "Session", points: 0, note: "Market open — live entry valid" });
      break;
    case "PRE_MARKET":
      score -= 30; sessionAllowsBuyNow = false;
      components.push({ label: "Session", points: -30, note: "Pre-market — option pricing unreliable, holding as Watchlist" });
      break;
    case "AFTER_HOURS":
      score -= 35; sessionAllowsBuyNow = false;
      components.push({ label: "Session", points: -35, note: "After hours — no reliable option quotes, no Buy Now" });
      break;
    case "CLOSED":
      score -= 50; sessionAllowsBuyNow = false;
      components.push({ label: "Session", points: -50, note: "Market closed — planning mode only" });
      break;
  }

  // Price vs entry zone
  let priceVsZone: ExecutionScoreResult["price_vs_zone"];
  if (entryZoneLow > 0 && entryZoneHigh > 0) {
    if (currentPrice >= entryZoneLow && currentPrice <= entryZoneHigh) {
      score += 18; priceVsZone = "INSIDE";
      components.push({ label: "Entry Zone", points: 18, note: `Price $${currentPrice.toFixed(2)} is inside entry zone $${entryZoneLow.toFixed(2)}–$${entryZoneHigh.toFixed(2)}` });
    } else if (currentPrice < entryZoneLow) {
      score -= 5; priceVsZone = "BELOW";
      components.push({ label: "Entry Zone", points: -5, note: `Price $${currentPrice.toFixed(2)} below entry zone — wait for move up into zone` });
    } else {
      const extensionPct = (currentPrice - entryZoneHigh) / entryZoneHigh;
      if (extensionPct <= 0.02) {
        score -= 8; priceVsZone = "EXTENDED";
        components.push({ label: "Entry Zone", points: -8, note: `Price ${(extensionPct * 100).toFixed(1)}% above entry zone — slightly extended` });
      } else {
        score -= 22; priceVsZone = "TOO_EXTENDED";
        components.push({ label: "Entry Zone", points: -22, note: `Price ${(extensionPct * 100).toFixed(1)}% above entry zone — chasing. Do not enter.` });
      }
    }
  } else {
    priceVsZone = "INSIDE";
  }

  // Trigger
  if (liveTriggerConfirmed) {
    score += 15;
    components.push({ label: "Live Trigger", points: 15, note: "Entry trigger confirmed — breakout or level cross active" });
  } else {
    score -= 15;
    components.push({ label: "Live Trigger", points: -15, note: "Live trigger not confirmed — setup exists but entry signal not fired yet" });
  }

  // Relative volume
  let volumeConfirmed = false;
  if (relativeVolume >= 2.0) { score += 14; volumeConfirmed = true; components.push({ label: "Rel. Volume", points: 14, note: `${relativeVolume.toFixed(1)}× avg volume — strong conviction` }); }
  else if (relativeVolume >= 1.5) { score += 10; volumeConfirmed = true; components.push({ label: "Rel. Volume", points: 10, note: `${relativeVolume.toFixed(1)}× avg volume — good confirmation` }); }
  else if (relativeVolume >= 1.2) { score += 4; volumeConfirmed = true; components.push({ label: "Rel. Volume", points: 4, note: `${relativeVolume.toFixed(1)}× avg volume — moderate, acceptable` }); }
  else if (relativeVolume >= 0.8) { score -= 5; components.push({ label: "Rel. Volume", points: -5, note: `${relativeVolume.toFixed(1)}× avg volume — below average, weak confirmation` }); }
  else { score -= 15; components.push({ label: "Rel. Volume", points: -15, note: `${relativeVolume.toFixed(1)}× avg volume — very low, no conviction` }); }

  // Quote freshness
  let quoteFreshEnough = false;
  if (quoteAgeSeconds <= QUOTE_THRESHOLDS.REAL_TIME_MAX_SEC) { score += 8; quoteFreshEnough = true; components.push({ label: "Quote Age", points: 8, note: `${quoteAgeSeconds.toFixed(0)}s old — real-time` }); }
  else if (quoteAgeSeconds <= QUOTE_THRESHOLDS.FRESH_MAX_SEC) { score += 4; quoteFreshEnough = true; components.push({ label: "Quote Age", points: 4, note: `${quoteAgeSeconds.toFixed(0)}s old — fresh enough` }); }
  else if (quoteAgeSeconds <= QUOTE_THRESHOLDS.DELAYED_MAX_SEC) { score -= 10; components.push({ label: "Quote Age", points: -10, note: `${quoteAgeSeconds.toFixed(0)}s old — delayed` }); }
  else { score -= 25; components.push({ label: "Quote Age", points: -25, note: `${quoteAgeSeconds.toFixed(0)}s old — stale, do not enter on this data` }); }

  // Quote confidence
  if (quoteConfidenceScore >= 85) { score += 6; components.push({ label: "Quote Confidence", points: 6, note: `${quoteConfidenceScore}/100 — high confidence data` }); }
  else if (quoteConfidenceScore >= 65) { components.push({ label: "Quote Confidence", points: 0, note: `${quoteConfidenceScore}/100 — acceptable` }); }
  else if (quoteConfidenceScore >= 40) { score -= 12; components.push({ label: "Quote Confidence", points: -12, note: `${quoteConfidenceScore}/100 — low confidence, verify before trading` }); }
  else { score -= 25; components.push({ label: "Quote Confidence", points: -25, note: `${quoteConfidenceScore}/100 — very low confidence, do not trade on this` }); }

  // Earnings
  if (daysToEarnings !== undefined) {
    if (daysToEarnings <= 1) { score -= 35; components.push({ label: "Earnings Risk", points: -35, note: `Earnings today or tomorrow — IV crush risk. Do not enter.` }); }
    else if (daysToEarnings <= 3) { score -= 20; components.push({ label: "Earnings Risk", points: -20, note: `Earnings in ${daysToEarnings} days — high IV crush risk for swing options` }); }
    else if (daysToEarnings <= 7) { score -= 10; components.push({ label: "Earnings Risk", points: -10, note: `Earnings in ${daysToEarnings} days — elevated risk, size down` }); }
  }

  if (majorEventToday && currentHourET >= 13) {
    score -= 20;
    components.push({ label: "Macro Event", points: -20, note: `${eventName ?? "Major event"} today — no new entries after 1 PM ET` });
  }

  if (vix !== undefined) {
    if (vix > 30) { score -= 15; components.push({ label: "VIX", points: -15, note: `VIX ${vix.toFixed(1)} > 30 — extreme fear, buying premium is expensive` }); }
    else if (vix > 25) { score -= 8; components.push({ label: "VIX", points: -8, note: `VIX ${vix.toFixed(1)} — elevated, size down` }); }
    else if (vix < 15) { score += 5; components.push({ label: "VIX", points: 5, note: `VIX ${vix.toFixed(1)} — calm, good environment for directional plays` }); }
  }

  if (dte < 14 && !liveTriggerConfirmed) {
    score -= 15;
    components.push({ label: "Short DTE Risk", points: -15, note: `${dte} DTE with no confirmed trigger — theta will destroy this quickly` });
  }

  score = Math.max(0, Math.min(100, score));
  const executionLabel: ExecutionScoreResult["execution_label"] =
    score >= 70 && sessionAllowsBuyNow ? "TRADE_READY" :
    score >= 45 ? "WATCH_FOR_TRIGGER" :
    score >= 25 ? "NEEDS_RECHECK" : "AVOID_ENTRY";

  const plainEnglishReason = buildExecutionReason(
    executionLabel, sessionMode, priceVsZone,
    liveTriggerConfirmed, volumeConfirmed, quoteFreshEnough,
    daysToEarnings, majorEventToday, eventName,
  );

  return {
    execution_score: score,
    execution_label: executionLabel,
    session_mode: sessionMode,
    price_vs_zone: priceVsZone,
    trigger_confirmed: liveTriggerConfirmed,
    volume_confirmed: volumeConfirmed,
    quote_fresh_enough: quoteFreshEnough,
    session_allows_buy_now: sessionAllowsBuyNow,
    score_components: components,
    plain_english_reason: plainEnglishReason,
  };
}

function buildExecutionReason(
  label: string, session: string, priceZone: string,
  trigger: boolean, volume: boolean, fresh: boolean,
  earnings?: number, eventToday?: boolean, eventName?: string,
): string {
  if (session === "CLOSED") return "Market closed — planning mode only, no live entry.";
  if (session === "AFTER_HOURS") return "After hours — option conditions unreliable. Review tomorrow.";
  if (session === "PRE_MARKET") return "Pre-market — setup valid but waiting for open to confirm quote.";
  if (earnings !== undefined && earnings <= 1) return "Earnings today or tomorrow — IV crush risk, avoid entering.";
  if (eventToday) return `${eventName ?? "Major macro event"} today — no entries after 1 PM ET.`;
  if (priceZone === "TOO_EXTENDED") return "Price is too extended past entry zone — chasing here is a mistake.";
  if (!fresh) return "Quote is stale — refresh data before considering entry.";
  if (!trigger && !volume) return "Good setup, but live trigger not confirmed and volume not yet there.";
  if (!trigger) return "Setup is solid but live trigger is not confirmed yet. Watch for entry signal.";
  if (!volume) return "Trigger confirmed but volume not confirming the move yet.";
  if (priceZone === "EXTENDED") return "Slightly extended past ideal entry zone — wait for a small pullback.";
  if (label === "TRADE_READY") return "Trigger confirmed, volume confirming, price in zone, quote fresh. Entry is live.";
  return "Setup looks good, watching for final entry confirmation.";
}
