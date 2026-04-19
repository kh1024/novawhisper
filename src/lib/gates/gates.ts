// Pure gate implementations — no React, no I/O, easy to unit test.
import type { SignalInput, GateResult } from "./types";
import { AFFORDABILITY_CAP_PCT, SPREAD_SWEET_SPOT } from "./types";

export function gate1_DataIntegrity(i: SignalInput): GateResult {
  const staleness_s = (Date.now() - i.quoteTimestamp.getTime()) / 1000;
  const priceDrift = i.liveFeedPrice > 0
    ? Math.abs(i.currentPrice - i.liveFeedPrice) / i.liveFeedPrice
    : 0;
  if (staleness_s > 60) {
    return {
      gate: "DATA_INTEGRITY", passed: false, status: "BLOCKED",
      label: "🔴 STALE QUOTE",
      reasoning: `Quote is ${staleness_s.toFixed(0)}s old (limit: 60s). This price may no longer reflect the live market. Buy signal hidden until a fresh quote arrives.`,
    };
  }
  if (priceDrift > 0.01) {
    const driftPct = (priceDrift * 100).toFixed(2);
    return {
      gate: "DATA_INTEGRITY", passed: false, status: "BLOCKED",
      label: "🔴 PRICE DRIFT DETECTED",
      reasoning: `Internal price ($${i.currentPrice.toFixed(2)}) differs from live feed ($${i.liveFeedPrice.toFixed(2)}) by ${driftPct}% (limit: 1.00%). Trading on drifted data risks executing at a price that no longer exists.`,
    };
  }
  return {
    gate: "DATA_INTEGRITY", passed: true, status: "APPROVED",
    label: "🟢 QUOTE LIVE",
    reasoning: `Quote is ${staleness_s.toFixed(0)}s old, drift ${(priceDrift * 100).toFixed(3)}%. Data integrity confirmed.`,
  };
}

export function gate2_TrendGate(i: SignalInput): GateResult {
  const aboveSMA = i.currentPrice > i.sma200;
  if (!aboveSMA && i.optionType === "CALL") {
    return {
      gate: "TREND_GATE", passed: false, status: "BLOCKED",
      label: "🔴 LONG-TERM BEARISH — CALL BLOCKED",
      reasoning: `${i.ticker} at $${i.currentPrice.toFixed(2)} is BELOW the 200-day SMA of $${i.sma200.toFixed(2)}. Long-term downtrend confirmed. Buying CALLs against institutional selling pressure has a statistically poor edge. Blocked until price reclaims the 200-SMA.`,
    };
  }
  return {
    gate: "TREND_GATE", passed: true, status: "APPROVED",
    label: aboveSMA ? "🟢 ABOVE 200-SMA" : "🟡 BELOW 200-SMA (PUT OK)",
    reasoning: aboveSMA
      ? `Price ($${i.currentPrice.toFixed(2)}) is above the 200-SMA ($${i.sma200.toFixed(2)}). Long-term trend bullish — CALLs eligible.`
      : `Price below 200-SMA but signal is PUT — bearish alignment confirmed.`,
  };
}

export function gate3_IntrinsicAudit(i: SignalInput): GateResult {
  const isOTM = i.optionType === "CALL" ? i.strikePrice > i.currentPrice : i.strikePrice < i.currentPrice;
  const intrinsic = i.optionType === "CALL"
    ? Math.max(i.currentPrice - i.strikePrice, 0)
    : Math.max(i.strikePrice - i.currentPrice, 0);
  if (isOTM) {
    return {
      gate: "INTRINSIC_AUDIT", passed: false, status: "FLAGGED",
      label: "🟠 AGGRESSIVE SPECULATION",
      reasoning: `Strike $${i.strikePrice.toFixed(2)} is OUT-OF-THE-MONEY for a ${i.optionType}. Intrinsic value = $${intrinsic.toFixed(2)}. The entire premium ($${i.entryPremium.toFixed(2)}) is extrinsic (time + IV). At expiration, if ${i.ticker} hasn't crossed $${i.strikePrice.toFixed(2)}, this option expires WORTHLESS. Classified as 'Aggressive Speculation' — cannot carry a 'Safe' label.`,
    };
  }
  return {
    gate: "INTRINSIC_AUDIT", passed: true, status: "APPROVED",
    label: i.delta >= 0.80 ? "🟢 DEEP ITM — Conservative Directional" : "🟡 ITM — Moderate Risk",
    reasoning: `Intrinsic value = $${intrinsic.toFixed(2)}. Option is ITM with delta ${i.delta.toFixed(2)}. ${i.delta >= 0.80 ? "Deep ITM: premium is primarily intrinsic — low theta and IV crush risk." : "Moderate ITM: some extrinsic premium present — monitor theta decay."}`,
  };
}

