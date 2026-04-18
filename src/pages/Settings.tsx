import { Card } from "@/components/ui/card";
import { Wallet, Check, Activity, Brain, Clock, Tag, Loader2, CheckCircle2, AlertTriangle, XCircle, Webhook, Send, Trash2 } from "lucide-react";
import { sendTestWebhook, readWebhookLog, clearWebhookLog } from "@/lib/webhook";
import { toast } from "sonner";
import { useBudget } from "@/lib/budget";
import { useState, useEffect } from "react";
import {
  useSettings,
  REFRESH_OPTIONS,
  AI_MODELS,
  RISK_PROFILES,
  type AiModel,
  type RiskProfile,
} from "@/lib/settings";
import { useApiHealth } from "@/lib/apiHealth";
import { TICKER_UNIVERSE } from "@/lib/mockData";

const PRESETS = [250, 500, 1000, 2500, 5000];

function StatusDot({ status }: { status: "ok" | "degraded" | "down" }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-bullish" />;
  if (status === "degraded") return <AlertTriangle className="h-4 w-4 text-warning" />;
  return <XCircle className="h-4 w-4 text-bearish" />;
}

export default function Settings() {
  const [budget, setBudget] = useBudget();
  const [draft, setDraft] = useState<string>(String(budget));
  const [savedFlash, setSavedFlash] = useState(false);
  const [settings, updateSettings] = useSettings();
  const { data: health = [], isLoading: healthLoading, refetch: refetchHealth } = useApiHealth();

  useEffect(() => setDraft(String(budget)), [budget]);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  };

  const commit = (v: number) => {
    setBudget(v);
    flashSaved();
  };

  const toggleSymbol = (sym: string) => {
    const set = new Set(settings.tickerSymbols.length ? settings.tickerSymbols : TICKER_UNIVERSE.map((u) => u.symbol));
    if (set.has(sym)) set.delete(sym);
    else set.add(sym);
    updateSettings({ tickerSymbols: Array.from(set) });
    flashSaved();
  };

  const activeTickerSet = new Set(
    settings.tickerSymbols.length ? settings.tickerSymbols : TICKER_UNIVERSE.map((u) => u.symbol)
  );

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
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

      {/* ───────────── Budget ───────────── */}
      <Card className="glass-card p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" /> Default trade budget
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Max you'd spend on a single options trade. Used to filter picks and pre-fill every Research drawer.
          </p>
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
            <div
              key={h.name}
              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/30"
            >
              <StatusDot status={h.status} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{h.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{h.description} · {h.detail}</div>
              </div>
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
          <div className="text-[10px] text-muted-foreground">
            {activeTickerSet.size} of {TICKER_UNIVERSE.length} symbols streaming.
          </div>
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
    </div>
  );
}
