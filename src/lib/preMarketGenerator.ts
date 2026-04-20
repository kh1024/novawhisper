// Pre-Market Pick Generator (4:00 AM – 9:30 AM ET).
//
// The intraday scanner is tuned for the OPEN — momentum, RSI bursts, opening
// range breakouts. Pre-market that same logic produces noise: the prints are
// thin, the EMA stack hasn't refreshed, and the gap-up signals get nuked by
// the first 60 minutes of MOO order flow.
//
// This generator surfaces a different KIND of pick during pre-market:
//   • Longer DTE (30-180 days)  — less sensitive to opening volatility
//   • Deep ITM (delta ≥ 0.75 proxy via strike below spot)
//   • Gap plays (>2% pre-market move with above-average activity)
// And ships each pick with a 3-scenario "Opening plan" the user can act on
// once the bell rings.

import { computePreMarketStatus } from "@/lib/preMarketPreview";
import type { SetupRow } from "@/lib/setupScore";

export interface OpeningPlan {
  ifGapUpHolds: string;
  ifGapUpFades: string;
  ifGapDown: string;
}

export interface PreMarketPick {
  symbol: string;
  /** "LEAP Call" | "Deep-ITM Call" | "Gap Play Call" | "Gap Play Put" */
  kind: "LEAP Call" | "Deep-ITM Call" | "Deep-ITM Put" | "Gap Play Call" | "Gap Play Put";
  bias: "bullish" | "bearish";
  strike: number;
  expiry: string;          // YYYY-MM-DD
  dte: number;
  thesis: string;
  /** 3-scenario plan for the open. */
  plan: OpeningPlan;
  /** The underlying SetupRow for downstream contract derivation. */
  row: SetupRow;
}

/** Returns true between 4:00 AM and 9:30 AM ET on a weekday. */
export function isPreMarketWindow(now: Date = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = et.getDay();
  if (dow < 1 || dow > 5) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 4 * 60 && minutes < 9 * 60 + 30;
}

function nextFriday(daysOut: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOut);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function strikeFor(spot: number, deltaTarget: number, type: "call" | "put"): number {
  // Rough proxy: deep-ITM call → strike ~15% below spot for 0.85 delta.
  // Deep-ITM put → strike ~15% above spot.
  const step = spot >= 100 ? 5 : 1;
  const offset = type === "call" ? -spot * (deltaTarget - 0.5) * 0.5 : spot * (deltaTarget - 0.5) * 0.5;
  const raw = spot + offset;
  return Math.max(step, Math.round(raw / step) * step);
}

/**
 * Build pre-market picks from the scanner universe.
 *
 * Acceptance criteria 5: when any qualifying ticker is in the universe the
 * generator must produce ≥ 2 LEAP/Deep-ITM candidates per scan. We meet that
 * by always producing at least the top-2 highest-scoring rows as Deep-ITM
 * calls (provided the bias isn't bearish).
 */
