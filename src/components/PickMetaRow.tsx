// Shared "Bias / Timing / Risk / Contract" labeled row + optional Verdict badge.
// Single component used by every place we render a tradeable pick (watchlist,
// dashboard top opportunities, market hottest, scanner, planning) so the
// language and layout stay identical app-wide.
//
// All semantics come from src/lib/verdictModel.ts — this component is a thin
// presentational wrapper. Pass an `inputs` object and it derives everything
// (bias / timing / risk / contract / verdict). Pass an explicit `result` to
// reuse a pre-computed verdict (the Scanner does this so the row badge and
// the summary counters can never disagree).
import { useMemo } from "react";
import { Hint } from "@/components/Hint";
import {
  computeVerdict,
  biasClasses,
  timingClasses,
  riskClasses,
  verdictClasses,
  FIELD_TOOLTIPS,
  TIMING_TOOLTIP,
  RISK_TOOLTIP,
  VERDICT_TOOLTIP,
  type VerdictInputs,
  type VerdictResult,
  type Verdict,
} from "@/lib/verdictModel";

export type { Verdict } from "@/lib/verdictModel";

interface Props {
  /** Either compute on the fly… */
  inputs?: VerdictInputs;
  /** …or pass a pre-computed verdict (preferred — keeps page-level summaries in sync). */
  result?: VerdictResult;
  /** Optional expiry shown next to the contract. */
  expiry?: string | null;
  /** Render the colored Verdict badge inline at the end of the row. */
  showVerdict?: boolean;
  /** Layout variant — grid (default) is 4 columns; row is single-line. */
  variant?: "grid" | "row";
  className?: string;
}

export function PickMetaRow({
  inputs,
  result,
  expiry,
  showVerdict = false,
  variant = "grid",
  className,
}: Props) {
  const r = useMemo<VerdictResult>(
    () => result ?? computeVerdict(inputs ?? {}),
    [result, inputs],
  );

  const wrapperCls =
    variant === "row"
      ? `flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-tight ${className ?? ""}`
      : `grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] leading-tight ${className ?? ""}`;

  return (
    <div className={wrapperCls}>
      <Hint label={FIELD_TOOLTIPS.bias}>
        <div className="cursor-help">
          <span className="text-muted-foreground">Bias:</span>{" "}
          <span className={`font-semibold ${biasClasses(r.bias)}`}>{r.bias}</span>
        </div>
      </Hint>

      <Hint label={`${FIELD_TOOLTIPS.timing} — ${TIMING_TOOLTIP[r.timing]}`}>
        <div className="cursor-help">
          <span className="text-muted-foreground">Timing:</span>{" "}
          <span className={`font-semibold ${timingClasses(r.timing)}`}>{r.timing}</span>
        </div>
      </Hint>

      <Hint label={`${FIELD_TOOLTIPS.risk} — ${RISK_TOOLTIP[r.risk]}`}>
        <div className="cursor-help">
          <span className="text-muted-foreground">Risk:</span>{" "}
          <span className={`font-semibold ${riskClasses(r.risk)}`}>{r.risk}</span>
        </div>
      </Hint>

      <Hint label={`${FIELD_TOOLTIPS.contract} ${r.contract.reason}`}>
        <div className="truncate cursor-help">
          <span className="text-muted-foreground">Contract:</span>{" "}
          <span className="font-semibold mono text-foreground">{r.contract.label}</span>
          {expiry ? <span className="text-muted-foreground"> · {expiry}</span> : null}
        </div>
      </Hint>

      {showVerdict && <VerdictBadge verdict={r.verdict} reason={r.reason} />}
    </div>
  );
}

/** Standalone Verdict badge — exported so consumers can place it anywhere on
 *  the row (e.g. the right-hand side of a watchlist card). */
export function VerdictBadge({
  verdict,
  reason,
  className,
}: {
  verdict: Verdict;
  reason?: string;
  className?: string;
}) {
  return (
    <Hint label={`${VERDICT_TOOLTIP[verdict]}${reason ? ` — ${reason}` : ""}`}>
      <span
        className={`text-[10px] font-bold tracking-wider uppercase px-2 py-1 rounded border whitespace-nowrap cursor-help ${verdictClasses(
          verdict,
        )} ${className ?? ""}`}
      >
        {verdict}
      </span>
    </Hint>
  );
}
