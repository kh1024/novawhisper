// Bucketing — universe presets the Scanner can swap on the fly.
//
// "Conservative" used to map exclusively to Deep-ITM blue chips (SPY, QQQ,
// AAPL, MSFT) where a single contract runs $1,500–$4,000 because the bulk of
// the premium is intrinsic. That excludes most small-account users by design.
//
// "Conservative-Cheap" is the same risk profile (Δ 0.70–0.85 ITM calls,
// 45–90 DTE, defined max loss = premium) but rotated onto sub-$50 underlyings
// where one contract typically costs $200–$800.
//
// Both paths are labeled "Conservative" to the user; the bucketing engine
// picks the right one based on profile.accountSize / maxPerTradePct.

/** Sub-$50 conservative universe — large-cap-but-cheap names with deep
 *  options chains so Δ 0.75 ITM calls still have penny spreads. */
export const CONSERVATIVE_CHEAP_TICKERS = [
  "SOFI", "F", "PLTR", "RIVN", "BAC", "T", "XLF", "KRE",
  "INTC", "PFE", "WBD", "NIO", "LCID", "CCL", "AAL", "UBER",
] as const;

/** Blue-chip Deep-ITM universe — the original Conservative path. */
export const CONSERVATIVE_BLUECHIP_TICKERS = [
  "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
] as const;

export type ConservativePath = "blue-chip" | "cheap";

/**
 * Decide which Conservative universe fits the user's wallet.
 *
 * Rule: if the per-trade cap is below ~$1,500 (the lowest typical Deep-ITM
 * blue-chip premium), force the cheap path. Otherwise let blue chips through.
 */
export function pickConservativePath(perTradeCapDollars: number): ConservativePath {
  return perTradeCapDollars < 1500 ? "cheap" : "blue-chip";
}

export function isConservativeCheapTicker(symbol: string): boolean {
  return (CONSERVATIVE_CHEAP_TICKERS as readonly string[]).includes(symbol.toUpperCase());
}
