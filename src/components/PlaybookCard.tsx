// April 2026 Strategic Playbook — curated picks reflecting the
// "Actuals over Hype" thesis (FCF, data-center revenue, hyperscaler capex).
// Energy Wall risk can downgrade GO → WAIT (driven by news sentiment).
import { Card } from "@/components/ui/card";
import { BookOpenCheck, AlertTriangle } from "lucide-react";
import { useNarrativeSignals } from "@/lib/sentimentSignals";

type Risk = "Safe" | "Mild" | "Aggressive";
type Action = "GO" | "WAIT" | "NO";

interface PlaybookEntry {
  symbol: string;
  risk: Risk;
  baseAction: Action;
  thesis: string;          // why this pick (actuals-driven)
  energyExposed: boolean;  // if true, Energy Wall pressure flips GO → WAIT
}

const PLAYBOOK: PlaybookEntry[] = [
  {
    symbol: "SMH",
    risk: "Safe",
    baseAction: "GO",
    thesis: "VanEck semis ETF near intrinsic equilibrium for 2026 supercycle — diversified hyperscaler capex exposure.",
    energyExposed: true,
  },
  {
    symbol: "ASML",
    risk: "Mild",
    baseAction: "GO",
    thesis: "Raised 2026 sales outlook to €40B. Q1 profits beat — HBM4/EUV demand structurally tight.",
    energyExposed: false,
  },
  {
    symbol: "ON",
    risk: "Aggressive",
    baseAction: "WAIT",
    thesis: "Mixed earnings + elevated insider selling. Modeled ~10% downside before re-entry.",
    energyExposed: false,
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
  const { energy } = useNarrativeSignals();
  const energyDowngrade = energy.tone === "bad";

  return (
    <Card className="glass-card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-primary" /> April 2026 Playbook
        </h2>
        <span className="text-[10px] tracking-wider uppercase text-muted-foreground">Actuals &gt; Hype</span>
      </div>

      {energyDowngrade && (
        <div className="mb-3 p-2 rounded-md border border-warning/40 bg-warning/10 flex items-start gap-2 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Energy Wall pressure detected — energy-exposed GO signals temporarily flipped to <strong>WAIT</strong>.</span>
        </div>
      )}

      <div className="space-y-2">
        {PLAYBOOK.map((p) => {
          const action: Action =
            p.baseAction === "GO" && p.energyExposed && energyDowngrade ? "WAIT" : p.baseAction;
          const downgraded = action !== p.baseAction;
          return (
            <button
              key={p.symbol}
              onClick={() => onPick(p.symbol)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all"
            >
              <div className="font-mono font-bold text-sm w-14">{p.symbol}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`pill ${RISK_PILL[p.risk]}`}>{p.risk}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold tracking-wider ${ACTION_PILL[action]}`}>
                    {action}
                  </span>
                  {downgraded && (
                    <span className="text-[9px] text-warning">⚡ energy-downgraded from GO</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{p.thesis}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
        Curated thesis based on hyperscaler capex commitments (Meta, Microsoft) and confirmed Q1 actuals.
        Auto-adjusts when grid/power risk surfaces in news.
      </div>
    </Card>
  );
}
