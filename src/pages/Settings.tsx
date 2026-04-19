import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Check, Activity, Brain, Clock, Tag, Loader2, CheckCircle2, AlertTriangle, XCircle, Webhook, Send, Trash2, DollarSign, Clock3, Play, FlaskConical, Compass, ArrowRight, Bell, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { sendTestWebhook, readWebhookLog, clearWebhookLog } from "@/lib/webhook";
import { useVerdictCronConfig, useSaveVerdictCronConfig, useVerdictCronLog, clearVerdictCronLog, runVerdictCronNow } from "@/lib/verdictCron";
import { getOwnerKey, usePortfolio } from "@/lib/portfolio";
import { toast } from "sonner";

import { useCapitalSettings } from "@/lib/budget";
import { useState, useEffect, useMemo } from "react";
import {
  useSettings,
  REFRESH_OPTIONS,
  AI_MODELS,
  RISK_PROFILES,
  BROKER_PRESETS,
  type AiModel,
  type RiskProfile,
  type BrokerPreset,
} from "@/lib/settings";
import { useApiHealth, useRequestRate60s, type SourceHealth } from "@/lib/apiHealth";
import { resetCounts } from "@/lib/requestRate";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { KvCacheAdminCard } from "@/components/KvCacheAdminCard";

const PORTFOLIO_PRESETS = [5_000, 10_000, 25_000, 50_000, 100_000];
const RISK_PRESETS = [1, 2, 3, 5, 10];

function StatusDot({ status }: { status: "ok" | "degraded" | "down" }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-bullish" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <XCircle className="h-4 w-4 text-bearish" />;
}

/**
 * One row in the API-health card. Pulled into its own component so
 * useRequestRate60s can subscribe per-source without re-rendering siblings
 * every time a counter ticks.
 */
