// Collapsible Blocked Section — wraps the APPROVED / BUDGET BLOCKED /
// SAFETY BLOCKED groups on the Scanner. Spec section 6.
//
// Default expansion rule:
//   • pre-market  → SAFETY BLOCKED expanded so the user sees what's queued.
//   • market open → all collapsed (focus on the approved list).
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CollapsibleBlockedSectionProps {
  title: string;
  count: number;
  subtitle?: string;
  /** "approved" | "budget" | "safety" — drives accent color. */
  tone: "approved" | "budget" | "safety";
  /** Force expanded on mount (e.g. pre-market for safety). */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const toneClasses: Record<CollapsibleBlockedSectionProps["tone"], { ring: string; chip: string; label: string }> = {
  approved: {
    ring: "border-bullish/30 bg-bullish/5",
    chip: "bg-bullish/15 text-bullish border-bullish/40",
    label: "APPROVED",
  },
  budget: {
    ring: "border-warning/30 bg-warning/5",
    chip: "bg-warning/15 text-warning border-warning/40",
    label: "BUDGET BLOCKED",
  },
  safety: {
    ring: "border-bearish/30 bg-bearish/5",
    chip: "bg-bearish/15 text-bearish border-bearish/40",
    label: "SAFETY BLOCKED",
  },
};

export function CollapsibleBlockedSection({
  title, count, subtitle, tone, defaultOpen = false, children,
}: CollapsibleBlockedSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  // keep state in sync if defaultOpen flips (e.g. pre-market → market open)
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);

  const t = toneClasses[tone];

  return (
    <section className={cn("rounded-lg border", t.ring)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className={cn("text-[10px] font-bold tracking-[0.18em] px-2 py-0.5 rounded border", t.chip)}>
          {t.label} · {count}
        </span>
        <span className="text-sm font-medium text-foreground">{title}</span>
        {subtitle && <span className="text-[11px] text-muted-foreground ml-auto">{subtitle}</span>}
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1">
          {children}
        </div>
      )}
    </section>
  );
}
