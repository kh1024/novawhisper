# NovaWhisper — Full GitHub Source Code Audit Report

**Repository:** `github.com/kh1024/novawhisper` (public as of April 19, 2026)
**Stack:** React + TypeScript + Vite · Supabase Edge Functions (Deno) · Tailwind CSS · shadcn/ui · TanStack Query
**Audit Scope:** All gate logic, data validation, UI enforcement, and institutional safety rails

***

## Executive Summary

The NovaWhisper codebase has **fully implemented** the 7-Gate Validation Middleware prescribed in the prior research sessions. The architecture is clean, well-structured, and — critically — the gate logic is separated into pure functions that are independently testable. The implementation has also **exceeded the original specification** in several meaningful ways, adding Gate 8 (Affordability), Gate 9 (Date Validation), a parallel NovaGuards layer, a live SafetyExitAlert modal, and a multi-source quote verification engine. A handful of gaps and improvement opportunities are identified at the end of this report.

***

## Architecture Overview

The codebase is organized around a clear separation of concerns:

```
src/
├── lib/
│   ├── gates/
│   │   ├── types.ts        ← SignalInput, ValidationResult, all type contracts
│   │   ├── gates.ts        ← Pure gate functions (Gate 1–9), no React, no I/O
│   │   ├── middleware.ts   ← validateSignal() — short-circuit pipeline orchestrator
│   │   ├── adapter.ts      ← ScoutPick → SignalInput converter
│   │   ├── expiryDate.ts   ← Date sync: stale expiries pivot to nearest monthly
│   │   └── index.ts        ← Barrel export
│   ├── novaBrain.ts        ← Market regime + time-state engine (TimeState, MarketRegime)
│   ├── novaGuards.ts       ← Parallel lightweight guard layer (stale, intrinsic, SMA, capital)
│   ├── liveData.ts         ← Multi-source quote hooks (Finnhub, Alpha Vantage, Yahoo, Stooq)
│   ├── sma200.ts           ← 200-day SMA fetcher (210-day history window)
│   └── conflictResolution.ts ← Secondary CRL engine (RSI, EMA, Greeks, verdict)
├── components/
│   ├── GateValidationDashboard.tsx  ← Visual stepper UI for all gates
│   ├── NovaGuardBadges.tsx          ← Guard chip renderer
│   ├── SafetyExitAlert.tsx          ← Full-screen Gate 7 exit modal
│   └── NovaVerdictCard.tsx          ← BUY / WAIT / SKIP verdict card
└── supabase/functions/
    ├── quotes-fetch/        ← 5-source verified quote engine
    ├── quotes-history/      ← Historical OHLCV for SMA200
    ├── options-fetch/       ← Real options chain + Greeks (Polygon)
    └── options-scout/       ← AI-powered pick generation
```

***

## Gate-by-Gate Audit

### Gate 1 — Data Integrity ✅ FULLY IMPLEMENTED

**Blueprint spec:** Invalidate if `quote_timestamp > 60s` OR `price_drift > 1%`.

**What was found:**
The implementation in `gates.ts` matches the spec exactly. Staleness is computed as `(Date.now() - i.quoteTimestamp.getTime()) / 1000` and compared against 60 seconds. Price drift is computed as `Math.abs(currentPrice - liveFeedPrice) / liveFeedPrice` and compared against 0.01 (1%). Both conditions return `status: "BLOCKED"` with distinct, human-readable reasoning strings.

**Bonus implementation:** The `quotes-fetch` Supabase edge function implements a **5-source consensus engine** (Finnhub, Alpha Vantage, Massive, Yahoo, Stooq) with its own status taxonomy: `"verified"` (2+ sources within 0.25%), `"close"` (<1% diff), `"mismatch"` (≥1%), `"stale"` (only 1 source), and `"unavailable"`. Server-side caches (`QUOTE_TTL_MS = 30_000`) prevent stale data from persisting beyond 30 seconds per isolate. This is **more rigorous than specified**.

**Parallel guard in `novaGuards.ts`:** A lighter-weight `stale` guard also fires when `|livePrice - pickPrice| > $1.00 USD` — a dollar-absolute check that catches large-cap price drift without percentage math.

**Gap:** The Gate 1 `quoteTimestamp` in the gate input currently relies on the caller setting it correctly via the adapter. If the adapter passes `new Date()` as a default when no timestamp is available (i.e., from a cached pick), the gate will always pass even for genuinely stale data. **Recommendation:** In `adapter.ts`, map `quote.updatedAt` (ISO string from the edge function) to `quoteTimestamp` rather than using a default fallback.

***

### Gate 2 — Trend Gate (200-Day SMA) ✅ FULLY IMPLEMENTED

