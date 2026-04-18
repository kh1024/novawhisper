import { Card } from "@/components/ui/card";
import { Wallet, Check } from "lucide-react";
import { useBudget } from "@/lib/budget";
import { useState, useEffect } from "react";

const PRESETS = [250, 500, 1000, 2500, 5000];

export default function Settings() {
  const [budget, setBudget] = useBudget();
  const [draft, setDraft] = useState<string>(String(budget));
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => setDraft(String(budget)), [budget]);

  const commit = (v: number) => {
    setBudget(v);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Workspace defaults applied across Nova analysis.</p>
      </div>

      <Card className="glass-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" /> Default trade budget
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Max you'd spend on a single options trade. Nova uses this to filter picks you can actually afford and is pre-filled in every Research drawer.
            </p>
          </div>
          {savedFlash && (
            <span className="pill pill-bullish text-[10px]"><Check className="h-3 w-3" /> Saved</span>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              min={50}
              step={50}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(Math.max(50, Number(draft) || 500))}
              onKeyDown={(e) => e.key === "Enter" && commit(Math.max(50, Number(draft) || 500))}
              className="w-40 h-10 pl-7 pr-3 text-base font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => commit(v)}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  budget === v
                    ? "bg-primary/20 border-primary text-primary"
                    : "border-border text-muted-foreground hover:bg-surface"
                }`}
              >
                ${v >= 1000 ? `${v / 1000}k` : v}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
          Current default: <span className="font-mono text-foreground">${budget.toLocaleString()}</span>
        </div>
      </Card>

      <Card className="glass-card p-6">
        <h2 className="text-sm font-semibold mb-2">Coming soon</h2>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>Data sources & API health</li>
          <li>AI provider & default risk profile</li>
          <li>Refresh interval and ticker tape symbols</li>
        </ul>
      </Card>
    </div>
  );
}
