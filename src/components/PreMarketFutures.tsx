// Pre-market futures coverage with semicircle gauge meters.
// Gauge encodes % change vs prior close, capped at ±2% (full sweep).
// Needle rotates -90° (–2%) → 0° (flat) → +90° (+2%); colored arc fills from center.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface FuturesQuote {
  symbol: string;
  cnbcSymbol?: string;
  label: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  lastTime: string | null;
  updatedAt: string;
}

async function fetchFutures(): Promise<FuturesQuote[]> {
  const { data, error } = await supabase.functions.invoke("futures-fetch", { body: {} });
  if (error) throw error;
  return (data?.quotes ?? []) as FuturesQuote[];
}

const MAX_PCT = 2; // ±2% maps to full needle deflection

function clampPct(p: number | null): number {
  if (p == null || !Number.isFinite(p)) return 0;
  return Math.max(-MAX_PCT, Math.min(MAX_PCT, p));
}

function toneOf(changePct: number | null): "up" | "down" | "flat" {
  if (changePct == null || Math.abs(changePct) < 0.05) return "flat";
  return changePct > 0 ? "up" : "down";
}

/**
 * Semicircle SVG gauge. 200×110 viewbox; arc center at (100, 100), r=80.
 * Track is a faint half-circle; colored arc fills from the bottom-center
 * toward the needle position. Needle rotates around (100, 100).
 */
function Gauge({ pct }: { pct: number | null }) {
  const tone = toneOf(pct);
  const clamped = clampPct(pct);
  const ratio = clamped / MAX_PCT;        // -1..1
  const angle = ratio * 90;               // -90..90 deg
  const arcColor =
    tone === "up" ? "hsl(var(--bullish))" :
    tone === "down" ? "hsl(var(--bearish))" :
    "hsl(var(--muted-foreground))";
  const r = 80;
  const cx = 100;
  const cy = 100;
  // Compute arc endpoint at the needle angle (relative to vertical "up" = 0)
  const rad = (angle - 90) * (Math.PI / 180); // rotate so 0deg points up
  const ex = cx + r * Math.cos(rad);
  const ey = cy + r * Math.sin(rad);
  // Anchor: bottom-center of half-circle arc = (cx - r, cy) on the left, so
  // we draw from the centre top (cx, cy-r) along the appropriate sweep.
  const sx = cx;
  const sy = cy - r;
  const sweep = ratio >= 0 ? 1 : 0;
  // For negative, swap start/end so the arc still draws clockwise from top.
  const d = ratio >= 0
    ? `M ${sx} ${sy} A ${r} ${r} 0 0 ${sweep} ${ex} ${ey}`
    : `M ${ex} ${ey} A ${r} ${r} 0 0 1 ${sx} ${sy}`;

  return (
    <svg viewBox="0 0 200 115" className="w-full h-auto" aria-hidden>
      {/* Track (full half-circle) */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="hsl(var(--muted) / 0.4)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Tick marks at -2%, -1%, 0, +1%, +2% */}
      {[-90, -45, 0, 45, 90].map((a) => {
        const ar = (a - 90) * (Math.PI / 180);
        const x1 = cx + (r + 4) * Math.cos(ar);
        const y1 = cy + (r + 4) * Math.sin(ar);
        const x2 = cx + (r - 4) * Math.cos(ar);
        const y2 = cy + (r - 4) * Math.sin(ar);
        return (
          <line key={a} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1" />
        );
      })}
      {/* Filled arc (animated) */}
      {Math.abs(ratio) > 0.01 && (
        <motion.path
          d={d}
          fill="none"
          stroke={arcColor}
          strokeWidth="10"
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        />
      )}
      {/* Needle */}
      <motion.line
        x1={cx} y1={cy} x2={cx} y2={cy - r + 8}
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        initial={{ rotate: 0 }}
        animate={{ rotate: angle }}
        transition={{ type: "spring", stiffness: 120, damping: 14 }}
      />
      {/* Hub */}
      <circle cx={cx} cy={cy} r="6" fill="hsl(var(--background))" stroke={arcColor} strokeWidth="2" />
      {/* Labels */}
      <text x="14" y="110" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">-2%</text>
      <text x={cx} y="112" textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">0</text>
      <text x="186" y="110" fontSize="9" textAnchor="end" fill="hsl(var(--muted-foreground))" fontFamily="monospace">+2%</text>
    </svg>
  );
}

export function PreMarketFutures() {
  const { data: quotes = [], isLoading, isFetching, error } = useQuery({
    queryKey: ["futures"],
    queryFn: fetchFutures,
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const allMissing = quotes.length > 0 && quotes.every((q) => q.price == null);

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
                Index futures trade nearly 24/5 and signal where the cash market may open. Gauge: full deflection = ±2% vs prior close.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {(isLoading || isFetching) && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>Source: CNBC</span>
        </div>
      </div>

      {error && (
        <div className="text-xs text-bearish py-2">Couldn't fetch futures: {(error as Error).message}</div>
      )}
      {allMissing && !error && (
        <div className="text-xs text-muted-foreground py-2">No quotes returned — futures provider may be temporarily unavailable.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {quotes.length === 0 && isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[200px] rounded-lg border border-border/40 bg-surface/40 animate-pulse" />
            ))
          : quotes.map((q, i) => {
              const tone = toneOf(q.changePct);
              const textCls = tone === "up" ? "text-bullish" : tone === "down" ? "text-bearish" : "text-muted-foreground";
              const Icon = tone === "up" ? TrendingUp : tone === "down" ? TrendingDown : Minus;
              return (
                <motion.div
                  key={q.symbol}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.35 }}
                  className="p-4 rounded-lg border border-border bg-surface/40 hover:border-primary/40 hover:bg-surface transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{q.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{q.symbol}</div>
                    </div>
                    <Icon className={`h-4 w-4 ${textCls}`} />
                  </div>

                  <Gauge pct={q.changePct} />

                  <div className="flex items-baseline justify-between gap-2 mt-1">
                    <span className="mono text-xl font-semibold">
                      {q.price != null ? q.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                    </span>
                    <span className={`mono text-sm font-semibold ${textCls}`}>
                      {q.changePct != null ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {q.change != null ? `${q.change >= 0 ? "+" : ""}${q.change.toFixed(2)} pts` : "Awaiting quote…"}
                    {q.lastTime ? ` · ${q.lastTime}` : ""}
                  </div>
                </motion.div>
              );
            })}
      </div>
    </Card>
  );
}