function HealthRow({ h }: { h: SourceHealth }) {
  const rate = useRequestRate60s(h.functions);
  // Massive's plan rejects above ~100 req/s. Yellow at 60+, red at 90+.
  const rateTone =
    rate >= 90 ? "text-bearish" :
    rate >= 60 ? "text-warning" :
    "text-muted-foreground";
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30">
      <StatusDot status={h.status} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{h.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">{h.description} · {h.detail}</div>
      </div>
      <button
        type="button"
        onClick={() => { resetCounts(h.functions); toast.success(`${h.name.split(" (")[0]} counter reset`); }}
        className="text-right shrink-0 px-2 rounded hover:bg-surface/60 transition-colors"
        title="Click to reset this row's 60s counter"
      >
        <div className={`font-mono text-xs ${rateTone}`}>{rate}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/60s</div>
      </button>
      <div className="text-right shrink-0">
        <div className="font-mono text-xs">
          {h.latencyMs == null ? "—" : `${h.latencyMs}ms`}
        </div>
        <div className={`text-[10px] uppercase tracking-wider ${
          h.status === "ok" ? "text-bullish" : h.status === "degraded" ? "text-warning" : "text-bearish"
        }`}>
          {h.status}
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { portfolio, riskPct, budget, setPortfolioSize, setRiskPct } = useCapitalSettings();
  const [portfolioDraft, setPortfolioDraft] = useState<string>(String(portfolio));
  const [riskDraft, setRiskDraft] = useState<string>(String(riskPct));
  const [savedFlash, setSavedFlash] = useState(false);
  const [settings, updateSettings] = useSettings();
  const { data: health = [], isLoading: healthLoading, refetch: refetchHealth } = useApiHealth();

  useEffect(() => setPortfolioDraft(String(portfolio)), [portfolio]);
  useEffect(() => setRiskDraft(String(riskPct)), [riskPct]);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const commitPortfolio = (v: number) => {
    setPortfolioSize(Math.max(100, v));
    flashSaved();
  };
  const commitRisk = (v: number) => {
    setRiskPct(Math.min(100, Math.max(0.1, v)));
    flashSaved();
  };

  const customTickers = settings.customTickers ?? [];
  const mergedUniverseSymbols = useMemo(
    () => Array.from(new Set([...TICKER_UNIVERSE.map((u) => u.symbol), ...customTickers])),
    [customTickers],
  );

  const toggleSymbol = (sym: string) => {
    const set = new Set(settings.tickerSymbols.length ? settings.tickerSymbols : mergedUniverseSymbols);
    if (set.has(sym)) set.delete(sym);
    else set.add(sym);
    updateSettings({ tickerSymbols: Array.from(set) });
    flashSaved();
  };

  const [newTicker, setNewTicker] = useState("");
  const addCustomTicker = () => {
    const sym = newTicker.trim().toUpperCase();
    if (!sym) return;
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) {
      toast.error("Invalid ticker — use 1–10 letters/digits (e.g. AAPL, BRK.B).");
      return;
    }
    if (mergedUniverseSymbols.includes(sym)) {
      toast.message(`${sym} is already in the list.`);
      setNewTicker("");
      return;
    }
    updateSettings({ customTickers: [...customTickers, sym] });
    setNewTicker("");
    toast.success(`${sym} added`);
    flashSaved();
  };

  const removeCustomTicker = (sym: string) => {
    updateSettings({
      customTickers: customTickers.filter((s) => s !== sym),
      tickerSymbols: settings.tickerSymbols.filter((s) => s !== sym),
    });
    flashSaved();
  };

  const activeTickerSet = new Set(
    settings.tickerSymbols.length ? settings.tickerSymbols : mergedUniverseSymbols
  );

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workspace defaults applied across Nova analysis.
          </p>
        </div>
        {savedFlash && (
          <span className="pill pill-bullish text-[10px]">
            <Check className="h-3 w-3" /> Saved
          </span>
        )}
      </div>

      {/* ───────────── Trader profile ───────────── */}
      <Card className="glass-card p-6 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Compass className="h-4 w-4 text-primary" /> Trader profile
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Drives the Strategy Builder. Tell Nova your risk, horizon and outlook and we'll suggest the right
              single-leg play — long calls, long puts, stock-replacement, or 0-DTE.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/strategy">
              Open Strategy Builder <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
          {[
            ["Risk",      settings.traderProfile.risk],
            ["Horizon",   settings.traderProfile.horizon],
            ["Outlook",   settings.traderProfile.outlook.replace("_", " ")],
            ["Catalyst",  settings.traderProfile.event],
            ["Account",   settings.traderProfile.account],
            ["IV stance", settings.traderProfile.ivStance],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{k}</div>
              <div className="font-medium capitalize text-foreground/90">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ───────────── Capital & per-trade risk ───────────── */}
      <Card className="glass-card p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Portfolio capital & per-trade risk
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Nova caps every recommendation at <span className="font-semibold text-foreground">{riskPct}%</span> of your portfolio.
            No single trade — regardless of NOVA's score — will ever exceed this dollar amount.
          </p>
        </div>

        {/* Portfolio size */}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total portfolio capital</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                min={100}
                step={500}
                value={portfolioDraft}
                onChange={(e) => setPortfolioDraft(e.target.value)}
                onBlur={() => commitPortfolio(Number(portfolioDraft) || 25000)}
                onKeyDown={(e) => e.key === "Enter" && commitPortfolio(Number(portfolioDraft) || 25000)}
                className="w-44 h-10 pl-7 pr-3 text-base font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {PORTFOLIO_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => commitPortfolio(v)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    portfolio === v
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-surface"
                  }`}
                >
                  ${v >= 1000 ? `${v / 1000}k` : v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Risk percent */}
        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Max % of capital per trade</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <input
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                value={riskDraft}
                onChange={(e) => setRiskDraft(e.target.value)}
                onBlur={() => commitRisk(Number(riskDraft) || 2)}
                onKeyDown={(e) => e.key === "Enter" && commitRisk(Number(riskDraft) || 2)}
                className="w-28 h-10 pr-7 pl-3 text-base font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {RISK_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => commitRisk(v)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                    riskPct === v
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-border text-muted-foreground hover:bg-surface"
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Conservative traders typically risk 1–2% per trade. 5%+ is aggressive.
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3 flex flex-wrap gap-x-4 gap-y-1">
          <span>Portfolio: <span className="font-mono text-foreground">${portfolio.toLocaleString()}</span></span>
          <span>Risk: <span className="font-mono text-foreground">{riskPct}%</span></span>
          <span>→ Max per trade: <span className="font-mono text-primary font-semibold">${budget.toLocaleString()}</span></span>
        </div>
      </Card>

      {/* ───────────── Data sources & API health ───────────── */}
      <Card className="glass-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Data sources & API health
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Live ping of every backend feed. Auto-refreshes every minute.
            </p>
          </div>
          <button
            onClick={() => refetchHealth()}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface transition-colors"
          >
            {healthLoading ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "Test now"}
          </button>
        </div>

        <div className="space-y-2">
          {healthLoading && health.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">Pinging providers…</div>
          )}
          {health.map((h) => (
            <HealthRow key={h.name} h={h} />
          ))}
        </div>
      </Card>

      {/* ───────────── AI provider & default risk ───────────── */}
      <Card className="glass-card p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" /> AI provider & default risk profile
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which model powers Nova explanations and the default risk tilt for picks.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AI model</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {AI_MODELS.map((m) => {
              const active = settings.aiModel === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => {
                    updateSettings({ aiModel: m.value as AiModel });
                    flashSaved();
                  }}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border bg-surface/30 hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium flex items-center gap-2">
                    {m.label}
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{m.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Default risk profile</div>
          <div className="grid grid-cols-3 gap-2">
            {RISK_PROFILES.map((r) => {
              const active = settings.riskProfile === r.value;
              return (
                <button
                  key={r.value}
                  onClick={() => {
                    updateSettings({ riskProfile: r.value as RiskProfile });
                    flashSaved();
                  }}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border bg-surface/30 hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium">
                    {r.emoji} {r.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.hint}</div>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ───────────── Refresh interval & ticker tape ───────────── */}
      <Card className="glass-card p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Refresh interval & ticker tape
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            How often live quotes refresh, and which symbols stream across the top tape.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Quote refresh interval</div>
          <div className="flex gap-2 flex-wrap">
            {REFRESH_OPTIONS.map((r) => {
              const active = settings.refreshMs === r.ms;
              return (
                <button
                  key={r.ms}
                  onClick={() => {
                    updateSettings({ refreshMs: r.ms });
                    flashSaved();
                  }}
                  className={`px-3 py-2 rounded-md border text-sm transition-colors ${
                    active
                      ? "bg-primary/20 border-primary text-primary"
                      : "border-border hover:bg-surface text-muted-foreground"
                  }`}
                  title={r.hint}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Faster = fresher prices but more API calls. 15s is the sweet spot for most users.
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Tag className="h-3 w-3" /> Ticker tape symbols
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  updateSettings({ tickerSymbols: [] });
                  flashSaved();
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Select all
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                onClick={() => {
                  updateSettings({ tickerSymbols: ["SPY"] });
                  flashSaved();
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            </div>
          </div>
          {/* Add custom ticker */}
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomTicker())}
              placeholder="Add ticker (e.g. COIN, PLTR, BRK.B)"
              maxLength={10}
              className="flex-1 min-w-[200px] h-9 px-3 text-sm font-mono uppercase bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={addCustomTicker}
              disabled={!newTicker.trim()}
              className="h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>

          {/* Built-in chips */}
          <div className="flex flex-wrap gap-1.5">
            {TICKER_UNIVERSE.map((u) => {
              const active = activeTickerSet.has(u.symbol);
              return (
                <button
                  key={u.symbol}
                  onClick={() => toggleSymbol(u.symbol)}
                  className={`text-xs font-mono px-2.5 py-1 rounded border transition-colors ${
                    active
                      ? "bg-primary/15 border-primary/60 text-primary"
                      : "border-border text-muted-foreground hover:bg-surface"
                  }`}
                >
                  {u.symbol}
                </button>
              );
            })}
          </div>

          {/* Custom chips with remove (×) */}
          {customTickers.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Custom ({customTickers.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {customTickers.map((sym) => {
                  const active = activeTickerSet.has(sym);
                  return (
                    <span
                      key={sym}
                      className={`inline-flex items-center gap-1 text-xs font-mono pl-2.5 pr-1 py-1 rounded border transition-colors ${
                        active
                          ? "bg-primary/15 border-primary/60 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <button
                        onClick={() => toggleSymbol(sym)}
                        className="hover:text-foreground"
                        title={active ? "Hide from tape" : "Show on tape"}
                      >
                        {sym}
                      </button>
                      <button
                        onClick={() => removeCustomTicker(sym)}
                        className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bearish/20 hover:text-bearish text-muted-foreground"
                        title="Remove ticker"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            {activeTickerSet.size} of {mergedUniverseSymbols.length} symbols streaming.
          </div>
        </div>
      </Card>

      {/* ───────────── Simulation / Paper trading ───────────── */}
      <Card className="glass-card p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-warning" /> Simulation Mode
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            When ON, every trade you save is tagged as <span className="font-semibold text-warning">paper</span>.
            Paper trades use the same live market data and verdict engine, but they're tracked separately on the Portfolio page so your real P&amp;L stays clean.
          </p>
        </div>
        <button
          onClick={() => {
            updateSettings({ paperMode: !settings.paperMode });
            flashSaved();
          }}
          className={`w-full flex items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors ${
            settings.paperMode
              ? "border-warning/60 bg-warning/10"
              : "border-border bg-surface/40 hover:bg-surface/60"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
              settings.paperMode ? "bg-warning/20 text-warning" : "bg-muted/40 text-muted-foreground"
            }`}>
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {settings.paperMode ? "Simulation is ON" : "Simulation is OFF"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {settings.paperMode
                  ? "New saves go to your paper book. Toggle off to save real trades."
                  : "Saves count as real trades. Toggle on to test ideas without risk."}
              </div>
            </div>
          </div>
          <div className={`h-6 w-11 rounded-full relative transition-colors flex-shrink-0 ${
            settings.paperMode ? "bg-warning" : "bg-muted"
          }`}>
            <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
              settings.paperMode ? "translate-x-[22px]" : "translate-x-0.5"
            }`} />
          </div>
        </button>
      </Card>

      {/* ───────────── Trading fees (broker P&L) ───────────── */}
      <Card className="glass-card p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" /> Trading fees (applied to P&amp;L)
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Subtracted from realized & unrealized P&amp;L on the Portfolio page so the numbers match your broker statement.
            Default is <span className="font-semibold">Robinhood</span>: $0 commission + ~$0.03/contract regulatory pass-through.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Broker preset</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {BROKER_PRESETS.map((b) => {
              const active = settings.brokerPreset === b.value;
              return (
                <button
                  key={b.value}
                  onClick={() => {
                    updateSettings({
                      brokerPreset: b.value as BrokerPreset,
                      ...(b.value !== "custom" && {
                        feePerContract: b.feePerContract,
                        feePerTrade: b.feePerTrade,
                        regulatoryFeePerContract: b.regulatoryFeePerContract,
                      }),
                    });
                    flashSaved();
                  }}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    active ? "border-primary bg-primary/10" : "border-border bg-surface/30 hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium flex items-center gap-2">
                    {b.label}
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{b.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 pt-2 border-t border-border/40">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Commission / contract</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                step={0.05}
                value={settings.feePerContract}
                onChange={(e) => updateSettings({ brokerPreset: "custom", feePerContract: Number(e.target.value) || 0 })}
                onBlur={flashSaved}
                className="w-full h-9 pl-6 pr-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Regulatory / contract</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={settings.regulatoryFeePerContract}
                onChange={(e) => updateSettings({ brokerPreset: "custom", regulatoryFeePerContract: Number(e.target.value) || 0 })}
                onBlur={flashSaved}
                className="w-full h-9 pl-6 pr-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Flat fee / trade</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={settings.feePerTrade}
                onChange={(e) => updateSettings({ brokerPreset: "custom", feePerTrade: Number(e.target.value) || 0 })}
                onBlur={flashSaved}
                className="w-full h-9 pl-6 pr-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3 font-mono">
          Round-trip cost on a 1-contract trade:{" "}
          <span className="text-foreground">
            ${(2 * (settings.feePerContract + settings.regulatoryFeePerContract + settings.feePerTrade)).toFixed(2)}
          </span>{" "}
          · 5-contract: ${(2 * (5 * (settings.feePerContract + settings.regulatoryFeePerContract) + settings.feePerTrade)).toFixed(2)}
        </div>
      </Card>

      {/* ───────────── Webhook alerts (Make.com / n8n / Slack) ───────────── */}
      <Card className="glass-card p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" /> Webhook alerts (WAIT → GO)
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Paste a Make.com, n8n, Zapier, or Slack incoming webhook URL. Nova will POST a JSON
            payload whenever a portfolio position flips from <span className="font-mono">WAIT</span>{" "}
            to <span className="font-mono">GO</span> or <span className="font-mono">EXIT</span>.
            Wire it from there to your phone, Slack, SMS — anything.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Webhook URL</div>
          <div className="flex gap-2 flex-wrap">
            <input
              type="url"
              placeholder="https://hook.eu2.make.com/..."
              value={settings.webhookUrl}
              onChange={(e) => updateSettings({ webhookUrl: e.target.value })}
              onBlur={flashSaved}
              className="flex-1 min-w-[280px] h-10 px-3 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              disabled={!settings.webhookUrl}
              onClick={async () => {
                const r = await sendTestWebhook(settings.webhookUrl);
                if (r.ok) toast.success("Test sent — check your endpoint.");
                else toast.error(`Webhook failed: ${r.error ?? "unknown"}`);
              }}
              className="h-10 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Send className="h-3.5 w-3.5" /> Test
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-2 pt-2 border-t border-border/40">
          <button
            onClick={() => { updateSettings({ webhookEnabled: !settings.webhookEnabled }); flashSaved(); }}
            className={`text-left p-3 rounded-lg border transition-all ${
              settings.webhookEnabled ? "border-primary bg-primary/10" : "border-border bg-surface/30 hover:border-primary/40"
            }`}
          >
            <div className="text-sm font-medium flex items-center gap-2">
              {settings.webhookEnabled ? "Enabled" : "Disabled"}
              {settings.webhookEnabled && <Check className="h-3.5 w-3.5 text-primary" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Master switch for sending alerts.</div>
          </button>
          <button
            onClick={() => { updateSettings({ webhookOnWait: !settings.webhookOnWait }); flashSaved(); }}
            className={`text-left p-3 rounded-lg border transition-all ${
              settings.webhookOnWait ? "border-primary bg-primary/10" : "border-border bg-surface/30 hover:border-primary/40"
            }`}
          >
            <div className="text-sm font-medium flex items-center gap-2">
              Also alert on new WAIT
              {settings.webhookOnWait && <Check className="h-3.5 w-3.5 text-primary" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">More noise — fuller audit trail.</div>
          </button>
        </div>

        {(() => {
          const log = readWebhookLog();
          if (log.length === 0) return (
            <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
              No alerts sent yet. Save a position on the Portfolio page, then watch verdicts flip.
            </div>
          );
          return (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Recent alerts ({log.length})</div>
                <button
                  onClick={() => clearWebhookLog()}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Clear
                </button>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {log.slice(0, 10).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono p-2 rounded border border-border/60 bg-surface/30">
                    <span className={e.ok ? "text-bullish" : "text-bearish"}>{e.ok ? "✓" : "✗"}</span>
                    <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span>
                    <span className="font-semibold">{e.symbol}</span>
                    <span className="text-muted-foreground">{e.from} → {e.to}</span>
                    {e.error && <span className="text-bearish truncate">{e.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <details className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
          <summary className="cursor-pointer hover:text-foreground">Payload format & setup tips</summary>
          <div className="mt-2 space-y-2">
            <div>POST JSON body shape:</div>
            <pre className="bg-background border border-border rounded p-2 overflow-x-auto text-[10px]">{`{
  "event": "nova_verdict_transition",
  "symbol": "AAPL",
  "positionId": "uuid",
  "from": "WAIT",
  "to": "GO",
  "status": "winning",
  "action": "hold",
  "verdict": "Support held at 10:35 — momentum confirmed.",
  "text": "🟢 GO — AAPL\\n...",
  "at": "2025-01-15T15:35:00.000Z"
}`}</pre>
            <div>
              <strong>Make.com / n8n:</strong> create a "Webhook" trigger, copy the URL here.
              Add a Slack/Telegram/Pushover step downstream and map the <code>text</code> field.
            </div>
          </div>
        </details>
      </Card>

      {/* ───────────── Position Alerts (per-account verdict-cron) ───────────── */}
      <PositionAlertsCard />

      {/* ───────────── Background cron (server-side, runs even when app closed) ───────────── */}
      <BackgroundCronCard />

      {/* ───────────── Backend cache (kv_cache inspector) ───────────── */}
      <KvCacheAdminCard />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Position Alerts — owner key + webhook + status pill + test button
// ─────────────────────────────────────────────────────────────────────────────
function PositionAlertsCard() {
  const ownerKey = getOwnerKey();
  const { data: cfg, isLoading } = useVerdictCronConfig();
  const { data: positions = [] } = usePortfolio();
  const save = useSaveVerdictCronConfig();

  const enabled = cfg?.enabled ?? false;
  const savedUrl = cfg?.webhookUrl ?? "";
  const [urlDraft, setUrlDraft] = useState<string>("");
  const [testing, setTesting] = useState(false);

  // Hydrate the draft from the loaded config exactly once.
  useEffect(() => {
    if (savedUrl && !urlDraft) setUrlDraft(savedUrl);
  }, [savedUrl, urlDraft]);

  const openCount = useMemo(
    () => positions.filter((p) => p.status === "open").length,
    [positions],
  );

  const isHttps = (u: string) => /^https:\/\//i.test(u.trim());
  const urlValid = urlDraft.length === 0 || isHttps(urlDraft);

  const persistEnabled = (next: boolean) => {
    if (next && !isHttps(urlDraft)) {
      toast.error("Add a valid https:// webhook URL before enabling alerts.");
      return;
    }
    save.mutate(
      { enabled: next, webhookUrl: urlDraft, alertOnWait: cfg?.alertOnWait ?? false },
      {
        onSuccess: () => toast.success(next ? "Position alerts enabled" : "Position alerts disabled"),
        onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
      },
    );
  };

  const persistUrl = () => {
    if (urlDraft && !isHttps(urlDraft)) {
      toast.error("Webhook URL must start with https://");
      return;
    }
    if (urlDraft === savedUrl) return;
    save.mutate(
      { enabled, webhookUrl: urlDraft, alertOnWait: cfg?.alertOnWait ?? false },
      {
        onSuccess: () => toast.success("Webhook URL saved"),
        onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
      },
    );
  };

  const sendTest = async () => {
    if (!isHttps(urlDraft)) {
      toast.error("Webhook URL must start with https://");
      return;
    }
    setTesting(true);
    try {
      const sample = {
        event: "nova_position_alert.test",
        source: "novawhisper.settings.test",
        ownerKey,
        symbol: "AAPL",
        positionId: "test-position-id",
        from: "WAIT",
        to: "GO",
        status: "winning",
        action: "hold",
        verdict: "Test alert from NovaWhisper Settings — delivery confirmed.",
        text: "🧪 TEST — NovaWhisper webhook is reachable.",
        at: new Date().toISOString(),
      };
      const res = await fetch(urlDraft, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample),
        // CORS-friendly fallback so opaque success doesn't read as failure.
        mode: "cors",
      }).catch((e) => ({ ok: false, status: 0, statusText: String(e) } as Response));
      if ((res as Response).ok) {
        toast.success("Test sent — check your endpoint.");
      } else {
        toast.error(`Webhook responded ${(res as Response).status} ${(res as Response).statusText}`);
      }
    } finally {
      setTesting(false);
    }
  };

  // Status pill
  let statusDot = "⚫";
  let statusLabel = "Inactive";
  let statusCls = "border-border bg-surface/40 text-muted-foreground";
  if (enabled && openCount > 0) {
    statusDot = "🟢";
    statusLabel = `Active — monitoring ${openCount} open position${openCount === 1 ? "" : "s"}`;
    statusCls = "border-bullish/40 bg-bullish/10 text-bullish";
  } else if (enabled) {
    statusDot = "🟡";
    statusLabel = "Active — no open positions to monitor";
    statusCls = "border-warning/40 bg-warning/10 text-warning";
  }

  return (
    <Card className="glass-card p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Position Alerts
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">
          Activate live monitoring of your open positions. When a gate threshold flips
          (WAIT → GO, or EXIT triggered), NovaWhisper POSTs a JSON alert to your webhook.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading alert config…
        </div>
      ) : (
        <>
          {/* Status pill */}
          <div className={`text-xs font-medium px-3 py-2 rounded-md border inline-flex items-center gap-2 ${statusCls}`}>
            <span aria-hidden>{statusDot}</span> {statusLabel}
          </div>

          {/* Owner key */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Your account key (auto-assigned)
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={ownerKey}
                className="flex-1 min-w-0 h-9 px-3 text-[11px] font-mono bg-background/60 border border-border rounded-md text-muted-foreground"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(ownerKey);
                  toast.success("Account key copied");
                }}
                className="h-9 px-3 rounded-md text-xs border border-border hover:bg-surface inline-flex items-center gap-1.5"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Identifies your account for alert routing. Stored locally on this device.
            </p>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Alert Destination
            </label>
            <div className="flex gap-2 flex-wrap">
              <input
                type="url"
                placeholder="https://hooks.slack.com/... or Discord webhook URL"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={persistUrl}
                className={`flex-1 min-w-[280px] h-10 px-3 text-sm font-mono bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  urlValid ? "border-border" : "border-bearish"
                }`}
              />
              <button
                disabled={!urlDraft || !urlValid || testing}
                onClick={sendTest}
                className="h-10 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Test Webhook
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Paste a Slack, Discord, or Zapier webhook. NovaWhisper will POST a JSON alert here when a position crosses a gate threshold.
            </p>
            {!urlValid && (
              <p className="text-[10px] text-bearish">URL must start with https://</p>
            )}
          </div>

          {/* Enable toggle */}
          <button
            onClick={() => persistEnabled(!enabled)}
            disabled={save.isPending}
            className={`w-full flex items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors ${
              enabled
                ? "border-primary/60 bg-primary/10"
                : "border-border bg-surface/40 hover:bg-surface/60"
            }`}
          >
            <div>
              <div className="text-sm font-semibold">
                {enabled ? "Monitoring is ON" : "Enable Monitoring"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Server checks your open positions every 5 minutes during market hours and POSTs alerts to your webhook.
              </div>
            </div>
            <div className={`h-6 w-11 rounded-full relative transition-colors flex-shrink-0 ${
              enabled ? "bg-primary" : "bg-muted"
            }`}>
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`} />
            </div>
          </button>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Background verdict cron card
