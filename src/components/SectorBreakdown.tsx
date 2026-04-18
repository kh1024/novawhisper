// Top Sectors card — click a row to expand and reveal live ticker breakdown.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import type { VerifiedQuote } from "@/lib/liveData";

// Display name → underlying sector tag(s) used in TICKER_UNIVERSE.
const SECTOR_MAP: { name: string; tags: string[] }[] = [
  { name: "Semiconductors", tags: ["Semis"] },
  { name: "Technology", tags: ["Tech"] },
  { name: "Financials", tags: ["Financials"] },
  { name: "Energy", tags: ["Energy"] },
  { name: "Healthcare", tags: ["Healthcare"] },
];

type Props = {
  quotes: VerifiedQuote[];
  onPick: (symbol: string) => void;
};

export function SectorBreakdown({ quotes, onPick }: Props) {
  const [openName, setOpenName] = useState<string | null>(null);

  // Compute live avg %, member tickers per sector
  const rows = SECTOR_MAP.map((s) => {
    const members = quotes.filter((q) => q.sector && s.tags.includes(q.sector));
    const avg = members.length
      ? members.reduce((sum, q) => sum + q.changePct, 0) / members.length
      : 0;
    return { ...s, avg, members: members.sort((a, b) => b.changePct - a.changePct) };
  }).sort((a, b) => b.avg - a.avg);

  return (
    <Card className="glass-card p-5">
      <h2 className="text-sm font-semibold tracking-wide mb-3">Top Sectors</h2>
      <div className="space-y-1">
        {rows.map((s) => {
          const up = s.avg >= 0;
          const isOpen = openName === s.name;
          const hasMembers = s.members.length > 0;
          return (
            <div key={s.name} className="rounded-md border border-border/40 overflow-hidden">
              <button
                onClick={() => hasMembers && setOpenName(isOpen ? null : s.name)}
                disabled={!hasMembers}
                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-surface/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                <span className="text-xs flex-1 text-left">{s.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[80px]">
                  <div
                    className={up ? "h-full bg-bullish" : "h-full bg-bearish"}
                    style={{ width: `${Math.min(100, Math.abs(s.avg) * 30)}%` }}
                  />
                </div>
                <span className={`mono text-xs w-14 text-right ${up ? "text-bullish" : "text-bearish"}`}>
                  {hasMembers ? `${up ? "+" : ""}${s.avg.toFixed(2)}%` : "—"}
                </span>
              </button>
              {isOpen && hasMembers && (
                <div className="border-t border-border/40 bg-surface/20 px-2 py-1.5 space-y-0.5">
                  {s.members.map((m) => {
                    const mUp = m.change >= 0;
                    return (
                      <button
                        key={m.symbol}
                        onClick={() => onPick(m.symbol)}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-surface text-left transition-colors"
                      >
                        <span className="font-mono text-[11px] font-semibold w-12">{m.symbol}</span>
                        <span className="text-[11px] text-muted-foreground flex-1 truncate">{m.name}</span>
                        <span className="mono text-[11px] w-16 text-right">${m.price.toFixed(2)}</span>
                        <span className={`mono text-[11px] w-14 text-right ${mUp ? "text-bullish" : "text-bearish"}`}>
                          {mUp ? "+" : ""}{m.changePct.toFixed(2)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
