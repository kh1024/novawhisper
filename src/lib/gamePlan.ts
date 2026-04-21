import type { ApprovedPick, ScannerPicksResult } from "@/lib/useScannerPicks";

type GamePlanSource = Pick<ScannerPicksResult, "approved" | "watchlistOnly" | "bestPending" | "cap">;

function pickScore(pick: ApprovedPick): number {
  return pick.rank?.finalRank ?? pick.row.setupScore;
}

export function getGamePlanPicks(scan: GamePlanSource, limit = 10): ApprovedPick[] {
  const cap = scan.cap > 0 ? scan.cap : Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  const unique: ApprovedPick[] = [];

  for (const pick of [...scan.approved, ...scan.watchlistOnly, ...scan.bestPending]) {
    if (seen.has(pick.key)) continue;
    seen.add(pick.key);
    unique.push(pick);
  }

  return unique
    .filter((pick) => pickScore(pick) >= 50)
    .filter((pick) => Number.isFinite(pick.estCost) && pick.estCost > 0 && pick.estCost <= cap)
    .sort((a, b) => pickScore(b) - pickScore(a))
    .slice(0, limit);
}
