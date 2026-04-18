// Webhook delivery — tracks WAIT→GO transitions per position and POSTs to a
// user-configured URL (Make.com, n8n, Zapier, Slack incoming webhook, etc.).
// Uses no-cors mode so it works against Slack/Zapier without preflight pain.
import { setSettings } from "./settings";
import type { AppSettings } from "./settings";
import type { Verdict } from "./portfolioVerdict";

const STATE_KEY = "nova_webhook_last_state";
const LOG_KEY = "nova_webhook_log";

type Signal = "GO" | "WAIT" | "EXIT";

function verdictToSignal(v: Verdict): Signal {
  if (v.action === "cut" || v.action === "take_profit") return "EXIT";
  if (v.status === "winning" || v.status === "running fine") return "GO";
  return "WAIT";
}

function readState(): Record<string, Signal> {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}"); }
  catch { return {}; }
}
function writeState(s: Record<string, Signal>) {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

export interface WebhookLogEntry {
  at: string;
  symbol: string;
  from: Signal;
  to: Signal;
  ok: boolean;
  error?: string;
}

export function readWebhookLog(): WebhookLogEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
  catch { return []; }
}
function pushLog(entry: WebhookLogEntry) {
  const log = readWebhookLog();
  log.unshift(entry);
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 50)));
  // notify settings listeners so log UI re-renders
  setSettings({});
}

async function post(url: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors", // Slack/Zapier hooks reject CORS preflights
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface DispatchInput {
  settings: AppSettings;
  verdicts: Verdict[];
  positions: { id: string; symbol: string }[];
}

/** Detects WAIT→GO/EXIT transitions and fires the webhook for each. */
export async function dispatchVerdictTransitions({ settings, verdicts, positions }: DispatchInput) {
  if (!settings.webhookEnabled || !settings.webhookUrl) return;
  const last = readState();
  const next = { ...last };
  const symBy = new Map(positions.map((p) => [p.id, p.symbol]));

  for (const v of verdicts) {
    const sig = verdictToSignal(v);
    const prev = last[v.id];
    next[v.id] = sig;

    // Skip if no change
    if (prev === sig) continue;
    // First-ever sighting: only alert if it's a GO/EXIT (or WAIT when opted in)
    const isFirstSighting = prev === undefined;
    const shouldFire =
      sig === "GO" || sig === "EXIT" ||
      (sig === "WAIT" && settings.webhookOnWait && !isFirstSighting);
    if (!shouldFire) continue;
    if (isFirstSighting && sig === "WAIT") continue;

    const symbol = symBy.get(v.id) ?? "?";
    const headline =
      sig === "GO"   ? `🟢 GO — ${symbol}` :
      sig === "EXIT" ? `🚨 EXIT — ${symbol}` :
                       `⏳ WAIT — ${symbol}`;
    const payload = {
      event: "nova_verdict_transition",
      symbol,
      positionId: v.id,
      from: prev ?? "NEW",
      to: sig,
      status: v.status,
      action: v.action,
      verdict: v.verdict,
      // Slack-friendly shape (ignored by Make/n8n which read top-level fields)
      text: `${headline}\n${v.verdict}`,
      at: new Date().toISOString(),
    };
    const res = await post(settings.webhookUrl, payload);
    pushLog({
      at: payload.at,
      symbol,
      from: (prev ?? "NEW") as Signal,
      to: sig,
      ok: res.ok,
      error: res.error,
    });
  }
  writeState(next);
}

/** Manual test payload from Settings page. */
export async function sendTestWebhook(url: string): Promise<{ ok: boolean; error?: string }> {
  const res = await post(url, {
    event: "nova_test",
    text: "✅ Nova webhook test — your alerts are wired up.",
    at: new Date().toISOString(),
  });
  pushLog({
    at: new Date().toISOString(),
    symbol: "TEST",
    from: "WAIT",
    to: "GO",
    ok: res.ok,
    error: res.error,
  });
  return res;
}

export function clearWebhookLog() {
  localStorage.removeItem(LOG_KEY);
  setSettings({});
}
