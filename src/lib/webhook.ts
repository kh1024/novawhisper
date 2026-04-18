// Webhook delivery — tracks WAIT→GO transitions per position and POSTs to a
// user-configured URL (Make.com, n8n, Zapier, Slack incoming webhook, etc.).
// Uses no-cors mode so it works against Slack/Zapier without preflight pain.
import { setSettings } from "./settings";
import type { AppSettings } from "./settings";
import type { Verdict } from "./portfolioVerdict";

const STATE_KEY = "nova_webhook_last_state";
const LOG_KEY = "nova_webhook_log";

type Signal = "GO" | "WAIT" | "EXIT" | "NO";

function verdictToSignal(v: Verdict): Signal {
  // Prefer the deterministic CRL verdict if present
  if (v.crl) {
    if (v.crl.stopLossTriggered) return "EXIT";
    if (v.crl.verdict === "GO") return "GO";
    if (v.crl.verdict === "EXIT") return "EXIT";
    if (v.crl.verdict === "NO") return "NO";
    if (v.crl.verdict === "WAIT") return "WAIT";
  }
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
      sig === "GO" || sig === "EXIT" || sig === "NO" ||
      (sig === "WAIT" && settings.webhookOnWait && !isFirstSighting);
    if (!shouldFire) continue;
    if (isFirstSighting && sig === "WAIT") continue;

    const symbol = symBy.get(v.id) ?? "?";
    const headline =
      sig === "GO"   ? `🟢 GO — ${symbol}` :
      sig === "EXIT" ? `🚨 EXIT — ${symbol} (broke 8-EMA)` :
      sig === "NO"   ? `⛔ NO — ${symbol} (time decay trap)` :
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

// ─────────────────────────────────────────────────────────────────────────────
//  Scanner / Web Picks GO-tier alerts
//  Separate dedupe state so portfolio-position transitions stay independent.
// ─────────────────────────────────────────────────────────────────────────────

const PICK_STATE_KEY = "nova_webhook_pick_seen";
// Cap the seen-set so localStorage doesn't grow forever.
const MAX_SEEN_KEYS = 500;

function readPickSeen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PICK_STATE_KEY) || "{}"); }
  catch { return {}; }
}
function writePickSeen(s: Record<string, number>) {
  // Keep the newest MAX_SEEN_KEYS entries (by timestamp).
  const entries = Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN_KEYS);
  localStorage.setItem(PICK_STATE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export interface PickAlert {
  /** Stable key — same pick on repeat scans must produce the same key. */
  key: string;
  symbol: string;
  source: "scanner" | "web-pick" | "planning";
  /** Plain-language reason this alert fired. */
  reason: string;
  /** Optional contract details — included in payload but not required. */
  strategy?: string;
  optionType?: string;
  direction?: string;
  strike?: number;
  expiry?: string;
  /** Optional risk tier (safe / mild / aggressive). */
  risk?: string;
}

interface DispatchPicksInput {
  settings: AppSettings;
  picks: PickAlert[];
}

/**
 * Fire a GO webhook for any pick whose `key` we haven't seen before.
 * Caller is responsible for filtering to GO-tier picks only.
 */
export async function dispatchPickAlerts({ settings, picks }: DispatchPicksInput) {
  if (!settings.webhookEnabled || !settings.webhookUrl) return;
  if (picks.length === 0) return;
  const seen = readPickSeen();
  const next = { ...seen };
  let fired = false;

  for (const pick of picks) {
    if (seen[pick.key]) continue;
    next[pick.key] = Date.now();
    fired = true;

    const sourceLabel = pick.source === "scanner" ? "Scanner" : pick.source === "web-pick" ? "Web Pick" : "Planning";
    const headline = `🟢 GO — ${pick.symbol} (${sourceLabel})`;
    const contract = pick.strike != null && pick.optionType
      ? ` · $${pick.strike} ${pick.optionType.toUpperCase()}${pick.expiry ? ` exp ${pick.expiry}` : ""}`
      : "";
    const payload = {
      event: "nova_pick_signal",
      symbol: pick.symbol,
      source: pick.source,
      key: pick.key,
      from: "NEW",
      to: "GO" as Signal,
      reason: pick.reason,
      strategy: pick.strategy,
      optionType: pick.optionType,
      direction: pick.direction,
      strike: pick.strike,
      expiry: pick.expiry,
      risk: pick.risk,
      text: `${headline}${contract}\n${pick.reason}`,
      at: new Date().toISOString(),
    };
    const res = await post(settings.webhookUrl, payload);
    pushLog({
      at: payload.at,
      symbol: `${pick.symbol} · ${sourceLabel}`,
      from: "NEW" as Signal,
      to: "GO",
      ok: res.ok,
      error: res.error,
    });
  }
  if (fired) writePickSeen(next);
}

/** Wipe the pick dedupe state — useful for "force re-alert" buttons. */
export function clearPickSeenState() {
  localStorage.removeItem(PICK_STATE_KEY);
}