**Blueprint spec:** Boolean `price > 200_SMA`. If false, block CALL signals.

**What was found:**
The gate is implemented exactly as specified. `gate2_TrendGate` checks `i.currentPrice > i.sma200` and returns `BLOCKED` for CALLs below the SMA with a detailed reasoning string including the exact price and SMA levels.

**Data pipeline:** `sma200.ts` fetches 210 days of daily closes from the `quotes-history` edge function and computes `sum(slice(-200)) / 200`. The result is cached for **24 hours** (`staleTime: 24 * 60 * 60_000`) which is appropriate — the 200-SMA changes negligibly intraday.

**Parallel guard in `novaGuards.ts`:** The `trend200` guard runs the same check independently on the legacy pick cards and surfaces a `"Below 200-SMA"` danger chip that also sets `blocksSignal: true`. This means the 200-SMA block is enforced in **two separate layers** — the gate pipeline and the guard layer — which is good defense-in-depth.

**Gap:** PUT signals when price is above SMA200 are unchecked — the gate only evaluates CALL direction. This is correct per the spec, but there is currently no symmetric gate that blocks PUTs when the stock is in a strong long-term uptrend (which would be the mirror institutional rule). This is a known product decision, not a bug.

***

### Gate 3 — Intrinsic Audit ✅ FULLY IMPLEMENTED (non-blocking by design)

**Blueprint spec:** `if (strike > current_price) { risk_label = 'Aggressive Speculation' }`.

**What was found:**
The gate is implemented as a non-blocking `FLAGGED` status, exactly as specified. OTM calls (or puts, for symmetry) set `label: "🟠 AGGRESSIVE SPECULATION"` and the reasoning string correctly explains: intrinsic value = $0, the entire premium is extrinsic, and at expiration the option expires worthless if the strike is never crossed.

The `middleware.ts` correctly reads this flag and overrides `riskLabel` to `"AGGRESSIVE_SPECULATION"` in the `ValidationResult`. The final status becomes `"FLAGGED"` rather than `"BLOCKED"`, meaning the pick is still shown to the user — but the "Safe" label is permanently stripped.

**Parallel guard in `novaGuards.ts`:** The `intrinsic` guard in the NovaGuards layer also enforces this specifically on picks labeled `"safe"`: if `bucket === "safe"` and `strike > livePrice`, it fires `"High-Risk Speculation"` with `blocksSignal: true`. This is a stricter enforcement than the gate (which merely flags) — it actively suppresses GO/Buy CTAs on picks that were incorrectly generated as "safe" but are OTM.

**Gap:** None identified. The dual-layer approach (Gate 3 flags + Guard blocks) is architecturally sound.

***

### Gate 4 — Exhaustion Filter ✅ FULLY IMPLEMENTED

**Blueprint spec:** `if (rsi > 75 && streak_days > 7) { status = 'WAIT' }`.

**What was found:**
The gate matches the spec exactly. The hard block fires at `rsi14 > 75 AND streakDays > 7` → `status: "WAIT"`. A softer `FLAGGED` tier fires at `rsi14 > 70 AND streakDays >= 5` with a yellow caution label. The reasoning string correctly cites the "<45% win rate on next session" statistic for the hard block.

The `conflictResolution.ts` layer adds an additional technical overextension rule: `RSI > 70` alone triggers a `"WAIT"` verdict independent of streak count, using an EMA-based framework. This means the exhaustion protection is enforced by two independent engines.

**Gap:** `streakDays` is an estimated value in `setupScore.ts` — it's seeded deterministically by symbol using a PRNG (`rng(seed)`) rather than computed from real daily close data. This means the streak count for scanner picks is **not real**. The gate logic is correct; the input data feeding it is synthetic. **Recommendation:** Fetch the last 10 daily closes from `quotes-history` and compute `streakDays` from actual close-to-close changes in the adapter. The edge function infrastructure is already in place.

***

### Gate 5 — ORB Lock (10:30 AM EST) ✅ FULLY IMPLEMENTED + ENHANCED

**Blueprint spec:** Block execution if `market_time < 10:30 AM EST`.

**What was found:**
The gate uses `Intl.DateTimeFormat` with `timeZone: "America/New_York"` for correct DST handling, which is the right approach. It computes `totalMin = hours * 60 + minutes` and compares against `lockMin = 630` (10:30 AM). The `WAIT` status is returned with a remaining-minutes countdown in the reasoning string.

**Enhancement beyond spec:** The gate adds a **weekend check** (`dow === 0 || dow === 6`) and returns `APPROVED` with label `"🟢 WEEKEND — ORB N/A"` — preventing false WAIT states when no market is open. It also correctly avoids triggering the ORB lock before market open (before 9:30 AM), only applying it during the `9:30 AM – 10:30 AM` window specifically.

