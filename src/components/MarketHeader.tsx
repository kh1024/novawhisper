import { useEffect, useState } from "react";
import { RefreshCw, Clock, FlaskConical } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useLiveQuotes, currentSessionET, type Session } from "@/lib/liveData";
import { useSettings } from "@/lib/settings";
import { useQueryClient } from "@tanstack/react-query";

const SESSION_PILL: Record<Session, { label: string; cls: string; live: boolean; tip: string }> = {
  pre:     { label: "Pre-Market",  cls: "pill border-primary/40 bg-primary/10 text-primary", live: true,  tip: "US pre-market session (04:00–09:30 ET). Lower liquidity; refresh throttled to 2 min." },
  regular: { label: "Market Open", cls: "pill-live",   live: true,  tip: "Regular US session (09:30–16:00 ET)." },
  post:    { label: "After-Hours", cls: "pill border-warning/40 bg-warning/10 text-warning",  live: true,  tip: "US after-hours session (16:00–20:00 ET). Lower liquidity; refresh throttled to 2 min." },
  closed:  { label: "Market Closed", cls: "pill-neutral", live: false, tip: "US equity market is closed. Showing the last regular-session prices." },
};

function formatInterval(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function MarketHeader() {
  const [now, setNow] = useState(new Date());
  const [settings] = useSettings();
  const qc = useQueryClient();
  const { data: quotes = [], isFetching } = useLiveQuotes();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const session = currentSessionET();
  const sessionPill = SESSION_PILL[session];
  const time = ny.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  // Derive live source health from real quote responses
  const verifiedCount = quotes.filter((q) => q.status === "verified" || q.status === "close").length;
  const total = quotes.length;
  const isLive = total > 0;
  const allGood = isLive && verifiedCount / total >= 0.7;

  const sourceLabel = !isLive
    ? "Source: Connecting…"
    : allGood
    ? "Source: Live (Finnhub + AV)"
    : "Source: Live (degraded)";
  const sourceCls = !isLive ? "pill-neutral" : allGood ? "pill-bullish" : "pill-bearish";

  return (
    <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-surface/40 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      <div className="hidden md:flex items-center gap-2">
        <span className={sessionPill.cls} title={sessionPill.tip}>
          <span className={sessionPill.live ? "live-dot" : "h-1.5 w-1.5 rounded-full bg-muted-foreground inline-block"} />
          {sessionPill.label}
        </span>
        <span className="pill pill-neutral">
          <Clock className="h-3 w-3" />
          <span className="mono">{time} ET</span>
        </span>
        <span className={`pill ${sourceCls}`}>{sourceLabel}</span>
        {settings.paperMode && (
          <span className="pill border-warning/50 bg-warning/15 text-warning gap-1" title="Simulation Mode is ON — new saves go to your paper book">
            <FlaskConical className="h-3 w-3" />
            SIM MODE
          </span>
        )}
        {isLive && (
          <span className="pill pill-live">
            <span className="live-dot" />
            {verifiedCount}/{total} verified
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden lg:inline">
          Refresh: <span className="mono">{formatInterval(settings.refreshMs)}</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => qc.invalidateQueries({ queryKey: ["live-quotes"] })}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          <span className="text-xs">Refresh</span>
        </Button>
      </div>
    </header>
  );
}