// ─────────────────────────────────────────────────────────────────────────────
function BackgroundCronCard() {
  const { data: cfg, isLoading } = useVerdictCronConfig();
  const { data: log = [] } = useVerdictCronLog(30);
  const save = useSaveVerdictCronConfig();
  const [url, setUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const enabled = cfg?.enabled ?? false;
  const webhookUrl = url ?? cfg?.webhookUrl ?? "";
  const alertOnWait = cfg?.alertOnWait ?? false;

  const persist = (patch: Parameters<typeof save.mutate>[0]) =>
    save.mutate(
      { enabled, webhookUrl, alertOnWait, ...patch },
      {
        onSuccess: () => toast.success("Background alerts saved"),
        onError: (e) => toast.error(`Save failed: ${(e as Error).message}`),
      },
    );

  return (
    <Card className="glass-card p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-primary" /> Background alerts (runs every 5 min, market hours)
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">
          When enabled, our server runs the verdict check on a 5-minute cron from 9:30 AM to 4:00 PM ET (Mon–Fri)
          and POSTs the same WAIT→GO / EXIT alerts to your webhook — even when this app is closed.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading background config…
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Webhook URL (server-side)</div>
            <div className="flex gap-2 flex-wrap">
              <input
                type="url"
                placeholder="https://hook.eu2.make.com/..."
                value={webhookUrl}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => persist({ webhookUrl })}
                className="flex-1 min-w-[280px] h-10 px-3 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                disabled={!webhookUrl || running}
                onClick={async () => {
                  setRunning(true);
                  const r = await runVerdictCronNow();
                  setRunning(false);
                  if (r.ok) toast.success("Cron run triggered — check log below.");
                  else toast.error(`Run failed: ${r.error}`);
                }}
                className="h-10 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run now
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2 pt-2 border-t border-border/40">
            <button
              onClick={() => persist({ enabled: !enabled })}
              className={`text-left p-3 rounded-lg border transition-all ${
                enabled ? "border-primary bg-primary/10" : "border-border bg-surface/30 hover:border-primary/40"
              }`}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                {enabled ? "Background cron ON" : "Background cron OFF"}
                {enabled && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Server fires alerts every 5 min during market hours.</div>
            </button>
            <button
              onClick={() => persist({ alertOnWait: !alertOnWait })}
              className={`text-left p-3 rounded-lg border transition-all ${
                alertOnWait ? "border-primary bg-primary/10" : "border-border bg-surface/30 hover:border-primary/40"
              }`}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                Also alert on new WAIT
                {alertOnWait && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Off by default — keeps signal clean.</div>
            </button>
          </div>

          {cfg?.lastRunAt && (
            <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3 font-mono">
              Last server run: {new Date(cfg.lastRunAt).toLocaleString()} · {cfg.lastRunStatus ?? "—"}
            </div>
          )}

          {log.length === 0 ? (
            <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
              No background alerts yet. Enable the cron above and add at least one open position.
            </div>
          ) : (
            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Background alerts ({log.length})</div>
                <button
                  onClick={async () => { await clearVerdictCronLog(); toast.success("Log cleared."); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Clear
                </button>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {log.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 text-[11px] font-mono p-2 rounded border border-border/60 bg-surface/30">
                    <span className={e.ok ? "text-bullish" : "text-bearish"}>{e.ok ? "✓" : "✗"}</span>
                    <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                    <span className="font-semibold">{e.symbol}</span>
                    <span className="text-muted-foreground">{e.fromSignal} → {e.toSignal}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-primary/70">{e.source}</span>
                    {e.error && <span className="text-bearish truncate">{e.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
