// Pre-market futures coverage: Dow, S&P 500, Nasdaq with animated meters.
// Meter encodes magnitude of % change (capped at ±2%) — green when up, red when down.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface FuturesQuote {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  updatedAt: string;
}

async function fetchFutures(): Promise<FuturesQuote[]> {
  const { data, error } = await supabase.functions.invoke("futures-fetch", { body: {} });
  if (error) throw error;
  return (data?.quotes ?? []) as FuturesQuote[];
}

function meterPctOf(changePct: number | null): number {
  if (changePct == null || !Number.isFinite(changePct)) return 50;
  // ±2% maps to full meter; midpoint 50 = flat.
  const clamped = Math.max(-2, Math.min(2, changePct));
  return 50 + (clamped / 2) * 50;
}

function toneOf(changePct: number | null): "up" | "down" | "flat" {
  if (changePct == null || Math.abs(changePct) < 0.05) return "flat";
  return changePct > 0 ? "up" : "down";
}

export function PreMarketFutures() {
  const { data: quotes = [], isLoading, isFetching } = useQuery({
    queryKey: ["futures"],
    queryFn: fetchFutures,
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  return (
    <Card className="glass-card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide">Pre-Market Futures Coverage</h2>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground/70 hover:text-foreground transition-colors">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                Index futures trade nearly 24/5 and signal where the cash market may open. Meter scale: ±2% = full bar.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {(isLoading || isFetching) && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>Source: Yahoo Finance</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {quotes.length === 0 && isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[112px] rounded-lg border border-border/40 bg-surface/40 animate-pulse" />
            ))
          : quotes.map((q, i) => {
              const tone = toneOf(q.changePct);
              const meter = meterPctOf(q.changePct);
              const barCls = tone === "up" ? "bg-bullish" : tone === "down" ? "bg-bearish" : "bg-muted-foreground/40";
              const textCls = tone === "up" ? "text-bullish" : tone === "down" ? "text-bearish" : "text-muted-foreground";
              const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : Minus;
              const pct = q.changePct;
              const chg = q.change;
              return (
                <motion.div
                  key={q.symbol}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.35 }}
                  className="p-4 rounded-lg border border-border bg-surface/40 hover:border-primary/40 hover:bg-surface transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{q.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{q.symbol}</div>
                    </div>
                    <Icon className={`h-4 w-4 ${textCls}`} />
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="mono text-xl font-semibold">
                      {q.price != null ? q.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                    </span>
                    <span className={`mono text-xs ${textCls}`}>
                      {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden relative">
                    {/* center mark */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/80" />
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.abs(meter - 50)}%` }}
                      transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 + i * 0.05 }}
                      className={`absolute top-0 bottom-0 ${barCls} ${tone === "up" ? "left-1/2" : "right-1/2"} rounded-full`}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} pts` : "Awaiting quote…"}
                    {q.marketState ? ` · ${q.marketState}` : ""}
                  </div>
                </motion.div>
              );
            })}
      </div>
    </Card>
  );
}
