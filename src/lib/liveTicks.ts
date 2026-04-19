// Shared client-side live-ticks scheduler.
//
// One global 3s poller for the UNION of symbols mounted by any consumer
// (LiveMiniScanner, TickerPrice, …). Symbols are deduped + capped at 25 per
// invocation. Subscribers receive ticks via the "live-ticks" Supabase
// Realtime broadcast channel.
//
// Gating:
//   • Pauses when document.hidden (saves quota when tab unfocused).
//   • Pauses outside US market RTH+extended (9:30am – 8pm ET, Mon–Fri).
//
// API:
//   const { price, ts } = useLiveTick("AAPL");  → updates as ticks arrive
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface LiveTick {
  symbol: string;
  price: number;
  ts: number; // ms epoch
}

const POLL_MS = 3_000;
const MAX_SYMBOLS = 25;

// Module-level state — singleton across the app.
const subscribers = new Map<string, Set<(t: LiveTick) => void>>(); // symbol → listeners
const lastTick = new Map<string, LiveTick>();                     // symbol → last received
let pollerId: number | null = null;
let channelReady = false;

function isMarketOpen(): boolean {
  // US Eastern Time: 9:30am – 8:00pm covers RTH + extended sessions.
  // Use Intl to convert reliably regardless of user timezone.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (wd === "Sat" || wd === "Sun") return false;
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 + 30 && minutes < 20 * 60;
}

function ensureChannel() {
  if (channelReady) return;
  channelReady = true;
  const channel = supabase.channel("live-ticks");
  channel
    .on("broadcast", { event: "ticks" }, (payload) => {
      const ticks = (payload.payload as { ticks?: LiveTick[] })?.ticks ?? [];
      for (const t of ticks) {
        if (!t?.symbol) continue;
        lastTick.set(t.symbol, t);
        const subs = subscribers.get(t.symbol);
        if (subs) for (const fn of subs) fn(t);
      }
    })
    .subscribe();
}

async function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  if (!isMarketOpen()) return;
  const symbols = Array.from(subscribers.keys()).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return;
  try {
    await supabase.functions.invoke("live-ticks-broadcast", { body: { symbols } });
  } catch {
    // Silent — next tick will retry.
  }
}

function ensurePoller() {
  if (pollerId !== null) return;
  ensureChannel();
  // Fire immediately so first paint isn't 3s away.
  void tick();
  pollerId = window.setInterval(tick, POLL_MS);
}

function maybeStopPoller() {
  if (subscribers.size === 0 && pollerId !== null) {
    window.clearInterval(pollerId);
    pollerId = null;
  }
}

/** Subscribe a single symbol; returns the latest tick (or null). */
export function useLiveTick(symbol: string | null | undefined): LiveTick | null {
  const [tick, setTick] = useState<LiveTick | null>(() => (symbol ? lastTick.get(symbol) ?? null : null));
  const symRef = useRef(symbol);
  symRef.current = symbol;

  useEffect(() => {
    if (!symbol) return;
    const sym = symbol.toUpperCase();
    let set = subscribers.get(sym);
    if (!set) { set = new Set(); subscribers.set(sym, set); }
    const listener = (t: LiveTick) => setTick(t);
    set.add(listener);
    // Hydrate from cache if present.
    const cached = lastTick.get(sym);
    if (cached) setTick(cached);
    ensurePoller();
    return () => {
      set!.delete(listener);
      if (set!.size === 0) subscribers.delete(sym);
      maybeStopPoller();
    };
  }, [symbol]);

  return tick;
}

/** Subscribe to many symbols at once (used by LiveMiniScanner). */
export function useLiveTicks(symbols: string[]): Map<string, LiveTick> {
  const [, force] = useState(0);
  useEffect(() => {
    if (!symbols.length) return;
    const norm = symbols.map((s) => s.toUpperCase());
    const listener = () => force((n) => n + 1);
    for (const sym of norm) {
      let set = subscribers.get(sym);
      if (!set) { set = new Set(); subscribers.set(sym, set); }
      set.add(listener);
    }
    ensurePoller();
    return () => {
      for (const sym of norm) {
        const set = subscribers.get(sym);
        if (!set) continue;
        set.delete(listener);
        if (set.size === 0) subscribers.delete(sym);
      }
      maybeStopPoller();
    };
  }, [symbols.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = new Map<string, LiveTick>();
  for (const sym of symbols.map((s) => s.toUpperCase())) {
    const t = lastTick.get(sym);
    if (t) out.set(sym, t);
  }
  return out;
}
