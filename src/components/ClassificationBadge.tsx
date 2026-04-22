type ClassLabel = "BUY NOW" | "WATCHLIST" | "NEEDS RECHECK" | "AVOID" | "WATCH" | string;

const CLASS_CLASSES: Record<string, string> = {
  "BUY NOW": "bg-emerald-900 text-emerald-50 border-2 border-emerald-500",
  WATCHLIST: "bg-blue-900 text-blue-100 border-2 border-blue-500",
  WATCH: "bg-blue-900 text-blue-100 border-2 border-blue-500",
  "NEEDS RECHECK": "bg-amber-900 text-amber-100 border-2 border-amber-500",
  AVOID: "bg-muted text-muted-foreground border border-border",
};

export function ClassificationBadge({ label, large = false }: { label: ClassLabel; large?: boolean }) {
  const key = label.toUpperCase();
  const cls = CLASS_CLASSES[key] ?? CLASS_CLASSES.AVOID;
  const sizeCls = large ? "text-[13px] px-3 py-1" : "text-[11px] px-2 py-0.5";
  return (
    <span className={`inline-block rounded font-extrabold tracking-wider ${cls} ${sizeCls}`}>
      {key}
    </span>
  );
}
