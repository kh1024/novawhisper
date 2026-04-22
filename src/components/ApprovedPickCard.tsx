// ─── APPROVED PICK CARD ──────────────────────────────────────────────────────
// Spec-compliant 4-Score card. Renders an ApprovedPick as a single card with:
//   • Top: ticker + price + CALL/PUT direction · classification badge · quote badge
//   • 4 score bars (Setup / Contract / Execution / Quote) + Final Score
//   • Contract details grid (strike, expiry, bid/ask/mid, spread, vol/oi, IV, Δ, θ)
//   • Decision section (plain English summary, block/warn reasons, entry/budget/stop)
//   • Upgrade path (when not BUY NOW / AVOID)
//   • Failing gates compact list
//   • Live Price Check (collapsible)
//   • Quote debug (existing component)
//
// Built for the Scanner bucket layout — NOT a replacement for NovaVerdictCard
// which still serves the Picks/Dashboard pages with its NovaCard prop shape.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoreBar } from "@/components/ScoreBar";
import { QuoteStatusBadge } from "@/components/QuoteStatusBadge";
import { ClassificationBadge } from "@/components/ClassificationBadge";
import { LivePricePanel } from "@/components/LivePricePanel";
import { QuoteDebugPanel } from "@/components/QuoteDebugPanel";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { rowBucket } from "@/lib/scannerBucket";
import type { ApprovedPick } from "@/lib/useScannerPicks";

interface Props {
  pick: ApprovedPick;
  /** Open the per-symbol research drawer in Scanner. */
  onOpen?: (symbol: string) => void;
}

