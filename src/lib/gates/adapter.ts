// Adapter — turn a ScoutPick + live data into the SignalInput the gate
// pipeline expects, then run validateSignal. Pure function so the result is
// memoizable in callers.
import type { ScoutPick } from "@/lib/optionsScout";
import type { VerifiedQuote } from "@/lib/liveData";
import type { SymbolSma } from "@/lib/sma200";
import type { PortfolioPosition } from "@/lib/portfolio";
import { validateSignal, type ValidationResult, type SignalInput, type OptionType } from "@/lib/gates";

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
}

/** Convert a scout pick to the gate pipeline's input + run it. */
export function validatePick(opts: PickGateOpts): ValidationResult {
  const { pick, quote, sma, ivPercentile, position, currentPremium } = opts;
  const livePrice = quote?.price ?? pick.playAt;
  const optionType: OptionType = pick.optionType === "put" ? "PUT" : "CALL";

  const input: SignalInput = {
    ticker: pick.symbol,
    optionType,
    strikePrice: Number(pick.strike),
    currentPrice: livePrice,
    entryPremium: position?.entry_premium != null ? Number(position.entry_premium) : 0,
    currentPremium: currentPremium ?? (position?.entry_premium != null ? Number(position.entry_premium) : 0),
    // Treat the cached pick's playAt as the "internal" price; live quote as the feed.
    quoteTimestamp: quote?.fetchedAt ? new Date(quote.fetchedAt) : new Date(),
    liveFeedPrice: livePrice,
    rsi14: 55,                                      // unknown — neutral default
    streakDays: 1,                                  // unknown — neutral default
    sma200: sma?.sma200 ?? livePrice,               // when unknown, treat as no constraint
    ivPercentile: ivPercentile ?? 50,               // neutral when unknown
    marketTime: new Date(),
    delta: pick.strategy.toLowerCase().includes("leaps") ? 0.85 : 0.55,
  };

  return validateSignal(input);
}
