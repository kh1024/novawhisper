// Adapter — turn a ScoutPick + live data into the SignalInput the gate
// pipeline expects, then run validateSignal. Pure function so the result is
// memoizable in callers. Pulls the user's portfolio size for the new
// Affordability gate (Gate 8) and pivots stale expiries to the nearest
// liquid monthly so a "play this on 2025-04-19" pick doesn't survive past
// April 19.
import type { ScoutPick } from "@/lib/optionsScout";
import type { VerifiedQuote } from "@/lib/liveData";
import type { SymbolSma } from "@/lib/sma200";
import type { PortfolioPosition } from "@/lib/portfolio";
import { validateSignal, type ValidationResult, type SignalInput, type OptionType } from "@/lib/gates";
import { syncExpiry } from "@/lib/gates/expiryDate";

interface PickGateOpts {
  pick: ScoutPick;
  quote?: VerifiedQuote | null;
  sma?: SymbolSma | null;
  /** IV percentile 0-100 if we have it (otherwise a neutral default). */
  ivPercentile?: number | null;
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
  const { pick, quote, sma, ivPercentile, position, currentPremium, accountBalance, contracts } = opts;
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

  const input: SignalInput = {
    ticker: pick.symbol,
    optionType,
    strikePrice: Number(pick.strike),
    currentPrice: livePrice,
    entryPremium,
    currentPremium: currentPremium ?? entryPremium,
    quoteTimestamp: quote?.updatedAt ? new Date(quote.updatedAt) : new Date(),
    liveFeedPrice: livePrice,
    rsi14: 55,                                      // unknown — neutral default
    streakDays: 1,                                  // unknown — neutral default
    sma200: sma?.sma200 ?? livePrice,               // when unknown, no constraint
    ivPercentile: ivPercentile ?? 50,
    marketTime: new Date(),
    delta: pick.strategy.toLowerCase().includes("leaps") ? 0.85 : 0.55,
    accountBalance: accountBalance ?? 0,
    contracts: contracts ?? 1,
    grade: pick.grade,
    expiryDate: sync.expiry,
  };

  return validateSignal(input);
}
