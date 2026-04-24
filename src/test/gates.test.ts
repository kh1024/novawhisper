import { describe, it, expect } from "vitest";
import { validateSignal, type SignalInput } from "@/lib/gates";

const base: SignalInput = {
  ticker: "NVDA",
  optionType: "CALL",
  strikePrice: 900,
  currentPrice: 920,            // ITM
  entryPremium: 12,
  currentPremium: 12,
  quoteTimestamp: new Date(Date.now() - 10_000), // 10s old
  liveFeedPrice: 920.5,
  rsi14: 55,
  streakDays: 2,
  sma200: 800,                  // price > sma → trend OK
  ivPercentile: 30,
  marketTime: new Date("2025-06-10T15:00:00Z"), // 11am EST weekday
  delta: 0.65,
  accountBalance: 100_000, // big enough that Gate 8 is a no-op for these tests
  contracts: 1,
  expiryDate: "2099-01-16", // far-future Friday — Gate 9 passes
};

describe("validateSignal — 7-gate pipeline", () => {
  it("approves a clean ITM call past 10:30 EST", () => {
    const r = validateSignal(base);
    expect(r.finalStatus).toBe("APPROVED");
  });

  it("BLOCKS when price drift > 1%", () => {
    const r = validateSignal({ ...base, liveFeedPrice: 950 });
    expect(r.finalStatus).toBe("BLOCKED");
    expect(r.gateResults[0].gate).toBe("DATA_INTEGRITY");
  });

  it("BLOCKS calls below 200-SMA", () => {
    const r = validateSignal({ ...base, sma200: 1000 });
    expect(r.finalStatus).toBe("BLOCKED");
  });

  it("FLAGS OTM calls as AGGRESSIVE_SPECULATION but does not block", () => {
    const r = validateSignal({ ...base, strikePrice: 950, currentPrice: 920, liveFeedPrice: 920 });
    expect(r.finalStatus).toBe("FLAGGED");
    expect(r.riskLabel).toBe("AGGRESSIVE_SPECULATION");
  });

  it("Gate 7 fires SELL AT LOSS at -37.5%", () => {
    const r = validateSignal({ ...base, entryPremium: 10, currentPremium: 6 });
    expect(r.finalStatus).toBe("BLOCKED");
    const g7 = r.gateResults.find((g) => g.gate === "SAFETY_EXIT");
    expect(g7?.label).toContain("SELL AT LOSS");
  });

  it("auto-exit trigger = entryPremium * 0.625", () => {
    const r = validateSignal({ ...base, entryPremium: 10 });
    expect(r.autoExitTrigger).toBe(6.25);
  });
});