**Gap:** The gate uses `i.marketTime` as input, which is set by the adapter. If the adapter always passes `new Date()` (current time), the gate works correctly for live signals. However, historical backtesting or replaying saved picks would break this gate since `new Date()` would reflect today's time, not the original signal time. This is a minor concern for the current use case (real-time scanner) but worth noting for future paper-trading replay features.

***

### Gate 6 — IVP Guard ✅ FULLY IMPLEMENTED

**Blueprint spec:** `if (iv_percentile > 80) { warning = 'IV Crush Risk' }`.

**What was found:**
The gate implements three tiers: `IVP > 80` → `BLOCKED` ("EXPENSIVE TRAP — IV Crush Risk"), `IVP > 50` → `FLAGGED` ("ELEVATED IV — Proceed with Caution"), `IVP < 25` → `APPROVED` ("CHEAP IV — Buyer Favorable"). The reasoning string at the BLOCKED tier correctly explains the IV crush mechanism and redirects to premium-selling strategies only.

**Gap:** In `setupScore.ts`, `ivRank` is marked `ivRankEst: true` — it is a **deterministic estimate seeded by symbol**, not a live IV percentile from the options chain. The real IVP from the options-fetch edge function (Polygon) is available when an options chain is loaded, but the scanner scoring pipeline uses the estimated value. **Recommendation:** Pipe the real `iv` from `OptionContract` (already available in `liveData.ts`) through the `ivPercentile` calculation in the adapter before passing to Gate 6.

***

### Gate 7 — Safety Exit (-30% Stop) ✅ FULLY IMPLEMENTED + LIVE MODAL

**Blueprint spec:** `if (current_premium < entry_premium * 0.70) { trigger = 'SELL AT LOSS' }`.

**What was found:**
This is the most complete gate implementation in the codebase. `gate7_SafetyExit` correctly computes `exitThreshold = entryPremium * 0.70` and fires `status: "BLOCKED"` with `label: "🔴 SELL AT LOSS — 30% Stop Triggered"` and a detailed reasoning string citing the compounding loss risk.

**`SafetyExitAlert.tsx`** is a full-screen blocking modal that polls open positions against live quotes on every quote refresh, runs `gate7_SafetyExit` directly on each position, and fires a red modal with an acknowledge/dismiss flow. Dismissed alerts are snooze-saved to localStorage for 1 hour to prevent alert fatigue. This is **production-grade implementation** of the safety exit concept.

**Smart guard for missing data:** The gate correctly handles the no-entry-data case: `if (!Number.isFinite(entryPremium) || entryPremium <= 0)` → returns `APPROVED` with `"NO ENTRY DATA"` rather than false-positive blocking. This is proper defensive programming.

**Gap:** `SafetyExitAlert.tsx` uses `estimateCurrentPremium()` which computes the premium floor from intrinsic value only (`max(0, spot - strike)`). This means the current premium is **underestimated** for any option with remaining time value — which could trigger false-positive SELL alerts on positions that are down 30% on intrinsic but still have meaningful extrinsic value. **Recommendation:** Use the live mid-price from the options chain (`OptionContract.mid`) as the current premium where available, falling back to the intrinsic estimate when chain data is absent.

***

### Gate 8 — Affordability / Position Sizing ✅ IMPLEMENTED (BEYOND SPEC)

This gate was not in the original 7-gate spec and represents a meaningful institutional-grade addition.

**What was found:**
Gate 8 enforces a **10% hard cap** (`AFFORDABILITY_CAP_PCT = 10`) on single-trade notional cost as a percentage of `accountBalance`. A 5% warning tier (`AFFORDABILITY_WARN_PCT`) also exists. When the cap is breached, the gate does not simply block — it generates a **structured suggestion** recommending a vertical debit spread sized to the $150–$300 sweet spot (the `SPREAD_SWEET_SPOT` constant). This is the institutional standard for position sizing (the "2% Rule" adapted for options premium).

The `budgetImpact` object is returned in `ValidationResult` and surfaces `contractCost`, `pctOfPortfolio`, `overBudget`, and the spread suggestion for display in the UI.

**Gap:** `accountBalance` defaults to `0` in the adapter when the user hasn't set it in Settings. When `accountBalance = 0`, Gate 8 no-ops entirely (`!Number.isFinite(account) || account <= 0`). This is safe (no false blocks) but means the affordability protection is silently inactive for users who haven't configured their account size. **Recommendation:** Add a prompt or banner on first load asking the user to set their account size in Settings.

***

