// /performance — AI Self-Monitoring Dashboard
// Tracks every Scanner verdict against real outcomes and shows hit rate,
// avg return, calibration, and the auto-tuned learning weights the ranker
// uses to refine itself.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/Hint";
import { ACTION_HINT } from "@/lib/glossary";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Brain, RefreshCw, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchLearningWeights, type LearningWeight } from "@/lib/learningWeights";
import { toast } from "sonner";

interface SnapRow { id: string; snapshot_date: string; symbol: string; label: string; final_rank: number; bias: string; entry_price: number }
interface OutRow { snapshot_id: string; window_days: number; return_pct: number; is_win: boolean; exit_price: number }

const LABELS = ["BUY", "WATCHLIST", "WAIT", "DON'T BUY"] as const;
const PRIMARY_WINDOW = 5;

function labelTone(label: string): string {
  if (label === "BUY") return "text-bullish";
  if (label === "WATCHLIST") return "text-primary";
  if (label === "WAIT") return "text-warning";
  return "text-bearish";
}
function labelBg(label: string): string {
  if (label === "BUY") return "bg-bullish/15 border-bullish/40";
  if (label === "WATCHLIST") return "bg-primary/10 border-primary/40";
  if (label === "WAIT") return "bg-warning/10 border-warning/40";
  return "bg-bearish/10 border-bearish/40";
}

