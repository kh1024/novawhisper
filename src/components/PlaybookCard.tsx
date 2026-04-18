// Strategic playbook — curated discretionary picks. Action labels are static
// here; live event-risk signals are surfaced separately on the dashboard.
import { Card } from "@/components/ui/card";
import { BookOpenCheck } from "lucide-react";

type Risk = "Safe" | "Mild" | "Aggressive";
type Action = "GO" | "WAIT" | "NO";

interface PlaybookEntry {
  symbol: string;
  risk: Risk;
  action: Action;
  thesis: string;
}

const PLAYBOOK: PlaybookEntry[] = [
  {
    symbol: "SMH",
    risk: "Safe",
    action: "GO",
    thesis: "Diversified semis ETF — broad exposure without single-name earnings risk.",
  },
  {
    symbol: "ASML",
    risk: "Mild",
    action: "GO",
    thesis: "Raised 2026 sales outlook. Q1 profits beat — EUV demand structurally tight.",
  },
  {
    symbol: "ON",
    risk: "Aggressive",
    action: "WAIT",
    thesis: "Mixed earnings + elevated insider selling. Wait for re-entry.",
  },
];

const RISK_PILL: Record<Risk, string> = {
  Safe: "pill-bullish",
  Mild: "pill-neutral",
  Aggressive: "pill-bearish",
};

const ACTION_PILL: Record<Action, string> = {
  GO: "bg-bullish/15 text-bullish border-bullish/40",
  WAIT: "bg-warning/15 text-warning border-warning/40",
  NO: "bg-bearish/15 text-bearish border-bearish/40",
};

export function PlaybookCard({ onPick }: { onPick: (sym: string) => void }) {
  return (
    <Card className="glass-card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-primary" /> Playbook
        </h2>
        <span className="text-[10px] tracking-wider uppercase text-muted-foreground">Actuals &gt; Hype</span>
      </div>

      <div className="space-y-2">
        {PLAYBOOK.map((p) => (
          <button
            key={p.symbol}
            onClick={() => onPick(p.symbol)}
            className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all"
          >
            <div className="font-mono font-bold text-sm w-14">{p.symbol}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`pill ${RISK_PILL[p.risk]}`}>{p.risk}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold tracking-wider ${ACTION_PILL[p.action]}`}>
                  {p.action}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{p.thesis}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
        Discretionary picks. Always verify against the live Event-Risk panel before sizing up.
      </div>
    </Card>
  );
}
