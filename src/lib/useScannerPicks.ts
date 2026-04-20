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
import { buildStrikeLadder, pickBestRung, type Rung } from "@/lib/strikeLadder";
import { isPreMarketWindow } from "@/lib/preMarketGenerator";
import { computeTradeStatus, type TradeStatusResult } from "@/lib/tradeStatus";
import { tradeStageFromStatus, type TradeStage } from "@/lib/tradeStage";
import {
  classifyPickTier, tierRank,
  type PickTier, type TierResult,
} from "@/lib/pickTier";
import {
  evaluateExecutionState, resolveCta, tradeStateRank,
  type TradeState, type TradeStateResult, type CtaPlan,
} from "@/lib/tradeState";
import { currentMarketMode } from "@/lib/marketHours";

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
  /** TradeStatus middleware result — readiness layer on top of scoring. */
  tradeStatus: TradeStatusResult;
  /** Trade State Machine stage — drives UI styling + Add-to-Portfolio gating. */
  tradeStage: TradeStage;
  /** Fail-soft tier — CLEAN / NEAR-LIMIT / BEST-OF-WAIT. */
  pickTier: PickTier;
  /** Score AFTER soft-penalty deductions, used for tier ranking. */
  adjustedScore: number;
  /** Human-readable caveat ("slightly over budget"). null when CLEAN. */
  tierCaveat: string | null;
  /** Tier penalties for the debug drawer. */
  tierPenalties: TierResult["penalties"];
  /** Trade State Machine — drives ALL UI labels & CTA buttons. */
  tradeState: TradeState;
  /** Full TradeState evaluation result (blockers, trigger language, etc.). */
  tradeStateResult: TradeStateResult;
  /** Pre-resolved CTA plan — UI must read this, never derive its own. */
  cta: CtaPlan;
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
  /** Funnel-debug tags. */
  dropReasons: string[];
}

export interface PipelineCounts {
  universe: number;
  gatePassing: number;       // approved before bucket-narrowing
  gateBlocked: number;
  budgetBlocked: number;
  shown: number;             // after bucket-narrowing + maxResults
  filterChip: string | null;
  // ── Funnel metrics (debug panel) ──
  safetyPassingCount: number;
  budgetPassingCount: number;     // soft-band inside cap
  scoredCount: number;            // got a score (not hard-dropped)
  tradeReadyCount: number;        // tradeState === TRADE_READY
  /** New TradeState counts. */
  nearLimitConfirmedCount: number;
  watchlistOnlyCount: number;
  excludedCount: number;
  /** Legacy tier counts kept for back-compat. */
  cleanCount: number;
  nearLimitCount: number;
  bestOfWaitCount: number;
  marketMode: "LIVE" | "PREVIEW" | "CLOSED";
}

