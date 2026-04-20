// Settings → Debug Data Layer drawer.
// Surfaces the shared option-snapshot pipeline so users (and the AI editor)
// can verify Massive is responding live, inspect the last 20 requests, and
// force-refresh all open positions on demand.
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bug, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface RequestLogEntry {
  optionSymbol: string;
  underlying: string;
  httpStatus: number | "ERR";
  latencyMs: number;
  source: string;
  quality: string;
  ts: string;
}

export function DebugDataLayerDrawer({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshLog() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("option-snapshot/log", {
        method: "GET" as any,
      });
      if (error) throw error;
      setLog(((data as any)?.log ?? []) as RequestLogEntry[]);
    } catch (e) {
      toast({ title: "Could not fetch request log", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function forceRefreshAll() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("portfolio-exit-eval", {
        body: { force: true },
      });
      if (error) throw error;
      toast({
        title: "All positions re-evaluated",
        description: `evaluated=${(data as any)?.evaluated ?? "?"} stops=${(data as any)?.stops ?? 0} profits=${(data as any)?.profits ?? 0}`,
      });
      await refreshLog();
    } catch (e) {
      toast({ title: "Force refresh failed", description: String(e), variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (open) refreshLog();
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Bug className="h-4 w-4" /> Debug Data Layer
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" /> Debug Data Layer
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          {/* Plan badge */}
          <div className="rounded-md border border-bullish/40 bg-bullish/5 px-3 py-2">
            <div className="font-semibold text-bullish">Massive · Options Advanced</div>
            <div className="text-xs text-muted-foreground">
              Real-time NBBO · Unlimited API calls · 5+ years history · Full OPRA coverage
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={refreshLog} variant="outline" size="sm" disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh log
            </Button>
            <Button onClick={forceRefreshAll} size="sm" disabled={refreshing} className="gap-2">
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Force refresh all positions
            </Button>
          </div>

          {/* Request log */}
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Last {log.length} Massive requests
            </div>
            {log.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No requests yet. Trigger a refresh, or wait for the next exit-eval tick.
              </div>
            )}
            <div className="space-y-1.5">
              {log.slice().reverse().map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-surface/40 px-2 py-1.5 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono truncate">{r.optionSymbol || r.underlying}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(r.ts).toLocaleTimeString()} · {r.latencyMs}ms · {r.source}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        r.httpStatus === 200 ? "border-bullish/40 text-bullish bg-bullish/5"
                          : r.httpStatus === "ERR" ? "border-bearish/40 text-bearish bg-bearish/5"
                          : "border-warning/40 text-warning bg-warning/5",
                      )}
                    >
                      {r.httpStatus}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        r.quality === "VALID" ? "border-bullish/40 text-bullish bg-bullish/5"
                          : r.quality === "STALE" ? "border-warning/40 text-warning bg-warning/5"
                          : "border-bearish/40 text-bearish bg-bearish/5",
                      )}
                    >
                      {r.quality}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
