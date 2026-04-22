type ConfidenceLabel = "VERIFIED" | "ACCEPTABLE" | "CAUTION" | "UNRELIABLE" | "BLOCKED";

const BADGE_TEXT: Record<ConfidenceLabel, string> = {
  VERIFIED: "✓ Real-Time",
  ACCEPTABLE: "✓ Fresh",
  CAUTION: "⚠ Delayed",
  UNRELIABLE: "⚠ Stale Data",
  BLOCKED: "✕ No Live Quote",
};

const BADGE_CLASSES: Record<ConfidenceLabel, string> = {
  VERIFIED: "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50",
  ACCEPTABLE: "bg-blue-900/60 text-blue-300 border border-blue-700/50",
  CAUTION: "bg-amber-900/60 text-amber-300 border border-amber-700/50",
  UNRELIABLE: "bg-red-900/60 text-red-300 border border-red-700/50",
  BLOCKED: "bg-muted text-muted-foreground border border-border",
};

export function QuoteStatusBadge({ label }: { label?: ConfidenceLabel | string }) {
  const key = (label as ConfidenceLabel) ?? "BLOCKED";
  const text = BADGE_TEXT[key] ?? BADGE_TEXT.BLOCKED;
  const cls = BADGE_CLASSES[key] ?? BADGE_CLASSES.BLOCKED;
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
      {text}
    </span>
  );
}
