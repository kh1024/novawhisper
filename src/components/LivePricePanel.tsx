// Shows current bid/ask/mid/spread/quote age for the option contract.
import type { QuoteIntegrityReport } from "@/lib/quotes/quoteTypes";

interface LivePricePanelProps {
  quoteReport?: QuoteIntegrityReport;
  snapshotPrice?: number;
}

const Row = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div className="flex justify-between border-b border-border/40 py-0.5">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className={`text-[11px] ${warn ? "font-bold text-amber-400" : "text-foreground/80"}`}>{value}</span>
  </div>
);

export function LivePricePanel({ quoteReport, snapshotPrice }: LivePricePanelProps) {
  if (!quoteReport) {
    return (
      <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
        No live quote data available.
      </div>
    );
  }
  const oq = quoteReport.optionQuote;
  const uq = quoteReport.underlyingQuote;
  const moved = quoteReport.requiresRecalc;
  const movePct = (quoteReport.underlyingMovePct * 100).toFixed(2);

  return (
    <div className={`mt-2 rounded-md bg-muted/30 px-3 py-2 ${moved ? "border border-amber-500" : "border border-border"}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Live Price Check</span>
        <span className={`text-[10px] ${oq.quoteAgeSeconds > 60 ? "text-red-400" : oq.quoteAgeSeconds > 15 ? "text-amber-400" : "text-emerald-400"}`}>
          {oq.quoteAgeSeconds.toFixed(0)}s ago · {oq.source}
        </span>
      </div>

      {snapshotPrice && snapshotPrice > 0 && (
        <>
          <Row label="Snapshot price" value={`$${snapshotPrice.toFixed(2)}`} />
          <Row
            label="Current price"
            value={`$${uq.lastPrice.toFixed(2)}${moved ? ` (+${movePct}% — RECALC NEEDED)` : ""}`}
            warn={moved}
          />
        </>
      )}

      <div className="mt-1">
        <Row label="Option Bid" value={`$${oq.bid.toFixed(2)}`} />
        <Row label="Option Ask" value={`$${oq.ask.toFixed(2)}`} />
        <Row label="Option Mid ★" value={`$${oq.mid.toFixed(2)}`} />
        <Row label="Option Last" value={`$${oq.last.toFixed(2)} (ref only)`} />
        <Row
          label="Spread"
          value={`${(oq.spreadPct * 100).toFixed(1)}% ($${oq.spreadDollars.toFixed(2)})`}
          warn={oq.spreadPct > 0.12}
        />
        <Row label="Volume / OI" value={`${oq.volume.toLocaleString()} / ${oq.openInterest.toLocaleString()}`} />
        <Row label="IV" value={`${(oq.iv * 100).toFixed(1)}%`} />
        <Row label="Delta" value={`Δ${oq.delta.toFixed(2)}`} />
        <Row label="Confidence" value={`${oq.quoteConfidenceScore}/100 — ${oq.quoteConfidenceLabel}`} />
      </div>

      {moved && (
        <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
          ⚠ Underlying moved {movePct}% since snapshot — entry zone, score, and cost need recalc.
        </div>
      )}
    </div>
  );
}
