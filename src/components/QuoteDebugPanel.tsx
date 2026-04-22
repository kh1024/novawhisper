// ─── QUOTE DEBUG PANEL ───────────────────────────────────────────────────────
// Per-pick dev drawer — shows quote source, freshness, spread, provider
// conflict, score breakdown, and the engine's block/warn reasons.
// Hidden behind a "Debug" toggle button on each pick card.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ApprovedPick } from "@/lib/useScannerPicks";

interface Props {
  pick: ApprovedPick;
}

export function QuoteDebugPanel({ pick }: Props) {
  const [open, setOpen] = useState(false);
  const qr = pick.quoteReport;
  if (!qr) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border/60 rounded px-2 py-0.5"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? "Hide debug" : "Debug"}
      </button>
      {open && (
        <pre className="mt-2 text-[10px] font-mono text-muted-foreground bg-surface/40 border border-border rounded p-2 overflow-x-auto leading-snug whitespace-pre-wrap">
{`SCORE
  setup:    ${pick.row.setupScore}
  adjusted: ${pick.adjustedScore}
  tier:     ${pick.tradeState}

OPTION QUOTE
  source:    ${qr.optionQuote.source}
  status:    ${qr.optionQuote.status}
  age:       ${qr.optionQuote.quoteAgeSeconds.toFixed(1)}s
  bid/ask:   $${qr.optionQuote.bid.toFixed(2)} / $${qr.optionQuote.ask.toFixed(2)}
  mid:       $${qr.optionQuote.mid.toFixed(2)}
  last:      $${qr.optionQuote.last.toFixed(2)}
  spread:    ${(qr.optionQuote.spreadPct * 100).toFixed(2)}%
  conf:      ${qr.optionQuote.quoteConfidenceScore}/100 (${qr.optionQuote.quoteConfidenceLabel})
  liquidity: ${qr.optionQuote.liquidityScore}/100
  exec:      ${qr.optionQuote.isExecutable ? "YES" : "NO"}

UNDERLYING
  price:  $${qr.underlyingQuote.lastPrice.toFixed(2)}
  source: ${qr.underlyingQuote.source}
  age:    ${qr.underlyingQuote.quoteAgeSeconds.toFixed(1)}s
  status: ${qr.underlyingQuote.status}
  moved:  ${(qr.underlyingMovePct * 100).toFixed(3)}% since snapshot
  recalc: ${qr.requiresRecalc ? "YES" : "no"}

CONFLICT
  exists: ${qr.providerConflict.exists ? "YES" : "no"}
  diff:   ${(qr.providerConflict.disagreementPct * 100).toFixed(3)}%
  ${qr.providerConflict.primarySource} @ $${qr.providerConflict.primaryMid.toFixed(2)} vs ${qr.providerConflict.secondarySource} @ $${qr.providerConflict.secondaryMid.toFixed(2)}

BLOCK (${qr.blockReasons.length})
${qr.blockReasons.length === 0 ? "  (none)" : qr.blockReasons.map((r) => "  • " + r).join("\n")}

WARN (${qr.warnReasons.length})
${qr.warnReasons.length === 0 ? "  (none)" : qr.warnReasons.map((r) => "  • " + r).join("\n")}

CLASSIFICATION
  tier:        ${pick.tier4 ?? "(unset)"}
  reason:      ${pick.tierReason ?? "(unset)"}
  hard block:  ${pick.isHardBlocked ? "YES" : "no"}
  failing gates (${(pick.failingGates ?? []).length}):
${
  (pick.failingGates ?? []).length === 0
    ? "    (none — all gates passed)"
    : (pick.failingGates ?? []).map((g) => `    • ${g.gate}: ${g.score}/${g.minimum} — ${g.reason}`).join("\n")
}
  upgrade path:
${
  (pick.upgradePath ?? []).length === 0
    ? "    (n/a)"
    : (pick.upgradePath ?? []).map((s) => `    → ${s}`).join("\n")
}

4-SCORE SUMMARY
  setup:    ${pick.setup_score ?? "—"}/100
  contract: ${pick.contract_score ?? "—"}/100
  execution:${pick.execution_score ?? "—"}/100
  quote:    ${pick.quote_confidence_score ?? "—"}/100
  final:    ${pick.final_score ?? "—"}/100`}
        </pre>
      )}
    </div>
  );
}
