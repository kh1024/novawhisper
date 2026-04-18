// Quick-seed sample paper trades so Simulation Mode has something to look at.
// Picks a spread of bullish/bearish/credit setups across the universe.
import type { NewPosition } from "./portfolio";

function daysFromNow(d: number): string {
  const t = new Date(Date.now() + d * 86_400_000);
  // Snap to next Friday-ish
  const day = t.getDay();
  const add = day <= 5 ? 5 - day : 5 + (7 - day);
  t.setDate(t.getDate() + add);
  return t.toISOString().slice(0, 10);
}

export function buildSamplePaperTrades(): NewPosition[] {
  return [
    {
      symbol: "NVDA",
      optionType: "call",
      direction: "long",
      strike: 145,
      expiry: daysFromNow(21),
      contracts: 2,
      entryPremium: 4.20,
      entryUnderlying: 138,
      thesis: "SIM: Bullish breakout sympathy with semis. Δ ≈ 0.45.",
      source: "simulation",
      isPaper: true,
    },
    {
      symbol: "SPY",
      optionType: "put",
      direction: "long",
      strike: 470,
      expiry: daysFromNow(14),
      contracts: 1,
      entryPremium: 3.10,
      entryUnderlying: 478,
      thesis: "SIM: Hedge on FOMC week. IV cheap.",
      source: "simulation",
      isPaper: true,
    },
    {
      symbol: "AAPL",
      optionType: "call",
      direction: "long",
      strike: 220,
      expiry: daysFromNow(45),
      contracts: 1,
      entryPremium: 7.80,
      entryUnderlying: 224,
      thesis: "SIM: Trend swing, Δ ≈ 0.55, holds through earnings.",
      source: "simulation",
      isPaper: true,
    },
    {
      symbol: "TSLA",
      optionType: "put",
      direction: "short",
      strike: 230,
      expiry: daysFromNow(28),
      contracts: 1,
      entryPremium: 5.50,
      entryUnderlying: 248,
      thesis: "SIM: CSP on TSLA, willing to own at 230. Collect $550.",
      source: "simulation",
      isPaper: true,
    },
    {
      symbol: "AMD",
      optionType: "call",
      direction: "long",
      strike: 160,
      expiry: daysFromNow(7),
      contracts: 3,
      entryPremium: 2.10,
      entryUnderlying: 152,
      thesis: "SIM: Aggressive lotto on weekly breakout above 158.",
      source: "simulation",
      isPaper: true,
    },
  ];
}
