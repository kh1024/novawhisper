import { useEffect, useState } from "react";
import { RefreshCw, Clock } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

function isMarketOpen(nyDate: Date) {
  const day = nyDate.getDay();
  if (day === 0 || day === 6) return false;
  const mins = nyDate.getHours() * 60 + nyDate.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function MarketHeader() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const open = isMarketOpen(ny);
  const time = ny.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });

  return (
    <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-surface/40 backdrop-blur-xl">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      <div className="hidden md:flex items-center gap-2">
        <span className={`pill ${open ? "pill-live" : "pill-neutral"}`}>
          <span className={open ? "live-dot" : "h-1.5 w-1.5 rounded-full bg-muted-foreground inline-block"} />
          {open ? "Market Open" : "Market Closed"}
        </span>
        <span className="pill pill-neutral">
          <Clock className="h-3 w-3" />
          <span className="mono">{time} ET</span>
        </span>
        <span className="pill pill-neutral">Source: Mock</span>
        <span className="pill pill-live">
          <span className="live-dot" />
          Verified
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden lg:inline">
          Refresh: <span className="mono">15s</span>
        </span>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-xs">Refresh</span>
        </Button>
      </div>
    </header>
  );
}
