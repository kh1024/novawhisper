// portfolio-exit-eval — runs every 5 minutes during market hours. For every
// OPEN position:
//   1. Fetches the underlying spot.
//   2. Fetches the actual option contract bid/ask via public-options-fetch
//      (always — not just for DTE ≤ 7), and falls back to BS-lite only when
//      the chain doesn't include the contract.
//   3. Runs the quote through a validator (VALID / STALE / MISSING / ANOMALOUS).
//      • If quality !== VALID, we freeze the previous last_valid_mark for
//        PnL/stop logic and DO NOT trigger a stop from this tick.
//   4. Stop-loss confirmation rule: SELL_AT_LOSS only fires when 2 consecutive
//      VALID marks are below the hard stop, OR a single VALID breach has
//      persisted ≥ 30 seconds.
//   5. Writes a row to position_decision_log with the full trace so users can
//      inspect why a stop / take-profit fired.
//
// Idempotent — call manually with { ownerKey?: string, force?: boolean }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getOptionSnapshot, buildOsiTicker } from "../_shared/getOptionSnapshot.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PositionRow {
  id: string;
  owner_key: string;
  symbol: string;
  option_type: string;
  direction: string;
  strike: number;
  expiry: string;
  contracts: number;
  entry_premium: number | null;
  hard_stop_pct: number;
  target_1_pct: number;
  target_2_pct: number;
  max_hold_days: number | null;
  trade_stage: string;
  last_valid_mark: number | null;
  last_valid_mark_at: string | null;
  quote_history: Array<{ mark: number; quality: string; ts: string }>;
  stop_confirm_count: number;
  stop_first_breach_at: string | null;
}