export function gate4_ExhaustionFilter(i: SignalInput): GateResult {
  if (i.rsi14 > 75 && i.streakDays > 7) {
    return {
      gate: "EXHAUSTION_FILTER", passed: false, status: "WAIT",
      label: "🔴 PEAK RISK — Mean Reversion Probable",
      reasoning: `${i.ticker} closed higher ${i.streakDays} sessions in a row with RSI(14) at ${i.rsi14.toFixed(1)} (threshold: RSI > 75 AND streak > 7). Stocks in this state beat the market less than 45% of the time on the next session. Blocked until RSI < 70 or the streak resets.`,
    };
  }
  if (i.rsi14 > 70 && i.streakDays >= 5) {
    return {
      gate: "EXHAUSTION_FILTER", passed: true, status: "FLAGGED",
      label: "🟡 OVEREXTENDED — Caution",
      reasoning: `RSI(14) = ${i.rsi14.toFixed(1)} with a ${i.streakDays}-day winning streak. Approved but momentum is stretched. Reduce size and tighten stops.`,
    };
  }
  return {
    gate: "EXHAUSTION_FILTER", passed: true, status: "APPROVED",
    label: "🟢 MOMENTUM CLEAN",
    reasoning: `RSI(14) = ${i.rsi14.toFixed(1)}, streak = ${i.streakDays} day(s). No exhaustion signal.`,
  };
}

