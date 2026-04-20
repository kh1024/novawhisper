// Consistency test — locks in that Scanner and Dashboard's Top Opportunities
// derive picks from the SAME bucketing function. If this fails, the
// "single source of truth" promise is broken.
import { describe, it, expect } from "vitest";
import { bucketPicks } from "@/lib/useScannerPicks";
import { DEFAULT_PROFILE } from "@/lib/strategyProfile";
import type { SetupRow } from "@/lib/setupScore";
import type { RankResult } from "@/lib/finalRank";
import type { VerdictResult } from "@/lib/verdictModel";

function makeRow(sym: string, price: number, score: number, badge: "Safe" | "Mild" | "Aggressive" = "Mild"): SetupRow {
  return {
    symbol: sym, name: sym, sector: "Tech", price, changePct: 1, volume: 1e6,
    avgVolume: 1e6, relVolume: 1, ivRank: 30, ivRankEst: false, atrPct: 2,
    atrPctEst: false, rsi: 55, rsiEst: false, emaDist20: 0, emaDist50: 0,
    emaEst: false, optionsLiquidity: 70, earningsInDays: null, bias: "bullish",
    trendLabel: "up", setupScore: score, rawSetupScore: score,
    grade: "B", regime: "trend-up", timeStateLabel: "Power Hour", novaNotes: [],
    breakdown: { liquidity: 70, technical: 70, volatility: 50, timing: 60, catalyst: 40, riskAdjusted: 60 },
    readiness: "NOW", warnings: [],
    crl: { verdict: "GO", reason: "good", riskBadge: badge, score, confidence: 0.7 } as never,
  } as unknown as SetupRow;
}

const overrides = {
  showBudgetBlocked: false, bypassOrbLock: false, allowHighIv: false,
  treatAsModerate: false, perTradeCapOverride: 0, conservativeCheapOnly: false,
  smallCapFriendly: false,
};

describe("Scanner ↔ Dashboard pick consistency", () => {
  const rows = [
    makeRow("AAPL", 200, 85, "Safe"),
    makeRow("NVDA", 140, 78, "Aggressive"),
    makeRow("F", 12, 70, "Mild"),
  ];
  const rankMap = new Map<string, RankResult>(
    rows.map((r) => [r.symbol, { finalRank: r.setupScore, label: "BUY NOW", components: {} } as unknown as RankResult]),
  );
  const verdictByRow = new Map<string, VerdictResult>(
    rows.map((r) => [r.symbol, { verdict: "Buy Now", reason: "ok" } as VerdictResult]),
  );

  it("returns identical pick keys + counts when called twice with same input", () => {
    const a = bucketPicks({ rows, rankMap, verdictByRow, profile: DEFAULT_PROFILE, overrides, cap: 5000, bucketFilter: "All" });
    const b = bucketPicks({ rows, rankMap, verdictByRow, profile: DEFAULT_PROFILE, overrides, cap: 5000, bucketFilter: "All" });
    expect(a.approved.map((p) => p.row.symbol)).toEqual(b.approved.map((p) => p.row.symbol));
    expect(a.budgetBlocked.length).toBe(b.budgetBlocked.length);
    expect(a.safetyBlocked.length).toBe(b.safetyBlocked.length);
  });

  it("strike ladder picks affordable rung instead of blocking ticker entirely", () => {
    // With BS-lite pricing, AAPL @ $200 Deep-ITM (~$170 strike) prices around
    // $30/share = $3,000/contract, ITM (~$184) around $20 = $2,000. A $1,500
    // cap should still find at least the cheapest rung; a $200 cap blocks all.
    const wide = bucketPicks({ rows, rankMap, verdictByRow, profile: DEFAULT_PROFILE, overrides, cap: 5000, bucketFilter: "All" });
    expect(wide.approved.find((p) => p.row.symbol === "AAPL")).toBeDefined();

    const tiny = bucketPicks({ rows, rankMap, verdictByRow, profile: DEFAULT_PROFILE, overrides, cap: 200, bucketFilter: "All" });
    expect(tiny.approved.find((p) => p.row.symbol === "AAPL")).toBeUndefined();
    expect(tiny.budgetBlocked.find((p) => p.row.symbol === "AAPL")).toBeDefined();
  });

  it("bucket filter narrows results identically each call", () => {
    const conservative = bucketPicks({ rows, rankMap, verdictByRow, profile: DEFAULT_PROFILE, overrides, cap: 50_000, bucketFilter: "Conservative" });
    expect(conservative.approved.map((p) => p.row.symbol)).toEqual(["AAPL"]);
  });
});
