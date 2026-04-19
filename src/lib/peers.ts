// Peer-ticker map for the budget-aware swap.
//
// When a user's preferred contract on (say) AAPL costs $850 but their per-trade
// budget is $200, NOVA suggests a *correlated cheaper proxy* (e.g. XLK or F)
// whose typical contract premium fits the budget while keeping a similar
// directional thesis.
//
// Heuristic — not perfect correlation:
//   • Sector ETFs are listed first (highest correlation to the sector basket).
//   • Then liquid lower-priced peers in the same sector.
//   • Final fallback: SPY for broad-market exposure.
import { TICKER_UNIVERSE } from "./mockData";

/**
 * Curated peer order per sector. Cheapest-options-first so the swap engine
 * tries the most-likely-to-fit-budget candidates first.
 */
const SECTOR_PEERS: Record<string, string[]> = {
  // Big tech → tech ETF, then mid-cap names with cheaper options
  Tech: ["XLK", "QQQ", "PLTR", "UBER", "F"],
  // Semis → semi ETF, then cheaper chip names
  Semis: ["SMH", "INTC", "MU", "MRVL", "AMD"],
  Financials: ["XLF", "BAC", "WFC", "F"],
  Energy: ["XLE", "OXY", "SLB", "F"],
  Healthcare: ["XLV", "PFE", "MRK"],
  Consumer: ["XLY", "F", "NKE", "DIS"],
  Industrials: ["XLI", "GE", "F"],
  Auto: ["F", "GM", "RIVN"],
  ETF: ["SPY", "QQQ", "F"],
};

const META = new Map(TICKER_UNIVERSE.map((u) => [u.symbol, u]));

export interface PeerCandidate {
  symbol: string;
  name?: string;
  approxPrice: number;
  /** Rough estimated single-contract premium (price × ~0.05 for ATM). */
  estPremium: number;
  /** Multiplied by 100 to get the cash needed for one contract. */
  estContractCost: number;
}

/** Naive ATM premium estimate: ~5% of underlying. Cheap, deterministic, good enough for budget triage. */
function estimatePremium(price: number): number {
  return Math.max(0.5, +(price * 0.05).toFixed(2));
}

/**
 * Find a peer ticker whose estimated single-contract cost fits within `budget`.
 * Returns the cheapest candidate that still fits, or null if nothing fits.
 *
 * @param symbol original ticker
 * @param budget per-trade max cost (dollars)
 * @param sectorOverride optional explicit sector if not in TICKER_UNIVERSE
 */
export function findBudgetPeer(symbol: string, budget: number, sectorOverride?: string): PeerCandidate | null {
  const meta = META.get(symbol);
  const sector = sectorOverride ?? meta?.sector ?? "Tech";
  const peerSymbols = (SECTOR_PEERS[sector] ?? SECTOR_PEERS.Tech).filter((p) => p !== symbol);

  const candidates: PeerCandidate[] = [];
  for (const peerSym of peerSymbols) {
    const peerMeta = META.get(peerSym);
    if (!peerMeta) continue;
    const price = peerMeta.base;
    const prem = estimatePremium(price);
    const cost = prem * 100;
    candidates.push({
      symbol: peerSym,
      name: peerMeta.name,
      approxPrice: price,
      estPremium: prem,
      estContractCost: cost,
    });
  }

  // Sort cheapest-first, return the cheapest that fits; if none fit, return the cheapest overall
  // (the UI will still show "still over budget — closest alternative").
  candidates.sort((a, b) => a.estContractCost - b.estContractCost);
  const fits = candidates.find((c) => c.estContractCost <= budget);
  return fits ?? candidates[0] ?? null;
}
