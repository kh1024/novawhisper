// Trading fees applied to options P&L.
// Defaults match Robinhood: $0 commission + ~$0.03/contract regulatory pass-through (ORF + OCC + SEC + FINRA TAF).
// Fees are charged on BOTH sides (entry + exit), so a round-trip = 2× one-side cost.
import type { AppSettings } from "./settings";

export interface FeeBreakdown {
  oneSide: number;       // dollars charged at one fill (entry OR exit)
  roundTrip: number;     // 2× oneSide — total cost to open + close
}

/** Cost of one fill (entry OR exit) for `contracts` contracts under current settings. */
export function feeOneSide(settings: AppSettings, contracts: number): number {
  const perContract = (settings.feePerContract ?? 0) + (settings.regulatoryFeePerContract ?? 0);
  return perContract * contracts + (settings.feePerTrade ?? 0);
}

/** Round-trip fees (open + close). Use for realized P&L. */
export function feeRoundTrip(settings: AppSettings, contracts: number): number {
  return 2 * feeOneSide(settings, contracts);
}

export function feeBreakdown(settings: AppSettings, contracts: number): FeeBreakdown {
  const one = feeOneSide(settings, contracts);
  return { oneSide: one, roundTrip: 2 * one };
}