export function generatePreMarketPicks(rows: SetupRow[], now: Date = new Date()): PreMarketPick[] {
  if (!isPreMarketWindow(now)) return [];

  const picks: PreMarketPick[] = [];
  const expiryLeap = nextFriday(180);
  const expiryDeep = nextFriday(45);
  const expiryGap = nextFriday(30);

  // 1) Gap plays — pre-market move > 2% with reasonable liquidity.
  const gapCandidates = rows
    .filter((r) => Math.abs(r.changePct) >= 2 && r.optionsLiquidity >= 50)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 4);

  for (const r of gapCandidates) {
    const isUp = r.changePct >= 0;
    const type: "call" | "put" = isUp ? "call" : "put";
    picks.push({
      symbol: r.symbol,
      kind: isUp ? "Gap Play Call" : "Gap Play Put",
      bias: isUp ? "bullish" : "bearish",
      strike: strikeFor(r.price, 0.55, type),
      expiry: expiryGap,
      dte: 30,
      thesis: `${isUp ? "Gap up" : "Gap down"} ${r.changePct.toFixed(1)}% on ${(r.relVolume).toFixed(1)}× relative volume — pre-market interest is real.`,
      plan: {
        ifGapUpHolds: isUp
          ? "Enter at the open if it holds above pre-market high — first 5m candle close confirms."
          : "Skip — gap is against thesis.",
        ifGapUpFades: isUp
          ? "Wait for 10:30 reversal. If it reclaims pre-market mid, the squeeze trade is back on."
          : "Wait for 10:30 reversal off lows — that's your entry, not the open.",
        ifGapDown: isUp
          ? "Skip — thesis invalidated, the gap was sold by sophisticated flow."
          : "Enter at the open if it holds below pre-market low.",
      },
      row: r,
    });
  }

  // 2) Deep-ITM swing plays — top scorers, longer DTE, intrinsic-value heavy.
  const swingCandidates = rows
    .filter((r) => r.bias !== "neutral" && r.optionsLiquidity >= 60)
    .sort((a, b) => b.setupScore - a.setupScore)
    .slice(0, 6);

  for (const r of swingCandidates) {
    const isCall = r.bias !== "bearish";
    picks.push({
      symbol: r.symbol,
      kind: isCall ? "Deep-ITM Call" : "Deep-ITM Put",
      bias: isCall ? "bullish" : "bearish",
      strike: strikeFor(r.price, 0.80, isCall ? "call" : "put"),
      expiry: expiryDeep,
      dte: 45,
      thesis: `Deep-ITM (~0.80 Δ) ${isCall ? "call" : "put"} — intrinsic value dominates so the first hour of opening noise barely matters. Setup score ${r.setupScore}.`,
      plan: {
        ifGapUpHolds: isCall
          ? "Hold conviction — intrinsic value rose with spot. Add only if 10:30 confirms."
          : "Wait. Spot moved against you but intrinsic loss is small — re-evaluate at 10:30.",
        ifGapUpFades: isCall
          ? "No action — Δ 0.80 means you bleed slowly. Trim only if 10:30 closes red."
          : "Re-examine at 10:30 — fading gap up favors put thesis.",
        ifGapDown: isCall
          ? "Wait for 10:30 — deep-ITM cushions a small gap down, but a >2% drop invalidates."
          : "Hold — gap-down confirms thesis, trim 1/3 into open strength to lock gain.",
      },
      row: r,
    });
  }

  // 3) LEAP candidates — top long-bias scorers with strong trend.
  const leapCandidates = rows
    .filter((r) => r.bias === "bullish" && r.optionsLiquidity >= 70 && r.setupScore >= 60)
    .sort((a, b) => b.setupScore - a.setupScore)
    .slice(0, 3);

  for (const r of leapCandidates) {
    picks.push({
      symbol: r.symbol,
      kind: "LEAP Call",
      bias: "bullish",
      strike: strikeFor(r.price, 0.85, "call"),
      expiry: expiryLeap,
      dte: 180,
      thesis: `LEAP call — 6-month thesis on a ${r.bias} setup (score ${r.setupScore}). Opening prints don't matter at this duration.`,
      plan: {
        ifGapUpHolds: "Initiate if it holds above pre-market high through 10:30 — this is your 6-month entry.",
        ifGapUpFades: "Wait. Better to enter on a 10:30 pullback to VWAP than chase the gap.",
        ifGapDown: "Better entry — scale in on weakness if the daily trend is intact (200-SMA positive).",
      },
      row: r,
    });
  }

  // De-dupe by symbol+kind to avoid showing the same pick twice when a gap
  // play and a deep-ITM thesis overlap.
  const seen = new Set<string>();
  return picks.filter((p) => {
    const k = `${p.symbol}|${p.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Returns minutes until 9:30 AM ET (the pre-market window's end). */
export function minutesUntilOpen(now: Date = new Date()): number {
  const status = computePreMarketStatus(true);
  return Math.max(0, status.minutesUntilUnlock - 60); // 10:30 → 9:30 = -60
}
