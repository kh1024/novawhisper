// ─── QUOTE INTEGRITY ENGINE ──────────────────────────────────────────────────
// Validates quote quality and produces a full integrity report.
// Called for every scanner candidate BEFORE classification (BUY NOW vs WATCHLIST
// vs BLOCKED). The report is attached to the ApprovedPick so the UI and the
// QuoteDebugPanel can render the exact reasons each pick landed where it did.

import {
  fetchBestUnderlyingQuote,
  fetchBestOptionQuote,
  QUOTE_THRESHOLDS,
} from "./quoteProvider";
import type {
  QuoteIntegrityReport,
  NormalizedOptionQuote,
  NormalizedUnderlyingQuote,
} from "./quoteTypes";

export interface IntegrityInput {
  symbol: string;
  contractSymbol: string;
  /** Underlying price when the setup was first scored. */
  snapshotUnderlyingPrice: number;
  /** User per-trade budget cap in dollars. */
  userBudgetCap: number;
}

export async function runQuoteIntegrity(
  input: IntegrityInput,
): Promise<QuoteIntegrityReport> {
  const { symbol, contractSymbol, snapshotUnderlyingPrice, userBudgetCap } = input;

  const [underlyingResult, optionResult] = await Promise.all([
    fetchBestUnderlyingQuote(symbol),
    fetchBestOptionQuote(contractSymbol),
  ]);

  const { quote: underlyingQuote, conflict: underlyingConflict } = underlyingResult;
  const { quote: optionQuote,     conflict: optionConflict }     = optionResult;

  const blockReasons: string[] = [];
  const warnReasons:  string[] = [];

  // ── UNDERLYING CHECKS ────────────────────────────────────────────────────
  if (underlyingQuote.status === "MISSING") {
    blockReasons.push("Underlying quote unavailable — cannot validate setup.");
  } else if (underlyingQuote.status === "STALE") {
    blockReasons.push(
      `Underlying quote is stale (${underlyingQuote.quoteAgeSeconds.toFixed(0)}s old). Refresh before trading.`,
    );
  } else if (underlyingQuote.status === "DELAYED") {
    warnReasons.push(
      `Underlying quote is delayed (${underlyingQuote.quoteAgeSeconds.toFixed(0)}s old).`,
    );
  }

  let underlyingMovePct = 0;
  let requiresRecalc = false;
  if (snapshotUnderlyingPrice > 0 && underlyingQuote.lastPrice > 0) {
    underlyingMovePct =
      Math.abs(underlyingQuote.lastPrice - snapshotUnderlyingPrice) / snapshotUnderlyingPrice;
    if (underlyingMovePct >= QUOTE_THRESHOLDS.UNDERLYING_MOVE_RECALC_PCT) {
      requiresRecalc = true;
      warnReasons.push(
        `Underlying moved ${(underlyingMovePct * 100).toFixed(2)}% since setup snapshot — entry zone, score, and affordability need recalc.`,
      );
    }
  }

  // ── OPTION CONTRACT CHECKS ───────────────────────────────────────────────
  if (optionQuote.status === "MISSING") {
    blockReasons.push("Option quote unavailable — no reliable bid/ask to use for entry.");
  }
  if (optionQuote.bid <= 0 || optionQuote.ask <= 0) {
    blockReasons.push("Invalid quote: bid or ask is zero or negative.");
  }
  if (optionQuote.ask < optionQuote.bid) {
    blockReasons.push("Crossed market: ask is lower than bid. Quote is invalid.");
  }
  if (optionQuote.status === "STALE" || optionQuote.quoteAgeSeconds > QUOTE_THRESHOLDS.DELAYED_MAX_SEC) {
    blockReasons.push(
      `Option quote is stale (${optionQuote.quoteAgeSeconds.toFixed(0)}s old). Last trade price is not a valid entry price.`,
    );
  } else if (optionQuote.status === "DELAYED") {
    warnReasons.push(
      `Option quote delayed (${optionQuote.quoteAgeSeconds.toFixed(0)}s old).`,
    );
  }

  if (optionQuote.spreadPct > QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT) {
    blockReasons.push(
      `Option spread too wide: ${(optionQuote.spreadPct * 100).toFixed(1)}% (>${(QUOTE_THRESHOLDS.SPREAD_SOFT_FAIL_PCT * 100).toFixed(0)}%). Fill quality will be poor.`,
    );
  } else if (optionQuote.spreadPct > QUOTE_THRESHOLDS.SPREAD_OK_PCT) {
    warnReasons.push(
      `Option spread is wide: ${(optionQuote.spreadPct * 100).toFixed(1)}%. Expect some slippage on fill.`,
    );
  }

  if (optionQuote.volume < QUOTE_THRESHOLDS.MIN_VOLUME_FLOOR && optionQuote.status !== "MISSING") {
    warnReasons.push(`Low option volume (${optionQuote.volume}). Liquidity may be thin.`);
  }
  if (optionQuote.openInterest < QUOTE_THRESHOLDS.MIN_OI_FLOOR && optionQuote.status !== "MISSING") {
    warnReasons.push(`Low open interest (${optionQuote.openInterest}). Market may be illiquid.`);
  }

  if (optionQuote.source === "BSLITE") {
    warnReasons.push(
      "Price estimated via model (BS-lite) — not a real market quote. Verify in your broker before trading.",
    );
  }

  if (optionQuote.dte > 0 && optionQuote.dte <= 7 && (optionQuote.iv === 0 || optionQuote.delta === 0)) {
    blockReasons.push("Greeks missing on short-dated contract (≤7 DTE). Cannot reliably assess risk.");
  }

  // ── PROVIDER CONFLICT CHECKS ─────────────────────────────────────────────
  const conflict = optionConflict.exists ? optionConflict : underlyingConflict;
  if (conflict.disagreementPct >= QUOTE_THRESHOLDS.CONFLICT_HARD_PCT) {
    blockReasons.push(
      `Provider conflict: ${conflict.primarySource} and ${conflict.secondarySource} disagree by ${(conflict.disagreementPct * 100).toFixed(2)}%. Cannot trust either quote.`,
    );
  } else if (conflict.disagreementPct >= QUOTE_THRESHOLDS.CONFLICT_WARN_PCT) {
    warnReasons.push(
      `Provider disagreement: ${(conflict.disagreementPct * 100).toFixed(2)}% difference between ${conflict.primarySource} and ${conflict.secondarySource}. Verify before trading.`,
    );
  }

  // ── BUDGET CHECK ─────────────────────────────────────────────────────────
  const estimatedFillCost = optionQuote.ask * 100;
  if (userBudgetCap > 0 && estimatedFillCost > userBudgetCap * 1.5) {
    blockReasons.push(
      `Contract cost $${estimatedFillCost.toFixed(0)} is ${((estimatedFillCost / userBudgetCap) * 100).toFixed(0)}% of your $${userBudgetCap} cap. Cannot label as affordable.`,
    );
  } else if (userBudgetCap > 0 && estimatedFillCost > userBudgetCap) {
    warnReasons.push(
      `Contract cost $${estimatedFillCost.toFixed(0)} exceeds your $${userBudgetCap} cap. Tight budget.`,
    );
  }

  const humanSummary = buildHumanSummary(blockReasons, warnReasons, optionQuote, underlyingQuote);

  return {
    underlyingQuote,
    optionQuote,
    providerConflict: conflict,
    underlyingMovedSinceSnapshot: requiresRecalc,
    underlyingMovePct,
    requiresRecalc,
    blockReasons,
    warnReasons,
    humanSummary,
  };
}

function buildHumanSummary(
  blocks: string[],
  warns: string[],
  option: NormalizedOptionQuote,
  underlying: NormalizedUnderlyingQuote,
): string {
  if (blocks.length === 0 && warns.length === 0) {
    return `Live data verified. Spread ${(option.spreadPct * 100).toFixed(1)}%, quote ${option.quoteAgeSeconds.toFixed(0)}s old, confidence ${option.quoteConfidenceScore}/100.`;
  }
  if (blocks.length > 0) return blocks[0];
  if (option.spreadPct > QUOTE_THRESHOLDS.SPREAD_OK_PCT) {
    return `Good setup, but option spread too wide for clean entry (${(option.spreadPct * 100).toFixed(1)}%).`;
  }
  if (option.quoteAgeSeconds > QUOTE_THRESHOLDS.FRESH_MAX_SEC) {
    return `Underlying is ${underlying.changePct >= 0 ? "bullish" : "bearish"}, but quote is stale. Refresh needed.`;
  }
  if (option.source === "BSLITE") {
    return "Last trade looks attractive, but current bid/ask is estimated. Verify in your broker.";
  }
  return warns[0];
}
