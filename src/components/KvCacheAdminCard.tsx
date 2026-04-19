import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Entry {
  key: string;
  expires_at: string | null;
  updated_at: string;
}

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  const hr = Math.round(abs / 3_600_000);
  if (abs < 60_000) return ms >= 0 ? "in <1m" : "<1m ago";
  if (abs < 3_600_000) return ms >= 0 ? `in ${min}m` : `${min}m ago`;
  if (abs < 86_400_000) return ms >= 0 ? `in ${hr}h` : `${hr}h ago`;
  const d = Math.round(abs / 86_400_000);
  return ms >= 0 ? `in ${d}d` : `${d}d ago`;
}

export function KvCacheAdminCard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("kv-cache-admin", {
        body: { action: "list" },
      });
      if (error) throw error;
      setEntries(data?.entries ?? []);
    } catch (e: any) {
      toast.error(`Cache list failed: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const flush = async (key: string) => {
    setBusyKey(key);
    try {
      const { data, error } = await supabase.functions.invoke("kv-cache-admin", {
        body: { action: "delete", key },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? "delete failed");
      toast.success(`Flushed ${key}`);
      setEntries((prev) => prev.filter((e) => e.key !== key));
    } catch (e: any) {
      toast.error(`Flush failed: ${e?.message ?? e}`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card className="glass-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" /> Backend cache
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Server-side memoization (Yahoo session, options-chain snapshots, etc.). Flush an entry
            to force a fresh fetch on the next request.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
          {loading ? "Loading…" : "No cache entries."}
        </div>
      ) : (
        <div className="border-t border-border/40 pt-2 -mx-2">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] uppercase tracking-wider text-muted-foreground px-2 pb-1">
            <div>Key</div>
            <div>Expires</div>
            <div>Updated</div>
            <div className="sr-only">Actions</div>
          </div>
          <ul className="divide-y divide-border/40">
            {entries.map((e) => {
              const expired = e.expires_at ? Date.parse(e.expires_at) < Date.now() : false;
              return (
                <li
                  key={e.key}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 px-2 py-1.5 text-xs"
                >
                  <span className="font-mono truncate" title={e.key}>{e.key}</span>
                  <span className={expired ? "text-bearish" : "text-muted-foreground"}>
                    {fmtRel(e.expires_at)}
                  </span>
                  <span className="text-muted-foreground">{fmtRel(e.updated_at)}</span>
                  <button
                    onClick={() => flush(e.key)}
                    disabled={busyKey === e.key}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                    title="Flush entry"
                  >
                    {busyKey === e.key
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
