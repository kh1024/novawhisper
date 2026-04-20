// useScannerPicks — THE single source of truth for the pick pipeline.
//
// Both /scanner and the Dashboard's "Top Opportunities Today" widget call
// this hook. It runs the full computeSetups → verdict → bucket pipeline
// exactly once per (universe + profile + bucket + budget) tuple and shares
// the result via react-query. Two consumers ⇒ one network/CPU pass.
//
// Output is intentionally rich (approved, budgetBlocked, safetyBlocked,
// counts, activeBucket) so a small Dashboard card and the full Scanner can
// both render the same data with consistent messaging.
//
// NOTE: this hook does NOT manage the 90s sticky display cache (that lives
// in scanCache.ts and is per-component because it tracks UI age). The data
// pipeline IS shared; the visual stickiness is local to whichever surface
// is rendering — both surfaces still show the same picks because they both
// derive from the same approved set.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuotes } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { computeSetups, type SetupRow } from "@/lib/setupScore";
import { selectStrategy } from "@/lib/strategySelector";
import { rankSetup, type RankResult } from "@/lib/finalRank";
import { useSma200 } from "@/lib/sma200";
import { useEarnings } from "@/lib/earnings";
import { useBudget } from "@/lib/budget";
import { evaluateGuards } from "@/lib/novaGuards";
import { computeVerdict, type VerdictResult } from "@/lib/verdictModel";
import { usePortfolio } from "@/lib/portfolio";
import {
  useStrategyProfile, maxPerTradeDollars, isStructureAllowed,
  type StrategyProfile,
} from "@/lib/strategyProfile";
import { useScannerOverrides, type ScannerOverrides } from "@/lib/scannerOverrides";
import { useActiveBucket, rowBucket, type ActiveBucket } from "@/lib/scannerBucket";
import { isConservativeCheapTicker } from "@/lib/bucketing";
import { SMALL_CAP_FRIENDLY_SYMBOLS } from "@/lib/mockData";
import { buildStrikeLadder, pickBestRung, type LadderCandidate, type Rung } from "@/lib/strikeLadder";
import { isPreMarketWindow } from "@/lib/preMarketGenerator";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PickContract {
  symbol: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
}

export interface ApprovedPick {
  /** Stable cache key (symbol|optionType|strike|expiry). */
  key: string;
  row: SetupRow;
  rank: RankResult | null;
  verdict: VerdictResult | null;
  contract: PickContract;
  /** Real per-contract cost from the BS estimator (premium × 100). */
  estCost: number;
  /** Per-share premium (mid). */
  premium: number;
  /** Which delta band the strike sits in. */
  rung: Rung;
  /** True when the premium estimate looked suspect (premium > 50% of spot). */
  suspect: boolean;
  /** True between 4:00 AM and 9:30 AM ET — options markets closed. */
  preMarket: boolean;
  bucket: ActiveBucket;
}

export interface BlockedPick {
  key: string;
  row: SetupRow;
  contract: PickContract;
  bucket: ActiveBucket;
  kind: "budget" | "safety";
  reason: string;
  detail: string;
  /** Only set for budget blocks. */
  overBudgetBy?: number;
  cap?: number;
  cost?: number;
  /** Cheapest alternative rung that DID fit the cap (if any). */
  cheaperAlternative?: { rung: Rung; strike: number; cost: number } | null;
  premium?: number;
  suspect?: boolean;
  preMarket?: boolean;
}

export interface PipelineCounts {
  universe: number;
  gatePassing: number;       // approved before bucket-narrowing
  gateBlocked: number;
  budgetBlocked: number;
  shown: number;             // after bucket-narrowing + maxResults
  filterChip: string | null;
}

export interface ScannerPicksResult {
  approved: ApprovedPick[];
  budgetBlocked: BlockedPick[];
  safetyBlocked: BlockedPick[];
  counts: PipelineCounts;
  activeBucket: ActiveBucket;
  cap: number;
  /** True between 4:00 AM and 9:30 AM ET — premiums are estimates. */
  preMarket: boolean;
  /** Cheapest budget-blocked alternative for the diagnostic line. */
  cheapestAlternative: BlockedPick | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
  dataUpdatedAt: number;
}

