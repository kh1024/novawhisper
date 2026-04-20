import { describe, it, expect } from "vitest";
import {
  classifyAffordability,
  partitionByAffordability,
  COMFORTABLE_FRACTION,
} from "@/lib/affordability";

const noFees = { settings: null };

describe("classifyAffordability — spec §10 test cases", () => {
  it("Case 1 — $16 ask × 100 = $1,600 vs $500 budget → Blocked", () => {
    const r = classifyAffordability(500, { perShareCost: 16, ...noFees });
    expect(r.tier).toBe("blocked");
    expect(r.recommendable).toBe(false);
    expect(r.totalCost).toBe(1600);
    expect(r.overBy).toBe(1100);
  });

  it("Case 2 — $3.20 ask × 100 = $320 vs $500 budget → Comfortable (≤ 70%)", () => {
    const r = classifyAffordability(500, { perShareCost: 3.2, ...noFees });
    // 320 / 500 = 64% which is ≤ 70% → comfortable
    expect(r.tier).toBe("comfortable");
    expect(r.recommendable).toBe(true);
    expect(r.totalCost).toBe(320);
    expect(r.overBy).toBe(0);
  });

  it("Case 2b — $4.00 ask × 100 = $400 vs $500 budget → Affordable (>70%, ≤100%)", () => {
    const r = classifyAffordability(500, { perShareCost: 4.0, ...noFees });
    expect(r.tier).toBe("affordable");
    expect(r.recommendable).toBe(true);
  });

  it("Case 3 — direct $7.80 call BLOCKED but $2.40 spread RECOMMENDED", () => {
    const direct = classifyAffordability(500, { perShareCost: 7.8, ...noFees });
    const spread = classifyAffordability(500, { perShareCost: 2.4, ...noFees });
    expect(direct.tier).toBe("blocked");
    expect(spread.recommendable).toBe(true);
  });

  it("Case 4 — bumping the budget reclassifies the same trade", () => {
    const ask = 7.8; // $780 / contract
    expect(classifyAffordability(500,  { perShareCost: ask, ...noFees }).tier).toBe("blocked");
    expect(classifyAffordability(1000, { perShareCost: ask, ...noFees }).tier).toBe("affordable");
    expect(classifyAffordability(2000, { perShareCost: ask, ...noFees }).tier).toBe("comfortable");
  });

  it("Stale quote → tier 'stale', not recommendable, totalCost null", () => {
    const r = classifyAffordability(500, { perShareCost: 3.2, stale: true, ...noFees });
    expect(r.tier).toBe("stale");
    expect(r.recommendable).toBe(false);
    expect(r.totalCost).toBeNull();
  });

  it("Missing/zero price → 'unavailable', not recommendable", () => {
    expect(classifyAffordability(500, { perShareCost: null,  ...noFees }).tier).toBe("unavailable");
    expect(classifyAffordability(500, { perShareCost: 0,     ...noFees }).tier).toBe("unavailable");
    expect(classifyAffordability(500, { perShareCost: NaN,   ...noFees }).tier).toBe("unavailable");
  });

  it("Zero / unset budget → 'unavailable' (caller must require a budget)", () => {
    const r = classifyAffordability(0, { perShareCost: 3.2, ...noFees });
    expect(r.tier).toBe("unavailable");
    expect(r.recommendable).toBe(false);
  });

  it("Boundary — exactly at 70% of budget is still Comfortable", () => {
    const r = classifyAffordability(500, { perShareCost: 5 * COMFORTABLE_FRACTION, ...noFees });
    // 5 * 0.70 * 100 = 350 → exactly 70%
    expect(r.totalCost).toBe(350);
    expect(r.tier).toBe("comfortable");
  });

  it("Boundary — exactly at 100% of budget is Affordable, not Blocked", () => {
    const r = classifyAffordability(500, { perShareCost: 5, ...noFees });
    expect(r.totalCost).toBe(500);
    expect(r.tier).toBe("affordable");
  });
});

describe("partitionByAffordability — spec §8 ranking rule", () => {
  type Pick = { sym: string; ask: number };
  const picks: Pick[] = [
    { sym: "AAA", ask: 16 },   // $1600 — blocked
    { sym: "BBB", ask: 3.2 },  // $320  — comfortable
    { sym: "CCC", ask: 4.0 },  // $400  — affordable
    { sym: "DDD", ask: 0 },    // unavailable
  ];
  const part = partitionByAffordability(picks, 500, (p) => ({
    perShareCost: p.ask, settings: null,
  }));

  it("never lets blocked items reach the recommendable list", () => {
    expect(part.recommendable.map((r) => r.item.sym)).toEqual(["BBB", "CCC"]);
    expect(part.blocked.map((r) => r.item.sym)).toEqual(["AAA"]);
    expect(part.unavailable.map((r) => r.item.sym)).toEqual(["DDD"]);
  });

  it("orders blocked by cheapest first so the closest-to-budget shows up first", () => {
    const part2 = partitionByAffordability(
      [
        { sym: "X", ask: 50 },   // 5000
        { sym: "Y", ask: 6 },    // 600  — closest miss
        { sym: "Z", ask: 25 },   // 2500
      ],
      500,
      (p) => ({ perShareCost: p.ask, settings: null }),
    );
    expect(part2.blocked.map((r) => r.item.sym)).toEqual(["Y", "Z", "X"]);
  });
});