export function ApprovedPickCard({ pick, onOpen }: Props) {
  const [showLive, setShowLive] = useState(false);
  const oq = pick.quoteReport?.optionQuote;
  const uq = pick.quoteReport?.underlyingQuote;
  const tier = pick.tier4 ?? "WATCHLIST";
  const isCall = pick.contract.optionType === "call";
  const direction: "CALL" | "PUT" = isCall ? "CALL" : "PUT";

  const dimmed = tier === "AVOID";

  return (
    <Card
      className={cn(
        "p-4 space-y-3 border bg-card",
        tier === "BUY NOW" && "border-bullish/60 ring-1 ring-bullish/30",
        tier === "WATCHLIST" && "border-primary/50",
        tier === "NEEDS RECHECK" && "border-warning/50",
        dimmed && "opacity-70",
      )}
    >
      {/* ── TOP SECTION ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen?.(pick.row.symbol)}
          className="text-left min-w-0 flex-1 active:opacity-70"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-lg font-extrabold text-foreground">
              {pick.row.symbol}
            </span>
            <span
              className={cn(
                "mono text-[11px] font-bold px-2 py-0.5 rounded border",
                isCall
                  ? "text-bullish border-bullish/60 bg-bullish/10"
                  : "text-bearish border-bearish/60 bg-bearish/10",
              )}
            >
              {direction}
            </span>
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span className="mono">${(uq?.lastPrice ?? pick.row.price).toFixed(2)}</span>
            {(uq?.changePct ?? pick.row.changePct) !== undefined && (
              <span
                className={cn(
                  "mono text-[11px] inline-flex items-center gap-0.5",
                  (uq?.changePct ?? pick.row.changePct) >= 0 ? "text-bullish" : "text-bearish",
                )}
              >
                {(uq?.changePct ?? pick.row.changePct) >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {(uq?.changePct ?? pick.row.changePct) >= 0 ? "+" : ""}
                {(uq?.changePct !== undefined
                  ? uq.changePct * 100
                  : pick.row.changePct
                ).toFixed(2)}
                %
              </span>
            )}
            <span className="text-muted-foreground/70 truncate">· {pick.row.name}</span>
          </div>
        </button>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <ClassificationBadge label={tier} large />
          {pick.quoteConfidenceLabel && <QuoteStatusBadge label={pick.quoteConfidenceLabel} />}
        </div>
      </div>

      {/* ── FOUR SCORE BARS ──────────────────────────────────── */}
      <div className="rounded-lg bg-surface/40 border border-border/60 px-3 py-2.5">
        <ScoreBar
          label="Setup"
          score={pick.setup_score ?? pick.row.setupScore ?? 0}
          note={pick.row.crl?.reason ?? undefined}
          compact
        />
        <ScoreBar
          label="Contract"
          score={pick.contract_score ?? 0}
          note={pick.contractScoreResult?.plain_english_reason}
          compact
        />
        <ScoreBar
          label="Execution"
          score={pick.execution_score ?? 0}
          note={pick.executionScoreResult?.plain_english_reason}
          compact
        />
        <ScoreBar
          label="Quote"
          score={pick.quote_confidence_score ?? pick.quoteConfidenceScore ?? 0}
          note={
            oq
              ? `${oq.source} · ${oq.quoteAgeSeconds.toFixed(0)}s old`
              : undefined
          }
          compact
        />
        <div className="flex justify-between pt-1.5 mt-1 border-t border-border/60">
          <span className="text-[12px] text-muted-foreground">Final Score</span>
          <span className="mono text-[13px] font-extrabold text-foreground">
            {pick.final_score ?? "—"}/100
          </span>
        </div>
      </div>

      {/* ── CONTRACT DETAILS ─────────────────────────────────── */}
      {oq && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] rounded-md bg-surface/30 border border-border/40 px-3 py-2">
          <Row k="Strike" v={`$${oq.strike}`} />
          <Row k="Expiry" v={`${oq.expiration} (${oq.dte}d)`} />
          <Row k="Bid / Ask" v={`$${oq.bid.toFixed(2)} / $${oq.ask.toFixed(2)}`} />
          <Row k="Mid ★" v={`$${oq.mid.toFixed(2)}`} bold />
          <Row
            k="Spread"
            v={`${(oq.spreadPct * 100).toFixed(1)}%${
              oq.spreadPct > 0.18 ? " — too wide" : oq.spreadPct > 0.12 ? " — wide" : " — ok"
            }`}
            tone={oq.spreadPct > 0.18 ? "bad" : oq.spreadPct > 0.12 ? "warn" : "good"}
          />
          <Row k="Vol / OI" v={`${oq.volume.toLocaleString()} / ${oq.openInterest.toLocaleString()}`} />
          <Row k="IV" v={`${(oq.iv * 100).toFixed(1)}%`} />
          <Row k="Delta" v={`Δ${oq.delta.toFixed(2)}`} />
          <Row k="Theta" v={`θ${oq.theta.toFixed(3)}/d`} tone="bad" />
        </div>
      )}

      {/* ── DECISION SECTION ─────────────────────────────────── */}
      <div className="border-t border-border/60 pt-2.5 space-y-1.5">
        <div className="text-[12px] text-foreground/85 italic leading-snug">
          “{pick.plain_english_summary ?? pick.humanQuoteSummary ?? pick.tierReason ?? "Evaluating…"}”
        </div>

        {(pick.quoteReport?.blockReasons ?? []).map((r, i) => (
          <div key={`b${i}`} className="text-[11px] text-bearish leading-snug">✕ {r}</div>
        ))}
        {(pick.quoteReport?.warnReasons ?? []).map((r, i) => (
          <div key={`w${i}`} className="text-[11px] text-warning leading-snug">⚠ {r}</div>
        ))}

        {/* High-impact contract issues */}
        {(pick.contractScoreResult?.score_components ?? [])
          .filter((c) => c.points < -8)
          .map((c, i) => (
            <div key={`c${i}`} className="text-[11px] text-warning leading-snug">⚠ {c.note}</div>
          ))}

        {/* High-impact execution issues */}
        {(pick.executionScoreResult?.score_components ?? [])
          .filter((c) => c.points < -10)
          .map((c, i) => (
            <div key={`e${i}`} className="text-[11px] text-warning leading-snug">⏳ {c.note}</div>
          ))}

        {/* Entry / Budget / Exit plan */}
        {tier !== "AVOID" && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] mt-2 rounded-md bg-surface/30 border border-border/40 px-3 py-2">
            <Row
              k="Entry"
              v={
                oq?.mid
                  ? `~$${oq.mid.toFixed(2)} mid`
                  : "—"
              }
            />
            <Row
              k="Est. fill"
              v={
                pick.estimatedFillCost
                  ? `$${pick.estimatedFillCost.toFixed(0)}${pick.budgetFitLabel ? ` (${pick.budgetFitLabel.replace("_", " ")})` : ""}`
                  : "—"
              }
              tone={
                pick.budgetFitLabel === "OVER_BUDGET"
                  ? "bad"
                  : pick.budgetFitLabel === "TIGHT"
                  ? "warn"
                  : "good"
              }
            />
            <Row
              k="Profit target"
              v={pick.exitPlan ? `+${(pick.exitPlan.profitTarget * 100).toFixed(0)}%` : "+50%"}
              tone="good"
            />
            <Row
              k="Stop loss"
              v={pick.exitPlan ? `${(pick.exitPlan.stopLoss * 100).toFixed(0)}%` : "−35%"}
              tone="bad"
            />
            <Row
              k="Time stop"
              v={`Close at ${pick.exitPlan?.maxDte ?? 7} DTE`}
            />
          </div>
        )}

        {/* Upgrade path — Watchlist / Needs Recheck only */}
        {tier !== "BUY NOW" && tier !== "AVOID" && (pick.upgradePath ?? []).length > 0 && (
          <div className="mt-2 px-3 py-2 rounded-md border border-primary/30 bg-primary/5">
            <div className="text-[10px] uppercase tracking-wider font-bold text-primary mb-1">
              What needs to improve
            </div>
            {(pick.upgradePath ?? []).map((step, i) => (
              <div key={i} className="text-[11px] text-primary/90 leading-snug">→ {step}</div>
            ))}
          </div>
        )}

        {/* Failing gates compact summary */}
        {(pick.failingGates ?? []).length > 0 && (
          <div className="mt-1 space-y-0.5">
            {(pick.failingGates ?? []).map((g, i) => (
              <div key={i} className="text-[10px] text-muted-foreground leading-snug">
                ✕ {g.gate}: {g.score}/100 (need {g.minimum}+) — {g.reason}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ACTIONS ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button
          size="sm"
          className="flex-1 min-w-[120px] h-9 text-sm font-semibold"
          onClick={() => onOpen?.(pick.row.symbol)}
        >
          Open {pick.row.symbol}
        </Button>
        <SaveToWatchlistButton
          size="sm"
          symbol={pick.row.symbol}
          direction="long"
          optionType={pick.contract.optionType}
          strike={pick.contract.strike}
          expiry={pick.contract.expiry}
          bias={pick.row.bias}
          tier={pick.row.readiness}
          entryPrice={pick.row.price}
          thesis={pick.plain_english_summary ?? pick.row.warnings[0] ?? pick.row.trendLabel}
          source="scanner"
          meta={{ setupScore: pick.row.setupScore, tier4: tier }}
        />
        {tier === "BUY NOW" && (
          <AddToPortfolioButton
            size="sm"
            spec={{
              symbol: pick.row.symbol,
              optionType: pick.contract.optionType,
              strike: pick.contract.strike,
              expiry: pick.contract.expiry,
              spot: pick.row.price,
              ivRank: pick.row.ivRank,
              bucket: rowBucket({
                riskBadge: pick.row.crl?.riskBadge,
                earningsInDays: pick.row.earningsInDays,
                ivRank: pick.row.ivRank,
              }),
              initialScore: pick.final_score ?? pick.row.setupScore,
              thesis: pick.plain_english_summary ?? pick.row.warnings[0] ?? pick.row.trendLabel,
              source: "scanner-bucket",
            }}
          />
        )}
      </div>

      {/* ── LIVE PRICE CHECK (collapsible) ───────────────────── */}
      {pick.quoteReport && (
        <div>
          <button
            type="button"
            onClick={() => setShowLive((s) => !s)}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground border border-border/60 rounded px-2 py-1 inline-flex items-center justify-center gap-1"
          >
            {showLive ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showLive ? "Hide Live Price Check" : "Show Live Price Check"}
          </button>
          {showLive && (
            <LivePricePanel
              quoteReport={pick.quoteReport}
              snapshotPrice={pick.row.price}
            />
          )}
        </div>
      )}

      {/* ── DEBUG PANEL ──────────────────────────────────────── */}
      <QuoteDebugPanel pick={pick} />
    </Card>
  );
}

function Row({
  k,
  v,
  bold,
  tone,
}: {
  k: string;
  v: string;
  bold?: boolean;
  tone?: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-bullish"
      : tone === "warn"
      ? "text-warning"
      : tone === "bad"
      ? "text-bearish"
      : "text-foreground";
  return (
    <>
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("mono text-right", toneCls, bold && "font-bold")}>{v}</span>
    </>
  );
}
