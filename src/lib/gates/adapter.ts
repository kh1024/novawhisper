// Adapter — turn a ScoutPick + live data into the SignalInput the gate
// pipeline expects, then run validateSignal. Pure function so the result is
// memoizable in callers. Pulls the user's portfolio size for the new
// Affordability gate (Gate 8) and pivots stale expiries to the nearest
// liquid monthly so a "play this on 2025-04-19" pick doesn't survive past
// April 19.
import type { ScoutPick } from "@/lib/optionsScout";
import type { VerifiedQuote, OptionContract } from "@/lib/liveData";
import type { SymbolSma } from "@/lib/sma200";
import type { PortfolioPosition } from "@/lib/portfolio";
import { validateSignal, type ValidationResult, type SignalInput, type OptionType } from "@/lib/gates";
import { syncExpiry } from "@/lib/gates/expiryDate";
import { computeStreakDays, computeRSI14 } from "@/lib/streak";
import { ivpFromChain, pickAtmContract } from "@/lib/ivPercentile";

interface PickGateOpts {
  pick: ScoutPick;
  quote?: VerifiedQuote | null;
  sma?: SymbolSma | null;
  /**
   * IV percentile 0-100. Used ONLY if no live `chain` is provided.
   * When `chain` is present it overrides this value.
   */
  ivPercentile?: number | null;
  /** Live options chain — when provided, drives a real IVP for Gate 6. */
  chain?: OptionContract[] | null;
  /** Optional held position — enables Gate 7. */
  position?: PortfolioPosition | null;
  /** Optional current option premium (for held positions). */
  currentPremium?: number | null;
  /** User portfolio size in dollars — drives Gate 8. */
  accountBalance?: number | null;
  /** Number of contracts being sized (default 1). */
  contracts?: number | null;
}

// Same loose-parser used in /planning — pulls the lowest dollar value out of
// a Nova-style premium string ("$2.50", "$1.20–$1.50", "≈$3").
function parsePremiumEstimate(s?: string | null): number | null {
  if (!s) return null;
  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  const v = Math.min(...nums.map(Number));
  return Number.isFinite(v) ? v : null;
}

/** Convert a scout pick to the gate pipeline's input + run it. */
export function validatePick(opts: PickGateOpts): ValidationResult {
  const { pick, quote, sma, ivPercentile, chain, position, currentPremium, accountBalance, contracts } = opts;
  const livePrice = quote?.price ?? pick.playAt;
  const optionType: OptionType = pick.optionType === "put" ? "PUT" : "CALL";

  // Date sync: if the pick's expiry already passed, pivot to nearest monthly.
  const sync = syncExpiry(pick.expiry);

  // Best-effort entry premium: prefer a real saved position, otherwise parse
  // the Nova `premiumEstimate` string. Falls back to 0 (Gate 8 then no-ops).
  const parsedPremium = parsePremiumEstimate(pick.premiumEstimate);
  const entryPremium = position?.entry_premium != null
    ? Number(position.entry_premium)
    : (parsedPremium ?? 0);

  // ── Real IVP for Gate 6 ──
  // Priority:
  //   1. Caller-supplied `ivPercentile` (e.g. true 52-week IVP from
  //      iv_history when ≥60 samples exist — see useResolvedIvp below).
  //   2. Chain-envelope IVP (ATM IV vs. live chain min/max).
  //   3. Neutral 50 with a one-shot warning.
  const callerIvpValid = ivPercentile != null && Number.isFinite(ivPercentile);
  const chainIvp = callerIvpValid ? null : ivpFromChain(chain ?? null, livePrice, pick.optionType);
  let resolvedIvp: number;
  if (callerIvpValid) {
    resolvedIvp = ivPercentile as number;
  } else if (chainIvp) {
    resolvedIvp = chainIvp.ivp;
  } else {
    resolvedIvp = 50;
    if (typeof console !== "undefined") {
      console.warn(`[gates/adapter] No live chain for ${pick.symbol} — IVP defaulted to neutral 50.`);
    }
  }

  // ── Real Delta for Gate sizing ──
  // Prefer the ATM contract's delta from the live chain. Fall back to the old
  // strategy-based heuristic only when no chain data is present.
  const heuristicDelta = pick.strategy.toLowerCase().includes("leaps") ? 0.85 : 0.55;
  let resolvedDelta: number = heuristicDelta;
  if (chain && chain.length > 0 && livePrice > 0) {
    const atm = pickAtmContract(chain, livePrice, pick.optionType);
    if (atm?.delta != null && Number.isFinite(atm.delta)) {
      resolvedDelta = atm.delta as number;
    }
  }

  const input: SignalInput = {
    ticker: pick.symbol,
    optionType,
    strikePrice: Number(pick.strike),
    currentPrice: livePrice,
    entryPremium,
    currentPremium: currentPremium ?? entryPremium,
    quoteTimestamp: quote?.updatedAt ? new Date(quote.updatedAt) : new Date(),
    liveFeedPrice: livePrice,
    rsi14: computeRSI14(sma?.closes ?? []),         // real Wilder RSI from daily closes
    streakDays: computeStreakDays(sma?.closes ?? []), // real consecutive green-day count
    sma200: sma?.sma200 ?? livePrice,               // when unknown, no constraint
    ivPercentile: resolvedIvp,
    marketTime: new Date(),
    delta: resolvedDelta,
    accountBalance: accountBalance ?? 0,
    contracts: contracts ?? 1,
    grade: pick.grade,
    expiryDate: sync.expiry,
  };

  return validateSignal(input);
}