export interface ScannerPicksResult {
  approved: ApprovedPick[];
  /** WATCHLIST_ONLY picks — interesting setups not yet tradable. */
  watchlistOnly: ApprovedPick[];
  /** Top WATCHLIST_ONLY picks shown when there are 0 trade-ready (max 3). */
  bestPending: ApprovedPick[];
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
    // Try the best-fitting rung first, but DON'T hard-drop on cap miss; the
    // tier classifier converts budget into a soft penalty unless cost > 10×.
    const fitPick = pickBestRung(ladder, args.cap);
    const pick = fitPick
      ?? (ladder.length > 0
        ? { candidate: ladder[0], cheapest: ladder[ladder.length - 1], fitsCap: false } as const
        : null);
    if (!pick) continue;

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
        dropReasons: ["safety_gate"],
      });
      continue;
    }

    const rankResult = args.rankMap.get(r.symbol) ?? null;
    const tradeStatus = computeTradeStatus({
      row: r,
      preMarket,
      fitsCap: pick.fitsCap,
      finalRank: rankResult?.finalRank ?? null,
    });
    const tradeStage = tradeStageFromStatus(tradeStatus, preMarket, true);

    // ── Tier classification (soft budget + score-based fail-soft) ─────────
    const nonSafetyRuleFailures = tradeStatus.blockers.filter(
      (b) => !b.includes("budget") && !b.includes("pre-market"),
    ).length;
    const tier = classifyPickTier({
      score: rankResult?.finalRank ?? r.setupScore,
      safetyPass: !isSafetyBlocked,
      contractCost: pick.candidate.contractCost,
      cap: args.cap,
      nonSafetyRuleFailures,
      ivRank: r.ivRank,
    });

    // Hard drop: cost > 10× cap → still report as budget-blocked (visible).
    if (tier.hardDrop) {
      const overBy = pick.candidate.contractCost - args.cap;
      budgetBlocked.push({
        key, row: r, contract, bucket: rowB, kind: "budget",
        reason: `Cost $${pick.candidate.contractCost.toLocaleString()} > 10× cap $${args.cap.toLocaleString()}`,
        detail:
          `Per-trade cap $${args.cap.toLocaleString()}. Cheapest rung ` +
          `${pick.cheapest.rung} ${pick.cheapest.optionType} $${pick.cheapest.strike} ` +
          `@ ~$${pick.cheapest.premium.toFixed(2)} = $${pick.cheapest.contractCost.toLocaleString()}.`,
        overBudgetBy: overBy,
        cap: args.cap,
        cost: pick.candidate.contractCost,
        premium: pick.cheapest.premium,
        suspect: pick.cheapest.suspect,
        preMarket,
        cheaperAlternative: null,
        dropReasons: ["budget_hard_drop_10x"],
      });
      continue;
    }

    // ── TradeState evaluation — the new authoritative state machine ────────
    // Quote validity proxies: contract/premium present and not flagged suspect.
    const quoteValid = Number.isFinite(pick.candidate.premium) && pick.candidate.premium > 0;
    const quoteFresh = !pick.candidate.suspect; // upstream flags suspect/stale premiums
    const ratio = pick.candidate.contractCost / Math.max(1, args.cap);
    const budgetNearLimit = ratio > 1 && ratio <= 1 + 0.5;
    const ivpNearLimit = (r.ivRank ?? 0) > 75 && (r.ivRank ?? 0) <= 90;

    const tradeStateResult = evaluateExecutionState({
      row: r,
      rank: rankResult,
      tradeStatus,
      tier,
      quoteValid,
      quoteFresh,
      preMarket,
      // Strategy profile opt-ins: default false (per chosen spec).
      allowsEarnings: false,
      allowsDeepItm: false,
      budgetNearLimit,
      ivpNearLimit,
    });
    const cta = resolveCta(tradeStateResult.state, tradeStateResult);

    approved.push({
      key,
      row: r,
      rank: rankResult,
      verdict: v ?? null,
      contract,
      estCost: pick.candidate.contractCost,
      premium: pick.candidate.premium,
      rung: pick.candidate.rung,
      suspect: pick.candidate.suspect,
      preMarket,
      bucket: rowB,
      tradeStatus,
      tradeStage,
      pickTier: tier.tier === "EXCLUDED" ? "BEST-OF-WAIT" : tier.tier,
      adjustedScore: tier.adjustedScore,
      tierCaveat: tier.caveat,
      tierPenalties: tier.penalties,
      tradeState: tradeStateResult.state,
      tradeStateResult,
      cta,
    });
  }

  // Sort: TradeState rank DESC (TRADE_READY > NEAR_LIMIT > WATCHLIST > EXCLUDED),
  // then adjustedScore DESC, then setup score. The new state machine drives
  // ordering so the UI never has to re-sort.
  approved.sort((a, b) => {
    const sDelta = tradeStateRank(b.tradeState) - tradeStateRank(a.tradeState);
    if (sDelta !== 0) return sDelta;
    const tDelta = tierRank(b.pickTier) - tierRank(a.pickTier);
    if (tDelta !== 0) return tDelta;
    if (b.adjustedScore !== a.adjustedScore) return b.adjustedScore - a.adjustedScore;
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

  // ── NO FORCE-FILL ───────────────────────────────────────────────────────
  // Per the new spec ("zero forced trades"): if there are 0 TRADE_READY
  // candidates, we surface 0 — not pad the list with weak NEAR-LIMIT or
  // BEST-OF-WAIT entries. The selector now only honors maxResults as a hard
  // ceiling, never a floor. Watchlist-only picks are surfaced separately.
  const tradeReadyOrConfirmed = bucketed.approved.filter(
    (p) => p.tradeState === "TRADE_READY" || p.tradeState === "NEAR_LIMIT_CONFIRMED",
  );
  const watchlistOnly = bucketed.approved.filter((p) => p.tradeState === "WATCHLIST_ONLY");
  const excluded = bucketed.approved.filter((p) => p.tradeState === "EXCLUDED");

  const approvedFinal = opts.maxResults != null
    ? tradeReadyOrConfirmed.slice(0, opts.maxResults)
    : tradeReadyOrConfirmed;

  // "Best pending" preview row: when there are 0 trade-ready picks, surface
  // the highest-scoring WATCHLIST_ONLY name so the user can see what's brewing
  // (per chosen empty-state policy).
  const bestPending = approvedFinal.length === 0 && watchlistOnly.length > 0
    ? watchlistOnly.slice(0, 3)
    : [];

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

  // Funnel metrics for the debug panel — both legacy tier counts AND new
  // trade-state counts so any consumer can pick its vocabulary.
  const cleanCount = bucketed.approved.filter((p) => p.pickTier === "CLEAN").length;
  const nearLimitCount = bucketed.approved.filter((p) => p.pickTier === "NEAR-LIMIT").length;
  const bestOfWaitCount = bucketed.approved.filter((p) => p.pickTier === "BEST-OF-WAIT").length;
  const tradeReadyStateCount = bucketed.approved.filter((p) => p.tradeState === "TRADE_READY").length;
  const nearLimitConfirmedCount = bucketed.approved.filter((p) => p.tradeState === "NEAR_LIMIT_CONFIRMED").length;
  const watchlistOnlyCount = watchlistOnly.length;
  const excludedCount = excluded.length;
  const safetyPassingCount = bucketed.approved.length;
  const budgetPassingCount = bucketed.approved.filter((p) => p.estCost <= cap).length;

  return {
    approved: approvedFinal,
    watchlistOnly,
    bestPending,
    budgetBlocked: opts.includeBudgetBlocked === false ? [] : bucketed.budgetBlocked,
    safetyBlocked: opts.includeSafetyBlocked === false ? [] : bucketed.safetyBlocked,
    counts: {
      universe: rows.length,
      gatePassing: bucketed.approved.length + bucketed.budgetBlocked.length,
      gateBlocked: bucketed.safetyBlocked.length,
      budgetBlocked: bucketed.budgetBlocked.length,
      shown: approvedFinal.length,
      filterChip: filterChipParts.length > 0 ? filterChipParts.join(" · ") : null,
      safetyPassingCount,
      budgetPassingCount,
      scoredCount: bucketed.approved.length,
      tradeReadyCount: tradeReadyStateCount,
      nearLimitConfirmedCount,
      watchlistOnlyCount,
      excludedCount,
      cleanCount,
      nearLimitCount,
      bestOfWaitCount,
      marketMode: currentMarketMode(),
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