### Gate 9 — Date Validator ✅ IMPLEMENTED (BEYOND SPEC)

**What was found:**
`gate9_DateValidator` (in `gates.ts`) validates that the option expiry date is: (a) a real parseable date, (b) in the future, (c) a Friday (standard US options expiry), and (d) within a reasonable DTE window. The `expiryDate.ts` module handles pivoting stale expiries to the nearest monthly (third Friday) expiry automatically in the adapter.

This is a critical real-world guard — AI-generated picks sometimes suggest expiry dates that have already passed, and without this gate those picks would silently surface with phantom expiries.

***

## NovaBrain — Regime & Time-State Engine ✅ HIGHLY SOPHISTICATED

`novaBrain.ts` implements a **5-regime classifier** (bull, bear, sideways, panic, meltup) driven by SPY/QQQ/IWM/DIA percent change, VIX level, and breadth. It also implements a **7-state time engine** (weekend, premarket, openingHour, midday, powerHour, afterHours, closed) using `Intl.DateTimeFormat` for DST-correct New York time.

The `adjustForRegime()` function nudges setup scores based on regime fit — a bearish signal in a bull regime loses 8 points; a bullish signal in a melt-up gains 5. This is a genuine institutional-grade behavioral adaptation that most retail scanners lack entirely.

The `scoreToGrade()` function maps scores to A/B/C/D grades (90+ = A, 75–89 = B, 60–74 = C, <60 = D), and these grades are surfaced throughout the UI including the `NovaVerdictCard` and `PlaybookCard` components.

***

## Test Coverage

`src/test/gates.test.ts` contains a Vitest test suite covering:
- Clean ITM call approval past 10:30 EST
- BLOCKED on price drift > 1%
- BLOCKED on calls below 200-SMA
- FLAGGED (not blocked) for OTM calls with `riskLabel = "AGGRESSIVE_SPECULATION"`
- Gate 7 SELL AT LOSS at -30% premium drop
- `autoExitTrigger = entryPremium * 0.70` arithmetic

All 6 test cases are correct and aligned with the spec. The test base is minimal — only the happy path and critical failure paths are covered.

***

## Issues & Recommendations Summary

| Priority | Area | Issue | Recommendation |
|----------|------|--------|----------------|
| 🔴 High | Gate 4 / Exhaustion | `streakDays` is PRNG-estimated, not real | Compute from last 10 actual daily closes via `quotes-history` |
| 🔴 High | Gate 6 / IVP | `ivPercentile` is estimated in scanner, not real IVP | Pipe real IV from Polygon options chain through adapter |
| 🟠 Medium | Gate 7 / Safety Exit | `estimateCurrentPremium()` uses intrinsic floor only | Use live `mid` from options chain where available |
| 🟠 Medium | Gate 1 / Timestamp | Adapter may default `quoteTimestamp` to `new Date()` on cached picks | Map `quote.updatedAt` ISO string to `quoteTimestamp` explicitly |
| 🟡 Low | Gate 8 / Affordability | Silent no-op when `accountBalance = 0` | Show onboarding prompt to set account size in Settings |
| 🟡 Low | Test Coverage | Only 6 tests — no Gate 8/9, no ORB timing, no IVP tests | Expand test suite to cover all 9 gates with boundary conditions |
| 🟡 Low | Gate 5 / ORB | Historical pick replay would use current `new Date()` for time checks | Inject a `clockOverride` param for replay/backtest mode |

***

## Overall Assessment

| Dimension | Score | Notes |
|-----------|-------|-------|
| Gate Architecture | ✅ Excellent | Pure functions, short-circuit pipeline, clean type contracts |
| Data Validation | ✅ Strong | 5-source quote consensus, staleness TTLs, drift detection |
| UI Enforcement | ✅ Strong | Gate Dashboard, Guard Badges, blocking modal for Gate 7 |
| Regime Awareness | ✅ Excellent | NovaBrain 5-regime + 7-state time engine is institutional grade |
| Input Data Quality | 🟠 Partial | `streakDays` and `ivPercentile` in scanner are estimated, not real |
| Test Coverage | 🟡 Basic | 6 tests cover core paths; needs expansion to all 9 gates |
| Position Sizing | ✅ Strong | Gate 8 affordability cap + spread pivot suggestion is beyond spec |
| Date Safety | ✅ Strong | Gate 9 + expiryDate pivot is a production-quality guard |

The codebase is architecturally sound, well above amateur-tier, and faithfully implements the institutional Logic Blueprint. The two highest-priority improvements are making `streakDays` and `ivPercentile` real rather than estimated — once those inputs are live, the gate pipeline will be operating on fully real data end-to-end.