export interface UseScannerPicksOptions {
  /** Cap the approved list. Default unlimited. */
  maxResults?: number;
  includeBudgetBlocked?: boolean;
  includeSafetyBlocked?: boolean;
  /** Override the global active bucket (Dashboard widget can pin one). */
  bucket?: ActiveBucket;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Compute the next monthly Friday-ish expiry ~28 days out. Shared with the
 *  legacy callers that still derive their own contracts. */
function nextExpiry(daysAhead = 28): { expiry: string; dte: number } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  const expiry = d.toISOString().slice(0, 10);
  const dte = Math.max(1, Math.round((d.getTime() - Date.now()) / 86_400_000));
  return { expiry, dte };
}

function contractKey(c: PickContract): string {
  return `${c.symbol.toUpperCase()}|${c.optionType}|${c.strike}|${c.expiry}`;
}

// Deterministic pure-function stage of the pipeline. Exported for the
// consistency test so we can assert the same input → same output.
export function bucketPicks(args: {
  rows: SetupRow[];
  rankMap: Map<string, RankResult>;
  verdictByRow: Map<string, VerdictResult>;
  profile: StrategyProfile;
  overrides: ScannerOverrides;
  cap: number;
  bucketFilter: ActiveBucket;
}): {
  approved: ApprovedPick[];
  budgetBlocked: BlockedPick[];
  safetyBlocked: BlockedPick[];
  profileFilteredCount: number;
  universeFilteredCount: number;
} {
  const approved: ApprovedPick[] = [];
  const budgetBlocked: BlockedPick[] = [];
  const safetyBlocked: BlockedPick[] = [];
  let profileFilteredCount = 0;
  let universeFilteredCount = 0;
  const preMarket = isPreMarketWindow();

  for (const r of args.rows) {
    if (args.overrides.conservativeCheapOnly && !isConservativeCheapTicker(r.symbol)) {
      universeFilteredCount++;
      continue;
    }
    const optionType: "call" | "put" = r.bias === "bearish" ? "put" : "call";
    const { expiry, dte } = nextExpiry(28);

    const rowB = rowBucket({
      riskBadge: r.crl?.riskBadge,
      earningsInDays: r.earningsInDays,
      ivRank: r.ivRank,
    });
    if (args.bucketFilter !== "All" && rowB !== args.bucketFilter) continue;

    if (!isStructureAllowed(args.profile, optionType, dte)) {
      profileFilteredCount++;
      continue;
    }

    // ── Strike ladder: generate Deep ITM / ITM / ATM (+OTM for lottery) ──
    // and price each rung via Black-Scholes-lite. The picker then selects
    // the highest-quality rung that fits the per-trade cap.
    const ladder = buildStrikeLadder({
      spot: r.price,
      ivRank: r.ivRank,
      optionType,
      expiry,
      dte,
      includeOTM: rowB === "Lottery",
    });
    const pick = pickBestRung(ladder, args.cap);
    if (!pick) {
      // Degenerate row (no usable price). Skip silently.
      continue;
    }

    const contract: PickContract = {
      symbol: r.symbol,
      optionType,
      strike: pick.candidate.strike,
      expiry: pick.candidate.expiry,
    };
    const key = contractKey(contract);
    const v = args.verdictByRow.get(r.symbol);
    const isSafetyBlocked = v?.verdict === "Avoid" || (v?.reason ?? "").toLowerCase().includes("block");

    if (isSafetyBlocked) {
      safetyBlocked.push({
        key, row: r, contract, bucket: rowB, kind: "safety",
        reason: v?.reason || "Safety gate failure",
        detail: v?.reason || "One or more safety gates flagged this pick.",
        premium: pick.candidate.premium,
        suspect: pick.candidate.suspect,
        preMarket,
      });
      continue;
    }

    // Budget logic — pick.fitsCap is the source of truth (already considered
    // every ladder rung). When it doesn't fit, we surface the cheapest rung
    // as the "block reason" and include the cost gap.
    if (!pick.fitsCap && !args.overrides.showBudgetBlocked) {
      const cheapest = pick.cheapest;
      const overBy = cheapest.contractCost - args.cap;
      budgetBlocked.push({
        key, row: r, contract, bucket: rowB, kind: "budget",
        reason: `Over per-trade cap by $${overBy.toLocaleString()}`,
        detail:
          `Cap $${args.cap.toLocaleString()}. Cheapest ladder rung is ` +
          `${cheapest.rung} ${cheapest.optionType} $${cheapest.strike} @ ~$${cheapest.premium.toFixed(2)} ` +
          `= $${cheapest.contractCost.toLocaleString()}/contract.`,
        overBudgetBy: overBy,
        cap: args.cap,
        cost: cheapest.contractCost,
        premium: cheapest.premium,
        suspect: cheapest.suspect,
        preMarket,
        cheaperAlternative: null,
      });
      continue;
    }

    approved.push({
      key,
      row: r,
      rank: args.rankMap.get(r.symbol) ?? null,
      verdict: v ?? null,
      contract,
      estCost: pick.candidate.contractCost,
      premium: pick.candidate.premium,
      rung: pick.candidate.rung,
      suspect: pick.candidate.suspect,
      preMarket,
      bucket: rowB,
    });
  }

  // Sort approved by Final Rank desc (with setup score tiebreaker) so every
  // surface — Scanner table, Dashboard top-N widget — agrees on order.
  approved.sort((a, b) => {
    const ra = a.rank?.finalRank ?? a.row.setupScore;
    const rb = b.rank?.finalRank ?? b.row.setupScore;
    if (rb !== ra) return rb - ra;
    return b.row.setupScore - a.row.setupScore;
  });

  return { approved, budgetBlocked, safetyBlocked, profileFilteredCount, universeFilteredCount };
}

