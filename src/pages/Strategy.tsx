// Strategy Builder — picks options strategies that match the trader's profile
// (risk tolerance, horizon, outlook, event, IV stance, account size).
// Pure heuristic — see src/lib/strategyBuilder.ts for the decision tree.
import { Brain, Compass, Shield, Target, Zap, AlertTriangle, BookOpen, RotateCcw, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettings, type TraderProfile } from "@/lib/settings";
import {
  recommendStrategies,
  RISK_LABELS,
  HORIZON_LABELS,
  OUTLOOK_LABELS,
  EVENT_LABELS,
  ACCOUNT_LABELS,
  IV_LABELS,
  type RiskBucket,
  type StrategySuggestion,
} from "@/lib/strategyBuilder";
import { cn } from "@/lib/utils";

const BUCKET_META: Record<RiskBucket, { label: string; cls: string; chipCls: string; icon: typeof Shield }> = {
  safe:       { label: "Safe",       cls: "border-bullish/30 bg-bullish/5",  chipCls: "text-bullish border-bullish/40 bg-bullish/10",  icon: Shield },
  mild:       { label: "Mild",       cls: "border-warning/30 bg-warning/5",  chipCls: "text-warning border-warning/40 bg-warning/10",  icon: Target },
  aggressive: { label: "Aggressive", cls: "border-bearish/30 bg-bearish/5",  chipCls: "text-bearish border-bearish/40 bg-bearish/10",  icon: Zap },
};

type SegOption<T extends string> = { value: T; label: string; hint?: string };

function Segmented<T extends string>({
  value, onChange, options, ariaLabel,
}: { value: T; onChange: (v: T) => void; options: SegOption<T>[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1 rounded-md border border-border bg-surface/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-surface hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_PROFILE: TraderProfile = {
  risk: "medium",
  horizon: "swing",
  outlook: "slightly_bullish",
  event: "none",
  account: "small",
  ivStance: "average",
};

export default function Strategy() {
  const [settings, updateSettings] = useSettings();
  const profile = settings.traderProfile;
  const setProfile = (patch: Partial<TraderProfile>) =>
    updateSettings({ traderProfile: { ...profile, ...patch } });

  const suggestions = recommendStrategies(profile);
  const grouped: Record<RiskBucket, StrategySuggestion[]> = { safe: [], mild: [], aggressive: [] };
  for (const s of suggestions) grouped[s.bucket].push(s);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Compass className="h-3.5 w-3.5" /> Strategy Builder
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Match the strategy to the setup</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tell Nova your risk, horizon and read on the tape. We'll suggest the structures that actually fit —
            with defined-risk math, IV stance, and the warnings that matter.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setProfile(DEFAULT_PROFILE)}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset profile
        </Button>
      </div>

      {/* Profile inputs */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Brain className="h-3.5 w-3.5" /> Your profile · saved to Settings
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Risk tolerance</Label>
            <Segmented
              ariaLabel="Risk tolerance"
              value={profile.risk}
              onChange={(v) => setProfile({ risk: v })}
              options={(["low","medium","high"] as const).map((v) => ({ value: v, label: RISK_LABELS[v] }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Horizon</Label>
            <Segmented
              ariaLabel="Horizon"
              value={profile.horizon}
              onChange={(v) => setProfile({ horizon: v })}
              options={(["intraday","swing","position"] as const).map((v) => ({ value: v, label: HORIZON_LABELS[v] }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Account size</Label>
            <Segmented
              ariaLabel="Account size"
              value={profile.account}
              onChange={(v) => setProfile({ account: v })}
              options={(["small","medium","large"] as const).map((v) => ({ value: v, label: ACCOUNT_LABELS[v] }))}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Outlook on the trade</Label>
            <Segmented
              ariaLabel="Outlook"
              value={profile.outlook}
              onChange={(v) => setProfile({ outlook: v })}
              options={(["bullish","slightly_bullish","neutral","slightly_bearish","bearish","uncertain"] as const)
                .map((v) => ({ value: v, label: OUTLOOK_LABELS[v] }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Catalyst</Label>
            <Segmented
              ariaLabel="Catalyst"
              value={profile.event}
              onChange={(v) => setProfile({ event: v })}
              options={(["none","earnings","macro"] as const).map((v) => ({ value: v, label: EVENT_LABELS[v] }))}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">IV stance · how rich does premium feel?</Label>
            <Segmented
              ariaLabel="IV stance"
              value={profile.ivStance}
              onChange={(v) => setProfile({ ivStance: v })}
              options={(["low","average","high"] as const).map((v) => ({ value: v, label: IV_LABELS[v] }))}
            />
          </div>
        </div>
      </Card>

      {/* Suggestions */}
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> Recommended structures · {suggestions.length}
        </div>
        {(["safe","mild","aggressive"] as RiskBucket[]).map((bucket) => {
          const items = grouped[bucket];
          if (items.length === 0) return null;
          const meta = BUCKET_META[bucket];
          const Icon = meta.icon;
          return (
            <div key={bucket} className="space-y-2">
              <div className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", meta.chipCls)}>
                <Icon className="h-3 w-3" /> {meta.label} · {items.length}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((s) => <StrategyCard key={s.kind} s={s} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Disclosures */}
      <Card className="border-warning/30 bg-warning/5 p-4 text-xs leading-relaxed text-muted-foreground">
        <div className="flex items-start gap-2 text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold uppercase tracking-widest text-[10px]">Risk disclosure</div>
            <p>
              Options involve significant risk and aren't suitable for every investor. These suggestions are
              educational heuristics, not financial advice. Past performance is not indicative of future results.
              Always confirm liquidity (open interest + tight bid/ask), check the actual implied-volatility
              percentile, define your maximum loss, and consult a qualified advisor before placing any trade.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StrategyCard({ s }: { s: StrategySuggestion }) {
  const meta = BUCKET_META[s.bucket];
  const Icon = meta.icon;
  return (
    <Card className={cn("flex flex-col p-4 space-y-3", meta.cls)}>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", meta.chipCls)}>
            <Icon className="h-3 w-3" /> {meta.label}
          </span>
          <Badge variant="outline" className="text-[10px] capitalize">
            {s.ivStance}
          </Badge>
        </div>
        <div className="font-semibold text-sm leading-tight">{s.name}</div>
        <p className="text-[11px] text-muted-foreground">{s.tagline}</p>
      </div>

      <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Why this fits</div>
        <p className="text-xs text-foreground/90 leading-snug">{s.why}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Max loss</div>
          <div className="text-foreground/90">{s.maxLoss}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Max gain</div>
          <div className="text-foreground/90">{s.maxGain}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Suggested DTE</div>
          <div className="text-foreground/90">{s.dteHint}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Strikes</div>
          <div className="text-foreground/90">{s.strikeHint}</div>
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-1.5 text-[11px]">
        <span className="text-muted-foreground">Sizing · </span>
        <span className="text-foreground/90">{s.sizingHint}</span>
      </div>

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer flex items-center gap-1 hover:text-foreground">
          <BookOpen className="h-3 w-3" /> How it works
        </summary>
        <p className="mt-1 leading-snug">{s.mechanics}</p>
      </details>

      {s.warnings.length > 0 && (
        <div className="space-y-1">
          {s.warnings.map((w, i) => (
            <div key={i} className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning leading-snug">
              {w}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