export function gate5_OrbLock(i: SignalInput): GateResult {
  const est = new Date(i.marketTime.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const totalMin = est.getHours() * 60 + est.getMinutes();
  const lockMin = 10 * 60 + 30;
  const dow = est.getDay();
  if (dow === 0 || dow === 6) {
    return {
      gate: "ORB_LOCK", passed: true, status: "APPROVED",
      label: "🟢 WEEKEND — ORB N/A",
      reasoning: `Market is closed (weekend). ORB lock does not apply.`,
    };
  }
  if (totalMin >= 9 * 60 + 30 && totalMin < lockMin) {
    const remaining = lockMin - totalMin;
    const hh = est.getHours();
    const mm = String(est.getMinutes()).padStart(2, "0");
    return {
      gate: "ORB_LOCK", passed: false, status: "WAIT",
      label: "🟡 WAIT — Opening Range Settling",
      reasoning: `Market time ${hh}:${mm} EST. The 10:30 AM lock is active (${remaining}m remaining). The opening range is still forming — this window is dominated by algo stop-hunts, gap-fills and MOO flow. False breakout rates are highest here. New signals held in WAIT until ORB confirms.`,
    };
  }
  return {
    gate: "ORB_LOCK", passed: true, status: "APPROVED",
    label: "🟢 POST-10:30 AM — ORB CONFIRMED",
    reasoning: `Past the 10:30 AM lock. Opening range confirmed — breakout signals eligible.`,
  };
}

export function gate6_IvpGuard(i: SignalInput): GateResult {
  if (i.ivPercentile > 80) {
    return {
      gate: "IVP_GUARD", passed: false, status: "BLOCKED",
      label: "🔴 EXPENSIVE TRAP — IV Crush Risk",
      reasoning: `IV Percentile = ${i.ivPercentile.toFixed(0)}% — options priced in the TOP ${(100 - i.ivPercentile).toFixed(0)}% of their annual cost range. At IVP > 80 you pay top-of-market for volatility that statistically mean-reverts lower. An IV crush can destroy 30–50% of option value even if the stock moves your way. BUYING blocked — only premium-selling strategies (spreads, covered calls) are appropriate here.`,
    };
  }
  if (i.ivPercentile > 50) {
    return {
      gate: "IVP_GUARD", passed: true, status: "FLAGGED",
      label: "🟡 ELEVATED IV — Proceed with Caution",
      reasoning: `IV Percentile = ${i.ivPercentile.toFixed(0)}%. Options moderately expensive vs the past year. Approved but consider reducing contract count or choosing a closer expiration.`,
    };
  }
  return {
    gate: "IVP_GUARD", passed: true, status: "APPROVED",
    label: i.ivPercentile < 25 ? "🟢 CHEAP IV — Buyer Favorable" : "🟢 NORMAL IV",
    reasoning: `IV Percentile = ${i.ivPercentile.toFixed(0)}%. ${i.ivPercentile < 25 ? "Options historically inexpensive — favorable for premium buyers." : "IV within normal historical range."}`,
  };
}

export function gate7_SafetyExit(i: SignalInput): GateResult {
  if (!Number.isFinite(i.entryPremium) || i.entryPremium <= 0 || !Number.isFinite(i.currentPremium)) {
    return {
      gate: "SAFETY_EXIT", passed: true, status: "APPROVED",
      label: "🟢 NO ENTRY DATA",
      reasoning: `No entry premium recorded — safety exit monitor inactive.`,
    };
  }
  const exitThreshold = i.entryPremium * 0.70;
  const lossPct = ((i.entryPremium - i.currentPremium) / i.entryPremium) * 100;
  if (i.currentPremium < exitThreshold) {
    return {
      gate: "SAFETY_EXIT", passed: false, status: "BLOCKED",
      label: "🔴 SELL AT LOSS — 30% Stop Triggered",
      reasoning: `Premium fell from $${i.entryPremium.toFixed(2)} (entry) to $${i.currentPremium.toFixed(2)} — a ${lossPct.toFixed(1)}% loss (threshold: 30%). The hard stop has triggered. Holding further risks a 70–90% total loss as theta and delta compression compound. EXIT at market. Preserving 70¢ on the dollar beats holding to zero.`,
    };
  }
  const cushionPct = ((i.currentPremium - exitThreshold) / i.entryPremium) * 100;
  return {
    gate: "SAFETY_EXIT", passed: true, status: "APPROVED",
    label: "🟢 POSITION WITHIN STOP RANGE",
    reasoning: `Premium $${i.currentPremium.toFixed(2)} is ${cushionPct.toFixed(1)}% above the auto-exit threshold ($${exitThreshold.toFixed(2)}). Auto-exit fires if premium hits $${exitThreshold.toFixed(2)}.`,
  };
}

// ── GATE 8: Affordability (Position Sizing) ──────────────────────────────────
// Hard cap: a single contract's cost (premium × 100) × contracts must be
// ≤ AFFORDABILITY_CAP_PCT (5%) of the account balance. Otherwise label
// "TOO EXPENSIVE" and, when the pick is Grade A, recommend a vertical debit
// spread sized into the $200–$500 sweet spot.
export function gate8_Affordability(i: SignalInput): GateResult {
  const contracts = Math.max(1, Math.floor(i.contracts ?? 1));
  const premium = Number(i.entryPremium);
  const account = Number(i.accountBalance);

  // Without a real premium or account we can't enforce the cap — pass quietly.
  if (!Number.isFinite(premium) || premium <= 0 || !Number.isFinite(account) || account <= 0) {
    return {
      gate: "AFFORDABILITY", passed: true, status: "APPROVED",
      label: "🟢 NO COST DATA",
      reasoning: `No premium or account balance set — affordability check skipped. Configure your portfolio in Settings to enable this gate.`,
    };
  }

  const contractCost = premium * 100 * contracts;
  const pctOfAccount = (contractCost / account) * 100;
  const capDollars = (account * AFFORDABILITY_CAP_PCT) / 100;

  if (pctOfAccount > AFFORDABILITY_CAP_PCT) {
    // Grade A picks get an actionable spread suggestion to bring cost down.
    if (i.grade === "A") {
      // Suggest a width that lands the net debit in the sweet-spot range.
      // Heuristic: typical debit spread costs ~30-50% of the long premium.
      // We target a debit ≈ $300 (mid of $200-$500) and back into a width.
      const targetDebit = Math.min(SPREAD_SWEET_SPOT.max, Math.max(SPREAD_SWEET_SPOT.min, capDollars));
      const targetPerContract = targetDebit / 100;
      // Suggest a short-leg roughly 5-10% OTM from the long-leg strike.
      const widthPct = i.optionType === "CALL" ? 0.05 : -0.05;
      const shortStrike = Math.round(i.strikePrice * (1 + widthPct));
      const longLeg = i.strikePrice;
      return {
        gate: "AFFORDABILITY", passed: false, status: "BLOCKED",
        label: "🔴 TOO EXPENSIVE — Spread Suggested",
        reasoning: `Single ${i.optionType} costs $${contractCost.toFixed(0)} (${pctOfAccount.toFixed(1)}% of $${account.toLocaleString()}) — exceeds the ${AFFORDABILITY_CAP_PCT}% per-trade cap ($${capDollars.toFixed(0)}). This is a Grade A setup, so instead of skipping it, convert to a ${i.optionType === "CALL" ? "Call" : "Put"} Debit Spread: BUY $${longLeg} ${i.optionType} / SELL $${shortStrike} ${i.optionType}. Estimated net debit ≈ $${targetDebit.toFixed(0)} (within the $${SPREAD_SWEET_SPOT.min}–$${SPREAD_SWEET_SPOT.max} sweet spot). You keep the directional thesis at a fraction of the cost — capped upside, but a real, affordable trade.`,
        suggestion: {
          kind: "VERTICAL_SPREAD",
          title: `${i.optionType === "CALL" ? "Call" : "Put"} Debit Spread`,
          detail: `Buy $${longLeg} / Sell $${shortStrike} · est. net debit ~$${targetPerContract.toFixed(2)}/contract (~$${targetDebit.toFixed(0)} total)`,
        },
      };
    }
    return {
      gate: "AFFORDABILITY", passed: false, status: "BLOCKED",
      label: "🔴 TOO EXPENSIVE",
      reasoning: `Contract cost $${contractCost.toFixed(0)} = ${pctOfAccount.toFixed(1)}% of your $${account.toLocaleString()} account. This breaches the ${AFFORDABILITY_CAP_PCT}% per-trade cap ($${capDollars.toFixed(0)}). Either reduce position size or choose a cheaper expiration / closer-to-the-money strike.`,
      suggestion: {
        kind: "REDUCE_CONTRACTS",
        title: "Reduce size or pick a cheaper contract",
        detail: `Max affordable premium per contract at 1× = $${(capDollars / 100).toFixed(2)}.`,
      },
    };
  }

  if (pctOfAccount > AFFORDABILITY_CAP_PCT * 0.6) {
    return {
      gate: "AFFORDABILITY", passed: true, status: "FLAGGED",
      label: "🟡 ELEVATED COST",
      reasoning: `Trade uses ${pctOfAccount.toFixed(1)}% of your $${account.toLocaleString()} account ($${contractCost.toFixed(0)}). Within the ${AFFORDABILITY_CAP_PCT}% cap but on the high side — consider sizing down.`,
    };
  }

  return {
    gate: "AFFORDABILITY", passed: true, status: "APPROVED",
    label: "🟢 AFFORDABLE",
    reasoning: `Trade cost $${contractCost.toFixed(0)} = ${pctOfAccount.toFixed(1)}% of your $${account.toLocaleString()} account. Well within the ${AFFORDABILITY_CAP_PCT}% per-trade cap.`,
  };
}
