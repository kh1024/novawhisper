// Black-Scholes-lite premium estimator.
//
// Why this exists: the scanner doesn't fetch real option chains for every
// candidate (60+ tickers × 4 strike rungs = 240 chain calls per scan, too
// expensive). Instead we estimate per-contract premium from spot, strike,
// IV (from setupRow.ivRank → IV%), DTE, and option type.
//
// The math is the closed-form Black-Scholes price (Hull, Ch. 14). Pure
// functions — no React, no I/O — so the strike-ladder picker can call this
// hundreds of times per scan with negligible cost.
//
// Risk-free rate r=4%, dividend yield q=0% (close enough for short-dated
// directional picks; the sub-cent error doesn't change which ladder rung
// fits a $500 cap).

const R = 0.04;
const Q = 0;

/** Standard normal CDF via Abramowitz–Stegun 7.1.26 (max abs err ~7.5e-8). */
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export interface EstimateInput {
  spot: number;
  strike: number;
  /** Implied vol as a fraction. e.g. 0.35 for 35%. */
  iv: number;
  /** Days to expiry. */
  dte: number;
  optionType: "call" | "put";
}

export interface EstimatedQuote {
  /** Per-share premium (mid). Multiply by 100 for total contract cost. */
  perShare: number;
  /** Approximate delta (signed, calls positive / puts negative in [-1,1]). */
  delta: number;
  /** True when inputs were too degenerate to trust. */
  degenerate: boolean;
}

export function estimatePremium(input: EstimateInput): EstimatedQuote {
  const { spot, strike, optionType } = input;
  const iv = Math.max(0.05, Math.min(3, input.iv));   // clamp 5%–300%
  const dte = Math.max(1, input.dte);
  const T = dte / 365;

  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(strike) || strike <= 0) {
    return { perShare: 0, delta: 0, degenerate: true };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (R - Q + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);

  let price: number;
  let delta: number;
  if (optionType === "call") {
    price = spot * Math.exp(-Q * T) * Nd1 - strike * Math.exp(-R * T) * Nd2;
    delta = Math.exp(-Q * T) * Nd1;
  } else {
    price = strike * Math.exp(-R * T) * (1 - Nd2) - spot * Math.exp(-Q * T) * (1 - Nd1);
    delta = -Math.exp(-Q * T) * (1 - Nd1);
  }

  // Floor at intrinsic + 1 cent so deep ITM never returns negative noise.
  const intrinsic = Math.max(0, optionType === "call" ? spot - strike : strike - spot);
  const perShare = Math.max(intrinsic + 0.01, price);

  return {
    perShare: +perShare.toFixed(2),
    delta: +delta.toFixed(3),
    degenerate: false,
  };
}

/**
 * Sanity check for premiums coming back from any source (estimator OR a real
 * chain). If the per-share premium exceeds 50% of the underlying price, the
 * data is almost certainly bogus (e.g. confused strike with premium, decimal
 * unit mistake, stale chain returning lastPrice as premium).
 */
export function isPremiumSuspect(perShare: number, spot: number): boolean {
  if (!Number.isFinite(perShare) || !Number.isFinite(spot) || spot <= 0) return true;
  return perShare > spot * 0.5;
}

/** Convert IV Rank (0–100, percentile of last year's IV range) to a usable
 *  IV %. We don't know the true IV without a chain, so we model the rank as
 *  a position inside a 20%–90% band — good enough for premium ranking among
 *  ladder rungs. */
export function ivRankToIv(ivRank: number): number {
  const r = Math.max(0, Math.min(100, ivRank)) / 100;
  return 0.20 + r * 0.70;
}