// ─── BS-lite fallback ─────────────────────────────────────────────────────
const R = 0.04;
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
function bsPrice(spot: number, strike: number, iv: number, dte: number, isCall: boolean): number {
  const T = Math.max(1, dte) / 365;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (R + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const intrinsic = Math.max(0, isCall ? spot - strike : strike - spot);
  const price = isCall
    ? spot * normCdf(d1) - strike * Math.exp(-R * T) * normCdf(d2)
    : strike * Math.exp(-R * T) * (1 - normCdf(d2)) - spot * (1 - normCdf(d1));
  return Math.max(intrinsic + 0.01, price);
}

// ─── Quote validator (mirror of src/lib/quoteValidator.ts) ────────────────
type Quality = "VALID" | "STALE" | "MISSING" | "ANOMALOUS";
interface ClassifiedQuote {
  bid: number | null; ask: number | null; mark: number | null; last: number | null;
  updatedAt: string;
  quality: Quality;
  reason: string;
  source: string;
}
function getQuoteQuality(
  mark: number | null,
  bid: number | null,
  ask: number | null,
  updatedAt: Date,
): Quality {
  const ageSec = (Date.now() - updatedAt.getTime()) / 1000;

  if (bid == null && ask == null && mark == null) return "MISSING";
  if (ageSec > 60) return "STALE";
  if (mark == null) return "ANOMALOUS";
  if (mark <= 0.01) return "ANOMALOUS";
  if (bid != null && ask != null && bid > ask) return "ANOMALOUS";

  return "VALID";
}
function classifyQuote(args: {
  bid: number | null; ask: number | null; mark: number | null; last: number | null;
  updatedAt: number; underlyingPrice: number | null; source: string;
}): ClassifiedQuote {
  const updatedAt = new Date(args.updatedAt);
  const quality = getQuoteQuality(args.mark, args.bid, args.ask, updatedAt);
  const base = {
    bid: args.bid, ask: args.ask, mark: args.mark, last: args.last,
    updatedAt: updatedAt.toISOString(),
    source: args.source,
  };
  if (quality === "MISSING") return { ...base, quality, reason: "Bid, ask, and mark are all unavailable." };
  if (quality === "STALE") return { ...base, quality, reason: `Quote ${Math.round((Date.now() - updatedAt.getTime()) / 1000)}s old.` };
  if (quality === "ANOMALOUS") {
    if (args.mark == null) return { ...base, quality, reason: "Mark missing — invalid quote." };
    if (args.mark <= 0.01) return { ...base, quality, reason: "Mark is 0.00 or near zero — likely bad print." };
    if (args.bid != null && args.ask != null && args.bid > args.ask) return { ...base, quality, reason: "Bid is above ask — crossed market." };
  }
  if (args.underlyingPrice != null && args.underlyingPrice > 0 && args.mark != null && args.mark > args.underlyingPrice * 0.7) {
    return { ...base, quality: "ANOMALOUS", reason: "Mark > 70% of underlying — implausible." };
  }
  return { ...base, quality: "VALID", reason: "Bid/ask within sane bounds." };
}

// ─── Exit engine with stage + confirmation awareness ──────────────────────
type Rec = "HOLD" | "TRIM_PARTIAL" | "TAKE_PROFIT" | "SELL_AT_LOSS" | "TIME_EXIT" | "NO_SIGNAL";
interface Decision {
  recommendation: Rec;
  reason: string;
  profitPct: number;
  stopConfirmCount: number;
  firstBreachAt: string | null;
  /** Free-form trace for the decision log. */
  path: Record<string, unknown>;
}

function decide(
  p: PositionRow,
  usedMark: number,
  dte: number,
  quoteValid: boolean,
  quoteAgeMs: number | null,
): Decision {
  const path: Record<string, unknown> = {
    quoteValid,
    quoteAgeMs,
    hardStopPct: Number(p.hard_stop_pct),
    target1Pct: Number(p.target_1_pct),
    target2Pct: Number(p.target_2_pct),
  };

  if (p.entry_premium == null || p.entry_premium <= 0) {
    return {
      recommendation: "NO_SIGNAL",
      reason: "Entry price unknown — cannot compute P&L.",
      profitPct: 0,
      stopConfirmCount: p.stop_confirm_count,
      firstBreachAt: p.stop_first_breach_at,
      path: { ...path, branch: "no_entry" },
    };
  }

  const profitPct = ((usedMark - Number(p.entry_premium)) / Number(p.entry_premium)) * 100;
  path.profitPct = profitPct;

  // Take-profit + trim only fire on VALID quotes AND only when usedMark is
  // strictly above entry. Belt-and-suspenders against any caller that might
  // pass an inflated synthetic mark.
  if (quoteValid && profitPct >= Number(p.target_2_pct) && usedMark > Number(p.entry_premium)) {
    return {
      recommendation: "TAKE_PROFIT",
      reason: `Premium up ${profitPct.toFixed(1)}%, above target_2 (${p.target_2_pct}%). Lock in full profits.`,
      profitPct, stopConfirmCount: 0, firstBreachAt: null,
      path: { ...path, branch: "take_profit", usedMark, entry: Number(p.entry_premium) },
    };
  }
  if (quoteValid && profitPct >= Number(p.target_1_pct) && usedMark > Number(p.entry_premium)) {
    return {
      recommendation: "TRIM_PARTIAL",
      reason: `Premium up ${profitPct.toFixed(1)}%, above target_1 (${p.target_1_pct}%). Take partial profits, move stop to breakeven.`,
      profitPct, stopConfirmCount: 0, firstBreachAt: null,
      path: { ...path, branch: "trim", usedMark, entry: Number(p.entry_premium) },
    };
  }

  // Hard stop with confirmation rule.
  const breach = profitPct <= Number(p.hard_stop_pct);
  path.breach = breach;
  if (breach && quoteValid) {
    const newCount = (p.stop_confirm_count ?? 0) + 1;
    const firstBreachAt = p.stop_first_breach_at ?? new Date().toISOString();
    const persistMs = Date.parse(firstBreachAt) ? Date.now() - Date.parse(firstBreachAt) : 0;
    const confirmedByCount = newCount >= 2;
    const confirmedByPersist = persistMs >= 30_000;
    path.stopConfirmCount = newCount;
    path.persistMs = persistMs;
    path.confirmedByCount = confirmedByCount;
    path.confirmedByPersist = confirmedByPersist;
    if (confirmedByCount || confirmedByPersist) {
      return {
        recommendation: "SELL_AT_LOSS",
        reason: `Hard stop confirmed — ${profitPct.toFixed(1)}% (≤ ${p.hard_stop_pct}%) on ${newCount} consecutive valid quote(s). Cut loss.`,
        profitPct, stopConfirmCount: newCount, firstBreachAt,
        path: { ...path, branch: "stop_confirmed" },
      };
    }
    // Unconfirmed — stay HOLD but remember the breach.
    return {
      recommendation: "HOLD",
      reason: `Stop zone touched (${profitPct.toFixed(1)}%) — awaiting confirmation (${newCount}/2 valid breaches).`,
      profitPct, stopConfirmCount: newCount, firstBreachAt,
      path: { ...path, branch: "stop_unconfirmed" },
    };
  }

  // Time exit only on VALID (avoid expiring a position based on a missing quote).
  if (quoteValid && p.max_hold_days != null && dte <= 1) {
    return {
      recommendation: "TIME_EXIT",
      reason: "Option is near expiration with limited time value left. Flatten risk.",
      profitPct, stopConfirmCount: 0, firstBreachAt: null,
      path: { ...path, branch: "time_exit" },
    };
  }

  // Default HOLD — reset breach trackers if not breaching.
  return {
    recommendation: "HOLD",
    reason: quoteValid
      ? "Position within risk parameters. Hold and re-evaluate intraday."
      : "Quote unavailable or anomalous; using last valid price. No stop triggered.",
    profitPct,
    stopConfirmCount: breach ? p.stop_confirm_count : 0,
    firstBreachAt: breach ? p.stop_first_breach_at : null,
    path: { ...path, branch: quoteValid ? "hold" : "hold_quote_invalid" },
  };
}

function dteFromExpiry(expiry: string): number {
  const t = new Date(expiry + "T16:00:00Z").getTime();
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}

function isMarketHoursET(): boolean {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (wd === "Sat" || wd === "Sun") return false;
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  console.log("[exit-eval] BUILD=v2-day-close-fallback-2026-04-20T15:22");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: { ownerKey?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* GET / no body */ }

  const force = body.force === true;
  if (!force && !isMarketHoursET()) {
    return new Response(JSON.stringify({ ok: true, skipped: "outside_market_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let q = supabase
    .from("portfolio_positions")
    .select("id, owner_key, symbol, option_type, direction, strike, expiry, contracts, entry_premium, hard_stop_pct, target_1_pct, target_2_pct, max_hold_days, trade_stage, last_valid_mark, last_valid_mark_at, quote_history, stop_confirm_count, stop_first_breach_at")
    .eq("status", "open")
    .in("trade_stage", ["OPEN_POSITION", "EXIT_MANAGEMENT"]);
  if (body.ownerKey) q = q.eq("owner_key", body.ownerKey);

  const { data: positions, error: selErr } = await q;
  if (selErr) {
    return new Response(JSON.stringify({ ok: false, error: selErr.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }

  const rows = (positions ?? []) as PositionRow[];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, evaluated: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Underlying quotes in one batch.
  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
  const quoteMap = new Map<string, number>();
  try {
    const { data: qd } = await supabase.functions.invoke("quotes-fetch", { body: { symbols } });
    const quotes = (qd?.quotes ?? []) as Array<{ symbol: string; price: number }>;
    for (const q of quotes) if (Number.isFinite(q.price)) quoteMap.set(q.symbol, Number(q.price));
  } catch (e) {
    console.warn("quotes-fetch failed", e);
  }

  // Real chains for ALL symbols — primary source is Massive (via options-fetch).
  // We need bid/ask to validate, and the Massive snapshot returns NBBO.
  // NOTE: options-fetch caps at limit=250 contracts which can omit far-dated
  // expiries. For positions outside the slice we fall back to a per-contract
  // Massive call below (per-position loop).
  type ChainEntry = { mid?: number; bid?: number; ask?: number; last?: number };
  const realChain = new Map<string, ChainEntry>(); // SYMBOL|TYPE|STRIKE|EXPIRY
  const chainFetchedAt = new Map<string, number>();
  const chainSource = new Map<string, string>(); // symbol -> "massive" | "public" | "none"
  for (const sym of symbols) {
    let gotMassive = false;
    try {
      // options-fetch is Massive-backed (NBBO mid via last_quote.bid/ask).
      const { data } = await supabase.functions.invoke("options-fetch", {
        body: { underlying: sym, limit: 250 },
      });
      const isStale = data?.stale === true;
      const isDegraded = data?.degraded === true;
      const fetchedAt = data?.fetchedAt ? Date.parse(data.fetchedAt) : Date.now();
      const contracts = (data?.contracts ?? []) as Array<{
        type: string; strike: number; expiration: string; mid?: number; bid?: number; ask?: number; last?: number;
      }>;
      if (!isDegraded && contracts.length > 0) {
        chainFetchedAt.set(sym, fetchedAt);
        chainSource.set(sym, isStale ? "massive-stale" : "massive");
        for (const c of contracts) {
          const key = `${sym}|${(c.type ?? "").toLowerCase()}|${Number(c.strike)}|${c.expiration}`;
          realChain.set(key, { mid: c.mid, bid: c.bid, ask: c.ask, last: c.last });
        }
        gotMassive = true;
      } else {
        console.warn(`[exit-eval] options-fetch for ${sym}: degraded=${isDegraded} count=${contracts.length}`);
      }
    } catch (e) {
      console.warn(`options-fetch (Massive) failed for ${sym}`, e);
    }
    if (!gotMassive) {
      try {
        const { data } = await supabase.functions.invoke("public-options-fetch", { body: { symbol: sym } });
        const fetchedAt = data?.fetchedAt ? Date.parse(data.fetchedAt) : Date.now();
        chainFetchedAt.set(sym, fetchedAt);
        chainSource.set(sym, "public");
        const contracts = (data?.contracts ?? []) as Array<{
          type: string; strike: number; expiry: string; mid?: number; bid?: number; ask?: number; last?: number;
        }>;
        for (const c of contracts) {
          const key = `${sym}|${(c.type ?? "").toLowerCase()}|${Number(c.strike)}|${c.expiry}`;
          if (!realChain.has(key)) {
            realChain.set(key, { mid: c.mid, bid: c.bid, ask: c.ask, last: c.last });
          }
        }
      } catch (e) {
        console.warn(`public-options-fetch fallback failed for ${sym}`, e);
        chainSource.set(sym, "none");
      }
    }
  }

  // ─── Per-contract Massive snapshot (canonical source) ───────────────────
  // Now uses _shared/getOptionSnapshot.ts which is the SINGLE source of truth
  // for option data across portfolio-exit-eval, picks-engine, and any future
  // per-contract preview. Returns a fully-classified snapshot (VALID / STALE /
  // MISSING / ANOMALOUS) so we no longer hand-roll the validator here.

  let evaluated = 0;
  let stops = 0;
  let profits = 0;
  let frozen = 0;
  for (const p of rows) {
    const spot = quoteMap.get(p.symbol) ?? null;
    const isCall = p.option_type.toLowerCase().includes("call");
    const dte = dteFromExpiry(p.expiry);
    const key = `${p.symbol}|${isCall ? "call" : "put"}|${Number(p.strike)}|${p.expiry}`;
    const chainEntry = realChain.get(key);
    let fetchedAt = chainFetchedAt.get(p.symbol) ?? Date.now();
    let entrySource = chainSource.get(p.symbol) ?? "none";

    // Always prefer the per-contract Massive snapshot — it returns the exact
    // contract with NBBO + Greeks + day aggregates. Bulk chain is only used
    // as a hint when the per-contract call fails entirely.
    const ticker = p.option_symbol ?? buildOsiTicker(p.symbol, p.expiry, isCall, Number(p.strike));
    const snapshot = await getOptionSnapshot({
      underlying: p.symbol,
      optionSymbol: ticker,
    });

    let classified: ClassifiedQuote;
    if (snapshot.quality !== "MISSING" || snapshot.mark != null) {
      // Use the canonical snapshot (VALID / STALE / ANOMALOUS / MISSING).
      classified = {
        bid: snapshot.bid,
        ask: snapshot.ask,
        mark: snapshot.mark,
        last: snapshot.last,
        updatedAt: snapshot.updatedAt,
        quality: snapshot.quality,
        reason: snapshot.reason,
        source: snapshot.source,
      };
      fetchedAt = Date.parse(snapshot.updatedAt) || Date.now();
      entrySource = snapshot.source;
    } else if (chainEntry) {
      // Snapshot returned MISSING but bulk chain has the contract — use it.
      const bid = chainEntry.bid ?? null;
      const ask = chainEntry.ask ?? null;
      const mark = chainEntry.mid && chainEntry.mid > 0
        ? chainEntry.mid
        : (bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : null);
      classified = classifyQuote({
        bid, ask, mark, last: chainEntry.last ?? null,
        updatedAt: fetchedAt,
        underlyingPrice: spot,
        source: entrySource,
      });
    } else {
      // No real quote anywhere — synthesize via BS-lite. Tagged MISSING so the
      // exit engine treats it as quote-unavailable (no stops fire).
      const bsMid = spot != null ? bsPrice(spot, Number(p.strike), 0.55, dte, isCall) : null;
      classified = {
        bid: null, ask: null, mark: bsMid, last: null,
        updatedAt: new Date().toISOString(),
        quality: "MISSING",
        reason: "Massive returned no quote and contract not in chain — BS-lite estimate (no stop action).",
        source: "bs-lite",
      };
    }


    // Pick which mark to feed into the exit engine.
    //   • VALID quote → use it, update last_valid_mark.
    //   • Anything else → freeze the previous last_valid_mark; if we have none,
    //     fall back to entry_premium so profitPct = 0 and no stop fires.
    let usedMark: number;
    let frozenFlag = false;
    if (classified.quality === "VALID" && classified.mark != null) {
      usedMark = classified.mark;
    } else if (p.last_valid_mark != null) {
      usedMark = Number(p.last_valid_mark);
      frozenFlag = true;
    } else if (p.entry_premium != null) {
      usedMark = Number(p.entry_premium);
      frozenFlag = true;
    } else {
      usedMark = classified.mark ?? 0;
      frozenFlag = true;
    }
    if (frozenFlag) frozen++;

    if ((classified.mark ?? null) != null && classified.mark! <= 0.01 && Number(p.entry_premium ?? 0) >= 0.5) {
      console.warn(`suspicious 0.00 quote ignored for ${p.symbol} ${Number(p.strike)}${isCall ? "C" : "P"}`);
    }

    const dec = decide(
      p,
      usedMark,
      dte,
      classified.quality === "VALID",
      Number.isFinite(Date.now() - Date.parse(classified.updatedAt))
        ? Date.now() - Date.parse(classified.updatedAt)
        : null,
    );

    if (dec.recommendation === "SELL_AT_LOSS" || dec.recommendation === "TIME_EXIT") stops++;
    if (dec.recommendation === "TAKE_PROFIT" || dec.recommendation === "TRIM_PARTIAL") profits++;

    // Update rolling quote history (last 10).
    const newHistory = Array.isArray(p.quote_history) ? [...p.quote_history] : [];
    newHistory.push({
      mark: classified.mark ?? 0,
      quality: classified.quality,
      ts: classified.updatedAt,
    });
    while (newHistory.length > 10) newHistory.shift();

    // trade_stage transition: OPEN_POSITION → EXIT_MANAGEMENT once any
    // non-HOLD recommendation appears (stop-zone touched, target hit, etc).
    let nextStage = p.trade_stage;
    if (
      (dec.recommendation !== "HOLD" || dec.stopConfirmCount > 0) &&
      p.trade_stage === "OPEN_POSITION"
    ) {
      nextStage = "EXIT_MANAGEMENT";
    }

    await supabase
      .from("portfolio_positions")
      .update({
        current_price: +usedMark.toFixed(4),
        current_profit_pct: +dec.profitPct.toFixed(2),
        exit_recommendation: dec.recommendation,
        exit_reason: dec.reason,
        last_evaluated_at: new Date().toISOString(),
        last_quote_quality: classified.quality,
        last_valid_mark: classified.quality === "VALID" && classified.mark != null
          ? +classified.mark.toFixed(4)
          : p.last_valid_mark,
        last_valid_mark_at: classified.quality === "VALID"
          ? new Date().toISOString()
          : p.last_valid_mark_at,
        quote_history: newHistory,
        stop_confirm_count: dec.stopConfirmCount,
        stop_first_breach_at: dec.firstBreachAt,
        trade_stage: nextStage,
      })
      .eq("id", p.id);

    // Decision log row — powers the /portfolio Debug "Decision Trace" drawer.
    await supabase.from("position_decision_log").insert({
      position_id: p.id,
      owner_key: p.owner_key,
      trade_stage: nextStage,
      quote_bid: classified.bid,
      quote_ask: classified.ask,
      quote_mark: classified.mark,
      quote_last: classified.last,
      quote_quality: classified.quality,
      quote_source: classified.source,
      underlying_price: spot,
      used_mark: +usedMark.toFixed(4),
      profit_pct: +dec.profitPct.toFixed(2),
      recommendation: dec.recommendation,
      reason: dec.reason,
      stop_confirm_count: dec.stopConfirmCount,
      decision_path: {
        ...dec.path,
        quoteQualityReason: classified.reason,
        frozen: frozenFlag,
        chainKey: key,
      },
    });

    evaluated++;
  }

  return new Response(JSON.stringify({ ok: true, evaluated, stops, profits, frozen }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