export default function Performance() {
  const [snapshots, setSnapshots] = useState<SnapRow[]>([]);
  const [outcomes, setOutcomes] = useState<OutRow[]>([]);
  const [weights, setWeights] = useState<LearningWeight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const [snapRes, weightRes] = await Promise.all([
      supabase
        .from("pick_snapshots")
        .select("id,snapshot_date,symbol,label,final_rank,bias,entry_price")
        .gte("snapshot_date", cutoffStr)
        .order("snapshot_date", { ascending: false })
        .limit(2000),
      fetchLearningWeights(true),
    ]);
    const snaps = (snapRes.data ?? []) as SnapRow[];
    setSnapshots(snaps);
    setWeights(weightRes);

    if (snaps.length > 0) {
      const ids = snaps.map((s) => s.id);
      const outRes = await supabase
        .from("pick_outcomes")
        .select("snapshot_id,window_days,return_pct,is_win,exit_price")
        .in("snapshot_id", ids)
        .limit(5000);
      setOutcomes((outRes.data ?? []) as OutRow[]);
    } else {
      setOutcomes([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const refreshLearning = async () => {
    setRefreshing(true);
    try {
      const evalRes = await supabase.functions.invoke("perf-evaluate", { body: {} });
      const learnRes = await supabase.functions.invoke("perf-learn", { body: {} });
      if (evalRes.error || learnRes.error) throw evalRes.error || learnRes.error;
      toast.success("Re-evaluated outcomes and refreshed learning weights");
      await load();
    } catch (e) {
      toast.error("Refresh failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRefreshing(false);
    }
  };

  // ── Aggregate metrics keyed by label, using the 5d primary window. ──
  const stats = useMemo(() => {
    const snapById = new Map(snapshots.map((s) => [s.id, s]));
    const out5 = outcomes.filter((o) => o.window_days === PRIMARY_WINDOW);

    const byLabel: Record<string, {
      label: string;
      total: number;
      wins: number;
      sumReturn: number;
      best: { symbol: string; ret: number } | null;
      worst: { symbol: string; ret: number } | null;
      returns: number[];
    }> = {};
    for (const lbl of LABELS) byLabel[lbl] = { label: lbl, total: 0, wins: 0, sumReturn: 0, best: null, worst: null, returns: [] };

    for (const o of out5) {
      const snap = snapById.get(o.snapshot_id);
      if (!snap) continue;
      const bucket = byLabel[snap.label];
      if (!bucket) continue;
      bucket.total++;
      if (o.is_win) bucket.wins++;
      bucket.sumReturn += Number(o.return_pct);
      bucket.returns.push(Number(o.return_pct));
      if (!bucket.best || o.return_pct > bucket.best.ret) bucket.best = { symbol: snap.symbol, ret: Number(o.return_pct) };
      if (!bucket.worst || o.return_pct < bucket.worst.ret) bucket.worst = { symbol: snap.symbol, ret: Number(o.return_pct) };
    }

    // Overall + risk-adjusted (Sharpe-like on the primary window)
    const allReturns = out5.map((o) => Number(o.return_pct));
    const overallTotal = allReturns.length;
    const overallWins = out5.filter((o) => o.is_win).length;
    const avgRet = overallTotal > 0 ? allReturns.reduce((s, v) => s + v, 0) / overallTotal : 0;
    const stdev = overallTotal > 1
      ? Math.sqrt(allReturns.reduce((s, v) => s + (v - avgRet) ** 2, 0) / (overallTotal - 1))
      : 0;
    const sharpe = stdev > 0 ? +(avgRet / stdev).toFixed(2) : 0;

    const wins = allReturns.filter((r) => r > 0);
    const losses = allReturns.filter((r) => r <= 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
    const winLossRatio = avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0;
    const profitFactor = (() => {
      const grossWin = wins.reduce((s, v) => s + v, 0);
      const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
      return grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : 0;
    })();

    return {
      byLabel,
      overall: {
        total: overallTotal,
        hitRate: overallTotal > 0 ? overallWins / overallTotal : 0,
        avgReturn: avgRet,
        sharpe,
        winLossRatio,
        profitFactor,
      },
    };
  }, [snapshots, outcomes]);

  // ── Calibration: rank-bucket → realized avg 5d return ──
  const calibration = useMemo(() => {
    const snapById = new Map(snapshots.map((s) => [s.id, s]));
    const out5 = outcomes.filter((o) => o.window_days === PRIMARY_WINDOW);
    const buckets = [
      { label: "<50", lo: 0, hi: 49, sum: 0, n: 0 },
      { label: "50–59", lo: 50, hi: 59, sum: 0, n: 0 },
      { label: "60–69", lo: 60, hi: 69, sum: 0, n: 0 },
      { label: "70–79", lo: 70, hi: 79, sum: 0, n: 0 },
      { label: "80–89", lo: 80, hi: 89, sum: 0, n: 0 },
      { label: "90+", lo: 90, hi: 200, sum: 0, n: 0 },
    ];
    for (const o of out5) {
      const snap = snapById.get(o.snapshot_id);
      if (!snap) continue;
      const b = buckets.find((x) => snap.final_rank >= x.lo && snap.final_rank <= x.hi);
      if (!b) continue;
      b.sum += Number(o.return_pct); b.n++;
    }
    return buckets.map((b) => ({ label: b.label, avgReturn: b.n > 0 ? +(b.sum / b.n).toFixed(2) : 0, count: b.n }));
  }, [snapshots, outcomes]);

  // ── Recent evaluated picks for the table ──
  const recent = useMemo(() => {
    const out5 = outcomes.filter((o) => o.window_days === PRIMARY_WINDOW);
    const snapById = new Map(snapshots.map((s) => [s.id, s]));
    return out5
      .map((o) => {
        const s = snapById.get(o.snapshot_id);
        if (!s) return null;
        return { ...s, ...o };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.snapshot_date > a!.snapshot_date ? 1 : -1))
      .slice(0, 30) as Array<SnapRow & OutRow>;
  }, [snapshots, outcomes]);

  const noData = !loading && snapshots.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> Performance & Self-Learning
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Tracks every Scanner verdict against actual price action over 1 / 5 / 20-day windows.
            The ranker reads the resulting hit rates and gently auto-tunes itself — visible in the
            <span className="text-primary"> Learning Weights</span> panel below.
          </p>
        </div>
        <Button onClick={refreshLearning} disabled={refreshing} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Re-evaluate now
        </Button>
      </div>

      {noData && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No snapshots yet. Open the <strong>Scanner</strong> or <strong>Dashboard</strong> — every
            visit records the AI's verdicts. Outcomes start appearing after 1 trading day.
          </CardContent>
        </Card>
      )}

      {/* ── Header KPIs ── */}
      {!noData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Picks Evaluated" value={String(stats.overall.total)} sub="last 90 days" loading={loading} />
          <KpiCard
            label="Overall Hit Rate"
            value={`${(stats.overall.hitRate * 100).toFixed(1)}%`}
            sub={`${PRIMARY_WINDOW}d window`}
            tone={stats.overall.hitRate >= 0.55 ? "good" : stats.overall.hitRate >= 0.45 ? "neutral" : "bad"}
            loading={loading}
          />
          <KpiCard
            label="Avg Return"
            value={`${stats.overall.avgReturn >= 0 ? "+" : ""}${stats.overall.avgReturn.toFixed(2)}%`}
            sub="per pick"
            tone={stats.overall.avgReturn >= 0 ? "good" : "bad"}
            loading={loading}
          />
          <KpiCard
            label="Sharpe-like / PF"
            value={`${stats.overall.sharpe} / ${stats.overall.profitFactor}`}
            sub={`win/loss ${stats.overall.winLossRatio}`}
            tone={stats.overall.sharpe >= 0.5 ? "good" : stats.overall.sharpe >= 0 ? "neutral" : "bad"}
            loading={loading}
          />
        </div>
      )}

      {/* ── Per-label cards ── */}
      {!noData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {LABELS.map((lbl) => {
            const b = stats.byLabel[lbl];
            const hit = b.total > 0 ? b.wins / b.total : 0;
            const avg = b.total > 0 ? b.sumReturn / b.total : 0;
            return (
              <Card key={lbl} className={`border ${labelBg(lbl)}`}>
                <CardHeader className="pb-2">
                  <Hint label={ACTION_HINT[lbl] ?? ""}>
                    <CardTitle className={`text-sm font-mono cursor-help ${labelTone(lbl)}`}>{lbl}</CardTitle>
                  </Hint>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Picks</span><span className="mono">{b.total}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Hit rate</span><span className="mono">{(hit * 100).toFixed(0)}%</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg return</span>
                    <span className={`mono ${avg >= 0 ? "text-bullish" : "text-bearish"}`}>{avg >= 0 ? "+" : ""}{avg.toFixed(2)}%</span>
                  </div>
                  {b.best && (
                    <div className="flex justify-between text-[11px] pt-1 border-t border-border/50">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-bullish" />Best</span>
                      <span className="mono">{b.best.symbol} <span className="text-bullish">+{b.best.ret.toFixed(1)}%</span></span>
                    </div>
                  )}
                  {b.worst && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3 text-bearish" />Worst</span>
                      <span className="mono">{b.worst.symbol} <span className="text-bearish">{b.worst.ret.toFixed(1)}%</span></span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Calibration chart ── */}
      {!noData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Score Calibration</CardTitle>
            <p className="text-xs text-muted-foreground">
              Avg realized {PRIMARY_WINDOW}d return by AI rank bucket. A well-calibrated AI shows monotonically rising bars.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={calibration} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} unit="%" />
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number, _n, p: any) => [`${v >= 0 ? "+" : ""}${v}% (n=${p?.payload?.count ?? 0})`, "avg return"]}
                  />
                  <Bar dataKey="avgReturn" radius={[4, 4, 0, 0]}>
                    {calibration.map((d) => (
                      <Cell key={d.label} fill={d.avgReturn >= 0 ? "hsl(var(--bullish))" : "hsl(var(--bearish))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Self-learning weights ── */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Self-Learning Weights
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Multipliers the ranker quietly applies to each label based on real-world outcomes.
            Clamped to <span className="mono">0.85–1.15</span> so one bad week can't destabilize the model.
          </p>
        </CardHeader>
        <CardContent>
          {weights.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {LABELS.map((lbl) => {
                const w = weights.find((x) => x.label === lbl);
                const mult = w?.multiplier ?? 1.0;
                const tone = mult > 1.01 ? "text-bullish" : mult < 0.99 ? "text-bearish" : "text-muted-foreground";
                return (
                  <div key={lbl} className="rounded-lg border border-border/60 p-3 bg-surface/40">
                    <div className={`text-xs font-mono ${labelTone(lbl)}`}>{lbl}</div>
                    <div className={`text-2xl font-bold mono ${tone}`}>×{mult.toFixed(3)}</div>
                    <div className="text-[10px] text-muted-foreground mt-1 leading-snug">
                      {w?.rationale ?? "No data yet."}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Recent evaluated picks ── */}
      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Evaluated Picks ({PRIMARY_WINDOW}d)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/60">
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Symbol</th>
                    <th className="text-left p-3">Label</th>
                    <th className="text-right p-3">Rank</th>
                    <th className="text-right p-3">Entry → Exit</th>
                    <th className="text-right p-3 pr-4">5d Return</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={`${r.id}-${i}`} className="border-b border-border/40 last:border-0">
                      <td className="p-3 mono text-[11px]">{r.snapshot_date}</td>
                      <td className="p-3 font-semibold mono">{r.symbol}</td>
                      <td className="p-3"><span className={`mono text-[11px] ${labelTone(r.label)}`}>{r.label}</span></td>
                      <td className="p-3 text-right mono">{r.final_rank}</td>
                      <td className="p-3 text-right mono text-[11px] text-muted-foreground">
                        ${Number(r.entry_price).toFixed(2)} → ${Number(r.exit_price).toFixed(2)}
                      </td>
                      <td className={`p-3 pr-4 text-right mono ${r.return_pct >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {r.return_pct >= 0 ? "+" : ""}{Number(r.return_pct).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, tone, loading }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "neutral"; loading?: boolean }) {
  const toneClass = tone === "good" ? "text-bullish" : tone === "bad" ? "text-bearish" : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="h-8 w-24 mt-2" />
        ) : (
          <div className={`text-2xl font-bold mono mt-1 ${toneClass}`}>{value}</div>
        )}
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