/**
 * Find the cheapest ITM/Deep-ITM rung across ALL budget-blocked picks. Used
 * by the Scanner's diagnostic line "🔎 Every gate-passing pick is over your
 * $X cap. Cheapest option: F $11C at ~$210 total — click to approve."
 */
export function findCheapestAlternative(blocked: BlockedPick[]): BlockedPick | null {
  if (blocked.length === 0) return null;
  return [...blocked]
    .filter((b) => !b.suspect && (b.cost ?? Infinity) > 0)
    .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))[0] ?? null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useScannerPicks(opts: UseScannerPicksOptions = {}): ScannerPicksResult {
  const { profile } = useStrategyProfile();
  const { overrides } = useScannerOverrides();
  const [globalBucket] = useActiveBucket();
  const [budget] = useBudget();
  // Universe — exclude Small-Cap-Friendly names unless the user toggled them
  // on (they're injected; "off" = classic large-cap universe behavior).
  const universe = useMemo(() => {
    return TICKER_UNIVERSE
      .filter((t) => overrides.smallCapFriendly || !SMALL_CAP_FRIENDLY_SYMBOLS.has(t.symbol))
      .map((t) => t.symbol);
  }, [overrides.smallCapFriendly]);

  const { data: quotes = [], isLoading, isFetching, refetch, dataUpdatedAt } = useLiveQuotes(universe, {
    refetchMs: 60_000,
  });

  const sma = useSma200(universe);
  const closesBySymbol = useMemo(() => {
    const m = new Map<string, number[]>();
    sma.map.forEach((v, k) => {
      if (Array.isArray(v.closes) && v.closes.length > 0) m.set(k, v.closes);
    });
    return m;
  }, [sma.map]);

  const earnings = useEarnings(universe);

  const rows = useMemo(
    () => computeSetups(quotes, { closesBySymbol, earningsBySymbol: earnings.map }),
    [quotes, closesBySymbol, earnings.map],
  );

  const portfolioQ = usePortfolio();
  const ownedSymbols = useMemo(
    () => new Set((portfolioQ.data ?? []).filter((p) => p.status === "open").map((p) => p.symbol.toUpperCase())),
    [portfolioQ.data],
  );

  const profileCap = maxPerTradeDollars(profile);
  const cap = overrides.perTradeCapOverride > 0 ? overrides.perTradeCapOverride : profileCap;

  // Build rank + verdict maps (the heavy stage). Cached via react-query so
  // multiple consumers reuse the same computation.
  const cacheKey = useMemo(() => [
    "scanner-picks",
    universe.length, rows.length, dataUpdatedAt,
    cap, profile.riskTolerance, profile.horizon,
    profile.allowedStructures.longCall, profile.allowedStructures.longPut,
    profile.allowedStructures.leapsCall, profile.allowedStructures.leapsPut,
    overrides.conservativeCheapOnly, overrides.showBudgetBlocked,
    overrides.smallCapFriendly,
    budget,
  ] as const, [
    universe.length, rows.length, dataUpdatedAt,
    cap, profile.riskTolerance, profile.horizon, profile.allowedStructures,
    overrides.conservativeCheapOnly, overrides.showBudgetBlocked,
    overrides.smallCapFriendly, budget,
  ]);

  const pipelineQ = useQuery({
    queryKey: cacheKey,
    queryFn: () => {
      const rankMap = new Map<string, RankResult>();
      for (const r of rows) {
        const decision = selectStrategy({
          symbol: r.symbol, bias: r.bias, price: r.price, changePct: r.changePct,
          ivRank: r.ivRank, atrPct: r.atrPct, rsi: r.rsi,
          optionsLiquidity: r.optionsLiquidity, earningsInDays: r.earningsInDays,
          setupScore: r.setupScore,
          maxLossBudget: budget,
        });
        rankMap.set(r.symbol, rankSetup(r, decision));
      }
      const verdictByRow = new Map<string, VerdictResult>();
      for (const r of rows) {
        const rk = rankMap.get(r.symbol);
        const guard = evaluateGuards({
          symbol: r.symbol,
          livePrice: r.price,
          pickPrice: r.price,
          optionType: r.bias === "bearish" ? "put" : "call",
          direction: "long",
          strike: r.price,
          sma200: sma.map.get(r.symbol)?.sma200 ?? null,
          riskBucket: r.crl?.riskBadge?.toLowerCase() ?? null,
        });
        const upstream =
          guard.shouldBlockSignal && rk?.label === "BUY NOW" ? "BLOCKED"
          : (r.crl?.verdict === "EXIT" && ownedSymbols.has(r.symbol.toUpperCase())) ? "EXIT"
          : rk?.label ?? "WAIT";
        verdictByRow.set(r.symbol, computeVerdict({
          symbol: r.symbol, price: r.price, changePct: r.changePct,
          setupScore: r.setupScore, finalRank: rk?.finalRank ?? null,
          rsi: r.rsi, optionsLiquidity: r.optionsLiquidity,
          earningsInDays: r.earningsInDays, rawBias: r.bias,
          optionType: r.bias === "bearish" ? "put" : "call",
          strike: Math.max(1, Math.round(r.price / (r.price >= 100 ? 5 : 1)) * (r.price >= 100 ? 5 : 1)),
          budget, riskBucket: r.crl?.riskBadge?.toLowerCase() ?? null,
          isHardBlocked: guard.shouldBlockSignal,
          isStale: false, isTimedOut: false,
          upstreamLabel: upstream,
          isReady: rk?.label === "BUY NOW" && !guard.shouldBlockSignal,
        }));
      }
      return { rankMap, verdictByRow };
    },
    enabled: rows.length > 0,
    staleTime: 30_000,
    gcTime: 90_000,
  });

  const bucketFilter = opts.bucket ?? globalBucket;

  const bucketed = useMemo(() => {
    if (!pipelineQ.data) {
      return { approved: [], budgetBlocked: [], safetyBlocked: [], profileFilteredCount: 0, universeFilteredCount: 0 };
    }
    return bucketPicks({
      rows,
      rankMap: pipelineQ.data.rankMap,
      verdictByRow: pipelineQ.data.verdictByRow,
      profile, overrides, cap, bucketFilter,
    });
  }, [rows, pipelineQ.data, profile, overrides, cap, bucketFilter]);

  const approvedFinal = opts.maxResults != null ? bucketed.approved.slice(0, opts.maxResults) : bucketed.approved;

  const filterChipParts: string[] = [];
  if (bucketed.profileFilteredCount > 0) {
    filterChipParts.push(`excluded ${bucketed.profileFilteredCount} (structure not allowed)`);
  }
  if (bucketed.universeFilteredCount > 0) {
    filterChipParts.push(`excluded ${bucketed.universeFilteredCount} non-cheap-universe`);
  }

  const cheapestAlternative = useMemo(
    () => findCheapestAlternative(bucketed.budgetBlocked),
    [bucketed.budgetBlocked],
  );

  return {
    approved: approvedFinal,
    budgetBlocked: opts.includeBudgetBlocked === false ? [] : bucketed.budgetBlocked,
    safetyBlocked: opts.includeSafetyBlocked === false ? [] : bucketed.safetyBlocked,
    counts: {
      universe: rows.length,
      gatePassing: bucketed.approved.length + bucketed.budgetBlocked.length,
      gateBlocked: bucketed.safetyBlocked.length,
      budgetBlocked: bucketed.budgetBlocked.length,
      shown: approvedFinal.length,
      filterChip: filterChipParts.length > 0 ? filterChipParts.join(" · ") : null,
    },
    activeBucket: bucketFilter,
    cap,
    preMarket: isPreMarketWindow(),
    cheapestAlternative,
    isLoading: isLoading || pipelineQ.isLoading,
    isFetching: isFetching || pipelineQ.isFetching,
    refetch,
    dataUpdatedAt: dataUpdatedAt ?? 0,
  };
}
