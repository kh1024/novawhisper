// Master Strategy Controller — the trading persona that every other page
// (Scanner, Portfolio, Picks, Alerts, Planning) reads as a global filter.
import { useEffect, useMemo, useState } from "react";
import {
  Compass, Wallet, Layers, ShieldAlert, Target, Sparkles, ArrowRight,
  RotateCcw, Check, AlertTriangle, ChevronDown, ChevronRight, Save, Brain, Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/Hint";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useStrategyProfile, mergeProfile, applyPreset, personaName, gateProfileLabel,
  allowedStructureCount, maxPerTradeDollars, PRESETS,
  type StrategyProfile, type RiskTolerance, type Horizon, type MarketBias,
  type IvStance, type CatalystMode, type TickerUniverse, type AllowedStructures,
} from "@/lib/strategyProfile";
import { useCapitalSettings } from "@/lib/budget";
import { useSettings } from "@/lib/settings";

// ─── Migration: if user already had account-size in budget store, copy it once ─
function useOneTimeMigration(profile: StrategyProfile, update: (p: Partial<StrategyProfile>) => void) {
  const { portfolio, riskPct } = useCapitalSettings();
  const [settings] = useSettings();
  useEffect(() => {
    const flag = "nova_strategy_migrated_v1";
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(flag)) return;
    // Only migrate if Strategy is still at literal defaults (10k / 5%) and the
    // legacy budget store has different values worth preserving.
    const isDefault = profile.accountSize === 10_000 && profile.maxPerTradePct === 5;
    if (!isDefault) {
      window.localStorage.setItem(flag, "skipped-already-customized");
      return;
    }
    const hasLegacy =
      portfolio !== 25_000 ||
      riskPct !== 2 ||
      (settings.customTickers?.length ?? 0) > 0;
    if (hasLegacy) {
      update({
        accountSize: portfolio,
        maxPerTradePct: Math.min(10, Math.max(1, Math.round(riskPct))),
        customTickers: settings.customTickers ?? [],
      });
      toast.success("Settings migrated to Strategy", {
        description: `Account $${portfolio.toLocaleString()} · ${Math.round(riskPct)}%/trade`,
      });
    }
    window.localStorage.setItem(flag, new Date().toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── Reusable inputs ────────────────────────────────────────────────────────
function Segmented<T extends string>({
  value, onChange, options, ariaLabel,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; ariaLabel: string }) {
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

function Section({ title, icon: Icon, hint, children, className }: {
  title: string; icon: typeof Compass; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-5 space-y-4", className)}>
      <div className="flex items-center gap-2">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        {hint && (
          <Hint label={hint}>
            <span className="text-[10px] text-muted-foreground/60 cursor-help">ⓘ</span>
          </Hint>
        )}
      </div>
      {children}
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
        {hint && (
          <Hint label={hint}>
            <span className="text-[10px] text-muted-foreground/60 cursor-help">ⓘ</span>
          </Hint>
        )}
      </div>
      {children}
    </div>
  );
}

const STRUCTURES: { key: keyof AllowedStructures; label: string; hint: string }[] = [
  { key: "longCall",         label: "Long Call",         hint: "Standard directional call buy. Defined risk = premium paid." },
  { key: "longPut",          label: "Long Put",          hint: "Standard directional put buy. Defined risk = premium paid." },
  { key: "leapsCall",        label: "LEAPS Call",        hint: "Long-dated call (≥180 DTE). Stock replacement. Less theta, more capital." },
  { key: "leapsPut",         label: "LEAPS Put",         hint: "Long-dated put (≥180 DTE). Long-term hedge or thesis bet." },
  { key: "callDebitSpread",  label: "Call Debit Spread", hint: "Buy lower strike + sell higher strike. Caps risk AND reward — cheaper entry." },
  { key: "putDebitSpread",   label: "Put Debit Spread",  hint: "Buy higher strike + sell lower strike. Bear-directional with capped risk." },
];

export default function Strategy() {
  const { profile, update, reset, isLoading, isSaving } = useStrategyProfile();
  useOneTimeMigration(profile, update);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pulsedPreset, setPulsedPreset] = useState<string | null>(null);

  const perTrade = maxPerTradeDollars(profile);
  const allowedCount = allowedStructureCount(profile.allowedStructures);
  const gateLabel = gateProfileLabel(profile.gateOverrides);
  const persona = personaName(profile);

  const setStructure = (key: keyof AllowedStructures, value: boolean) => {
    update({ allowedStructures: { ...profile.allowedStructures, [key]: value } });
  };
  const setGate = <K extends keyof StrategyProfile["gateOverrides"]>(key: K, value: StrategyProfile["gateOverrides"][K]) => {
    update({ gateOverrides: { ...profile.gateOverrides, [key]: value } });
  };

  // Risk tolerance auto-tunes structures (visual rule from spec).
  const onRiskChange = (risk: RiskTolerance) => {
    if (risk === "Conservative") {
      update({
        riskTolerance: risk,
        allowedStructures: {
          longCall: true, longPut: true,
          leapsCall: true, leapsPut: false,
          callDebitSpread: true, putDebitSpread: true,
        },
      });
    } else if (risk === "Aggressive") {
      update({
        riskTolerance: risk,
        allowedStructures: {
          longCall: true, longPut: true,
          leapsCall: true, leapsPut: true,
          callDebitSpread: true, putDebitSpread: true,
        },
      });
    } else {
      update({ riskTolerance: risk });
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Compass className="h-3.5 w-3.5" /> Strategy · master controller
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Set your trading persona</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            One profile drives the whole app. Scanner, Portfolio, Alerts and Picks all respect what you set here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && <Badge variant="outline" className="text-[10px]"><Save className="h-3 w-3 mr-1" />Saving…</Badge>}
          {!isSaving && !isLoading && <Badge variant="outline" className="text-[10px] border-bullish/40 text-bullish"><Check className="h-3 w-3 mr-1" />Auto-saved</Badge>}
          <Button variant="outline" size="sm" onClick={() => { reset(); toast.success("Strategy reset to defaults"); }}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ─── LEFT: profile sections ─── */}
        <div className="space-y-6">
          {/* SECTION 1 — Who you are */}
          <Section title="Who you are" icon={Wallet}
            hint="Your risk appetite, time horizon and account size. These four numbers cap every trade the app surfaces.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Risk tolerance" hint="Conservative auto-disables short-dated puts. Aggressive enables every structure.">
                <Segmented
                  ariaLabel="Risk tolerance"
                  value={profile.riskTolerance}
                  onChange={onRiskChange}
                  options={[
                    { value: "Conservative", label: "Conservative" },
                    { value: "Moderate",     label: "Moderate" },
                    { value: "Aggressive",   label: "Aggressive" },
                  ]}
                />
              </Field>
              <Field label="Horizon" hint="Day = 0–2 DTE. Swing = 7–60 DTE. Position = 60–180 DTE. LEAP = 180+ DTE.">
                <Segmented
                  ariaLabel="Horizon"
                  value={profile.horizon}
                  onChange={(v) => update({ horizon: v })}
                  options={[
                    { value: "Day Trade", label: "Day" },
                    { value: "Swing",     label: "Swing" },
                    { value: "Position",  label: "Position" },
                    { value: "LEAP",      label: "LEAP" },
                  ]}
                />
              </Field>
              <Field label="Account size" hint="Real dollars. Drives the per-trade cap (Gate 8). Be honest — over-stating leads to over-sizing.">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    type="number" min={100} step={500}
                    value={profile.accountSize}
                    onChange={(e) => update({ accountSize: Math.max(100, Number(e.target.value) || 0) })}
                    className="pl-7 font-mono"
                  />
                </div>
              </Field>
              <Field label={`Max per trade · ${profile.maxPerTradePct}% = $${perTrade.toLocaleString()}`}
                hint="The 2% rule of thumb is the sweet spot. >5% means a single bad trade can dent the whole account.">
                <Slider
                  min={1} max={10} step={1}
                  value={[profile.maxPerTradePct]}
                  onValueChange={([v]) => update({ maxPerTradePct: v })}
                />
              </Field>
              <Field label={`Max open positions · ${profile.maxOpenPositions}`}
                hint="More positions = more correlation risk and harder to monitor. 3–5 is a healthy band for most retail accounts.">
                <Slider
                  min={1} max={20} step={1}
                  value={[profile.maxOpenPositions]}
                  onValueChange={([v]) => update({ maxOpenPositions: v })}
                />
              </Field>
            </div>
          </Section>

          {/* SECTION 2 — Market read */}
          <Section title="Market read" icon={Brain}
            hint="Your view of the tape. Picks and Scanner sort/filter to match your bias.">
            <div className="space-y-4">
              <Field label="Market bias">
                <Segmented
                  ariaLabel="Market bias"
                  value={profile.marketBias}
                  onChange={(v) => update({ marketBias: v })}
                  options={[
                    { value: "Bullish",          label: "Bullish" },
                    { value: "Slightly Bullish", label: "Sl. Bull" },
                    { value: "Neutral",          label: "Neutral" },
                    { value: "Slightly Bearish", label: "Sl. Bear" },
                    { value: "Bearish",          label: "Bearish" },
                    { value: "Uncertain",        label: "Uncertain" },
                  ]}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="IV stance" hint="Low = options cheap, prefer to BUY. High = options rich; this app still buys but downsizes.">
                  <Segmented
                    ariaLabel="IV stance"
                    value={profile.ivStance}
                    onChange={(v) => update({ ivStance: v })}
                    options={[
                      { value: "Low (buyer)",  label: "Low" },
                      { value: "Average",      label: "Avg" },
                      { value: "High (seller)", label: "High" },
                    ]}
                  />
                </Field>
                <Field label="Catalyst mode" hint="Filter scanner picks to those near (or away from) earnings / macro events.">
                  <Segmented
                    ariaLabel="Catalyst mode"
                    value={profile.catalystMode}
                    onChange={(v) => update({ catalystMode: v })}
                    options={[
                      { value: "No Catalyst",    label: "None" },
                      { value: "Earnings Ahead", label: "Earnings" },
                      { value: "Macro Release",  label: "Macro" },
                      { value: "Any",            label: "Any" },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </Section>

          {/* SECTION 3 — Structures */}
          <Section title="Structures you trade" icon={Layers}
            hint="Toggle which structures the app will surface. Disabled ones are hidden everywhere.">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {STRUCTURES.map((s) => {
                  const on = profile.allowedStructures[s.key];
                  return (
                    <Hint key={s.key} label={s.hint}>
                      <button
                        type="button"
                        onClick={() => setStructure(s.key, !on)}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
                          on
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border bg-surface/40 text-muted-foreground hover:bg-surface",
                        )}
                      >
                        {on ? "✓ " : ""}{s.label}
                      </button>
                    </Hint>
                  );
                })}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Allowed structures: <span className="font-mono text-foreground font-semibold">{allowedCount} / 6</span>
              </div>
            </div>
          </Section>

          {/* SECTION 4 — Universe & filters */}
          <Section title="Scanner universe" icon={Target}
            hint="Limit the universe Scanner & Picks pull from. Custom = only your symbols.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Ticker universe">
                <Segmented
                  ariaLabel="Ticker universe"
                  value={profile.tickerUniverse}
                  onChange={(v) => update({ tickerUniverse: v })}
                  options={[
                    { value: "All",            label: "All" },
                    { value: "Mega Cap Only",  label: "Mega" },
                    { value: "Under $50",      label: "<$50" },
                    { value: "ETFs Only",      label: "ETFs" },
                    { value: "Custom",         label: "Custom" },
                  ]}
                />
              </Field>
              {profile.tickerUniverse === "Custom" && (
                <Field label="Custom tickers (comma-separated)">
                  <Input
                    value={profile.customTickers.join(", ")}
                    onChange={(e) => update({
                      customTickers: e.target.value
                        .split(/[,\s]+/)
                        .map((s) => s.trim().toUpperCase())
                        .filter(Boolean),
                    })}
                    placeholder="AAPL, MSFT, NVDA"
                    className="font-mono text-xs"
                  />
                </Field>
              )}
              <Field label={`Min options liquidity · ${profile.minOptionsLiquidity}`}
                hint="Liquidity 0–100. ≥60 = healthy OI + tight spreads. Below 40 = avoid; you'll pay the spread on entry & exit.">
                <Slider
                  min={0} max={100} step={5}
                  value={[profile.minOptionsLiquidity]}
                  onValueChange={([v]) => update({ minOptionsLiquidity: v })}
                />
              </Field>
              <Field label={`Exclude earnings within ${profile.excludeEarningsWithinDays}d`}
                hint="0 = include earnings names. 7 = a week of breathing room (the IV crush rule).">
                <Slider
                  min={0} max={21} step={1}
                  value={[profile.excludeEarningsWithinDays]}
                  onValueChange={([v]) => update({ excludeEarningsWithinDays: v })}
                />
              </Field>
            </div>
          </Section>

          {/* SECTION 5 — Advanced (gates) */}
          <Card className="p-5 space-y-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" /> Advanced · gate overrides
                <Badge variant="outline" className="text-[10px] ml-2">{gateLabel}</Badge>
              </div>
              {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {advancedOpen && (
              <div className="space-y-4">
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Changing these weakens your capital protection. Only touch if you know exactly what you're disabling.</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="ORB Lock (10:30 AM ET)" hint="Blocks new entries inside the opening 60 min when price discovery is wildest.">
                    <div className="flex items-center gap-2">
                      <Switch checked={profile.gateOverrides.orbLockEnabled} onCheckedChange={(v) => setGate("orbLockEnabled", v)} />
                      <span className="text-xs text-muted-foreground">{profile.gateOverrides.orbLockEnabled ? "Enabled" : "Off"}</span>
                    </div>
                  </Field>
                  <Field label="Trend gate (200-SMA)" hint="Calls only above the 200-day SMA, puts only below. The institutional trend filter.">
                    <div className="flex items-center gap-2">
                      <Switch checked={profile.gateOverrides.trendGateEnabled} onCheckedChange={(v) => setGate("trendGateEnabled", v)} />
                      <span className="text-xs text-muted-foreground">{profile.gateOverrides.trendGateEnabled ? "Enabled" : "Off"}</span>
                    </div>
                  </Field>
                  <Field label="RSI exhaustion filter" hint="Blocks entries when RSI > 75 (calls) or < 25 (puts) — chasing the move.">
                    <div className="flex items-center gap-2">
                      <Switch checked={profile.gateOverrides.rsiExhaustionEnabled} onCheckedChange={(v) => setGate("rsiExhaustionEnabled", v)} />
                      <span className="text-xs text-muted-foreground">{profile.gateOverrides.rsiExhaustionEnabled ? "Enabled" : "Off"}</span>
                    </div>
                  </Field>
                  <Field label={`IVP max threshold · ${profile.gateOverrides.ivpMaxThreshold}`}
                    hint="Blocks new buys above this IVP. Raising above 80 means paying top-of-market — accepting IV crush risk.">
                    <Slider
                      min={50} max={100} step={1}
                      value={[profile.gateOverrides.ivpMaxThreshold]}
                      onValueChange={([v]) => setGate("ivpMaxThreshold", v)}
                    />
                  </Field>
                  <Field label={`Hard stop-loss · ${profile.gateOverrides.hardStopLossPct}%`}
                    hint="Forces auto-exit when premium drops this much. 30% is the institutional default.">
                    <Slider
                      min={10} max={50} step={5}
                      value={[profile.gateOverrides.hardStopLossPct]}
                      onValueChange={([v]) => setGate("hardStopLossPct", v)}
                    />
                  </Field>
                  <Field label={`DTE range · ${profile.minDTE}–${profile.maxDTE}d`}
                    hint="Picks outside this range are hidden. Day = 0–7. Swing = 30–60. LEAP = 180+.">
                    <div className="space-y-2">
                      <Slider
                        min={0} max={365} step={1}
                        value={[profile.minDTE]}
                        onValueChange={([v]) => update({ minDTE: Math.min(v, profile.maxDTE) })}
                      />
                      <Slider
                        min={0} max={730} step={5}
                        value={[profile.maxDTE]}
                        onValueChange={([v]) => update({ maxDTE: Math.max(v, profile.minDTE) })}
                      />
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </Card>

          {/* SECTION 6 — Alerts */}
          <Section title="Alerts" icon={Activity} hint="Which webhook events Verdict-Cron will fire.">
            <div className="grid gap-3 md:grid-cols-3">
              {([
                { key: "alertOnNewBuy" as const, label: "New BUY signal", hint: "Fires when a fresh BUY NOW row appears." },
                { key: "alertOnGateFlip" as const, label: "Gate flip", hint: "Fires when a position moves between BUY/HOLD/EXIT verdicts." },
                { key: "alertOnStopLoss" as const, label: "Stop-loss hit", hint: "Fires when the hard stop-loss threshold is crossed." },
              ]).map((a) => (
                <Field key={a.key} label={a.label} hint={a.hint}>
                  <div className="flex items-center gap-2">
                    <Switch checked={profile[a.key]} onCheckedChange={(v) => update({ [a.key]: v } as Partial<StrategyProfile>)} />
                    <span className="text-xs text-muted-foreground">{profile[a.key] ? "On" : "Off"}</span>
                  </div>
                </Field>
              ))}
            </div>
          </Section>

          {/* Presets + reset */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Quick presets
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    update(applyPreset(profile, preset));
                    setPulsedPreset(preset.id);
                    setTimeout(() => setPulsedPreset(null), 700);
                    toast.success(`Applied '${preset.name}' strategy`);
                  }}
                  className={cn(
                    "text-left p-3 rounded-lg border bg-surface/30 hover:border-primary/40 hover:bg-surface transition-all",
                    pulsedPreset === preset.id && "animate-pulse border-primary bg-primary/10",
                  )}
                >
                  <div className="text-sm font-semibold">{preset.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{preset.description}</div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* ─── RIGHT: sticky preview card ─── */}
        <div className="lg:sticky lg:top-4 self-start space-y-3">
          <Card className="p-5 space-y-4 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary">
              <Activity className="h-3.5 w-3.5" /> App behavior · live preview
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Strategy</div>
              <div className="text-lg font-semibold">{persona}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <PreviewStat label="Per-trade cap" value={`$${perTrade.toLocaleString()}`} />
              <PreviewStat label="Account" value={`$${profile.accountSize.toLocaleString()}`} />
              <PreviewStat label="Allowed" value={`${allowedCount} / 6`} />
              <PreviewStat label="Gate profile" value={gateLabel} />
              <PreviewStat label="DTE range" value={`${profile.minDTE}–${profile.maxDTE}d`} />
              <PreviewStat label="Max open" value={String(profile.maxOpenPositions)} />
            </div>
            <div className="border-t border-border/40 pt-3 space-y-2 text-[11px]">
              <div className="text-muted-foreground">
                Universe: <span className="text-foreground font-medium">{profile.tickerUniverse}</span>
                {profile.tickerUniverse === "Custom" && profile.customTickers.length > 0 &&
                  <span className="text-muted-foreground"> · {profile.customTickers.length} symbols</span>}
              </div>
              <div className="text-muted-foreground">
                Bias: <span className="text-foreground font-medium">{profile.marketBias}</span> · IV {profile.ivStance.split(" ")[0]}
              </div>
              <div className="text-muted-foreground">
                Earnings buffer: <span className="text-foreground font-medium">{profile.excludeEarningsWithinDays}d</span>
              </div>
            </div>
          </Card>

          <Card className="p-4 text-[11px] text-muted-foreground space-y-2">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <ArrowRight className="h-3 w-3" /> Wired into
            </div>
            <ul className="space-y-1 list-disc pl-4">
              <li>Scanner — universe + min liquidity + structures filter</li>
              <li>Picks — sorts to your bias + structures</li>
              <li>Portfolio — per-position compliance badge</li>
              <li>Alerts — only fires the toggles you enabled above</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold text-foreground/95">{value}</div>
    </div>
  );
}
