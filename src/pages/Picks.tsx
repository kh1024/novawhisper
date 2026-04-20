import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useLiveQuotes } from "@/lib/liveData";
import {
  Zap, RefreshCw, TrendingUp, TrendingDown, Sparkles, AlertTriangle,
  Target, Activity, Droplets, Flame, Calendar, ArrowUpRight, ArrowDownRight, Radio,
} from "lucide-react";

interface Pick {
  ticker: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  price: number;
  chg: number;
  expiry: string;
  strike: number;
  last: number;
  bid: number;
  ask: number;
  oi: number;
  iv: number;
  analystTarget: number | null;
  upsideToTarget: number | null;
  reasons: string;
}

interface PicksResponse {
  calls: Pick[];
  puts: Pick[];
  generatedAt: string;
  cached?: boolean;
}

const REFRESH_MS = 5 * 60_000;
type GradeFilter = "All" | "A" | "B" | "C";

function gradeClasses(g: Pick["grade"]) {
  switch (g) {
    case "A": return "bg-bullish/15 text-bullish border-bullish/40";
    case "B": return "bg-primary/15 text-primary border-primary/40";
    case "C": return "bg-warning/15 text-warning border-warning/40";
    case "D": return "bg-muted text-muted-foreground border-border";
    default:  return "bg-muted/50 text-muted-foreground border-border";
  }
}

function ivTone(ivPct: number) {
  if (ivPct < 60) return "text-bullish";
  if (ivPct <= 100) return "text-warning";
  return "text-bearish";
}

function fmt$(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

/** Compute the next session this batch is intended for (for daily next-day picks). */
function nextSessionLabel(generatedAt: string | undefined): string {
  if (!generatedAt) return "Next session";
  const d = new Date(generatedAt);
  // If generated after 4pm ET, target the *next* US trading day.
  // Simple heuristic: add 1 day, skip Sat/Sun.
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function reasonChips(reasons: string): string[] {
  if (!reasons) return [];
  return reasons.split("|").map((s) => s.trim()).filter(Boolean);
}

function PickRow({ pick, kind, onSelect, selected }: {
  pick: Pick; kind: "call" | "put"; onSelect: () => void; selected: boolean;
}) {
  const ivPct = pick.iv * 100;
  const chgPositive = pick.chg >= 0;
  const ChgIcon = chgPositive ? ArrowUpRight : ArrowDownRight;
  const tintRow = pick.grade === "A"
    ? (kind === "call" ? "bg-bullish/[0.04]" : "bg-bearish/[0.04]")
    : "";
  return (
    <TableRow
      className={cn(
        "cursor-pointer transition-colors",
        tintRow,
        selected && "bg-accent/40",
      )}
      onClick={onSelect}
    >
      <TableCell className="py-3">
        <Badge variant="outline" className={cn("font-mono font-bold w-7 h-6 justify-center px-0", gradeClasses(pick.grade))}>
          {pick.grade}
        </Badge>
      </TableCell>
      <TableCell className="font-mono font-bold text-primary py-3 sticky left-0 bg-card">
        {pick.ticker}
      </TableCell>
      <TableCell className="font-mono font-semibold text-primary py-3">{pick.score}</TableCell>
      <TableCell className="font-mono py-3">{fmt$(pick.price)}</TableCell>
      <TableCell className={cn("font-mono py-3 inline-flex items-center gap-0.5", chgPositive ? "text-bullish" : "text-bearish")}>
        <ChgIcon className="h-3 w-3" />
        {Math.abs(pick.chg).toFixed(1)}%
      </TableCell>
      <TableCell className="font-mono text-muted-foreground py-3">{pick.expiry}</TableCell>
      <TableCell className="font-mono py-3">${pick.strike}</TableCell>
      <TableCell className="font-mono py-3">{fmt$(pick.last)}</TableCell>
      <TableCell className="font-mono py-3 text-primary font-medium">{pick.oi.toLocaleString()}</TableCell>
      <TableCell className={cn("font-mono py-3 font-medium", ivTone(ivPct))}>{ivPct.toFixed(1)}%</TableCell>
      <TableCell className="font-mono py-3">{fmt$(pick.analystTarget)}</TableCell>
      <TableCell className={cn("font-mono py-3", pick.upsideToTarget == null ? "text-muted-foreground" : pick.upsideToTarget >= 0 ? "text-bullish" : "text-bearish")}>
        {pick.upsideToTarget == null ? "—" : `${pick.upsideToTarget >= 0 ? "+" : ""}${pick.upsideToTarget.toFixed(1)}%`}
      </TableCell>
    </TableRow>
  );
}

function PicksTable({ rows, kind, selectedIdx, onSelect }: {
  rows: Pick[]; kind: "call" | "put"; selectedIdx: number | null; onSelect: (i: number) => void;
}) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <ScrollArea className="w-full">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["Grade","Ticker","Score","Price","1D","Expiry","Strike","Last","OI","IV","Target","Upside"].map((h, i) => (
                <TableHead
                  key={h}
                  className={cn(
                    "text-[10px] uppercase tracking-wider text-muted-foreground/70 h-10",
                    i === 1 && "sticky left-0 bg-card",
                  )}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p, i) => (
              <PickRow
                key={`${p.ticker}-${p.expiry}-${p.strike}-${i}`}
                pick={p}
                kind={kind}
                selected={selectedIdx === i}
                onSelect={() => onSelect(i)}
              />
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function PickDetailCard({ pick, kind }: { pick: Pick; kind: "call" | "put" }) {
  const ivPct = pick.iv * 100;
  const cost = pick.ask > 0 ? pick.ask * 100 : pick.last > 0 ? pick.last * 100 : null;
  const chips = reasonChips(pick.reasons);
  const accent = kind === "call" ? "bullish" : "bearish";
  return (
    <Card className="overflow-hidden">
      <div className={cn("h-1 w-full", kind === "call" ? "bg-bullish" : "bg-bearish")} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-lg text-primary">{pick.ticker}</span>
              <Badge variant="outline" className={cn("font-mono font-bold", gradeClasses(pick.grade))}>
                Grade {pick.grade}
              </Badge>
              <Badge variant="outline" className={cn(
                "font-mono",
                kind === "call" ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish",
              )}>
                {kind === "call" ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                {kind.toUpperCase()}
              </Badge>
            </div>
            <CardTitle className="text-sm font-mono text-muted-foreground">
              ${pick.strike} {kind} · exp {pick.expiry}
            </CardTitle>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Score</div>
            <div className={cn("font-mono text-2xl font-bold", `text-${accent}`)}>{pick.score}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Spot" value={fmt$(pick.price)} sub={`${pick.chg >= 0 ? "+" : ""}${pick.chg.toFixed(1)}% 1D`} subTone={pick.chg >= 0 ? "bullish" : "bearish"} />
          <Stat label="Premium" value={fmt$(pick.ask || pick.last)} sub={cost ? `${fmt$(cost / 100)} × 100 = ${fmt$(cost)}` : "—"} />
          <Stat label="Open Int" value={pick.oi.toLocaleString()} sub={pick.oi >= 20000 ? "Deep liquidity" : pick.oi >= 5000 ? "Liquid" : "Thin"} />
          <Stat label="IV" value={`${ivPct.toFixed(1)}%`} sub={ivPct < 60 ? "Sweet spot" : ivPct <= 100 ? "Elevated" : "Crushed risk"} subTone={ivPct < 60 ? "bullish" : ivPct <= 100 ? "warning" : "bearish"} />
        </div>

        {/* Analyst target */}
        {pick.analystTarget != null && (
          <div className="rounded-md border bg-surface/50 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Analyst target</span>
              <span className="font-mono font-semibold">{fmt$(pick.analystTarget)}</span>
            </div>
            {pick.upsideToTarget != null && (
              <Badge variant="outline" className={cn("font-mono", pick.upsideToTarget >= 0 ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish")}>
                {pick.upsideToTarget >= 0 ? "+" : ""}{pick.upsideToTarget.toFixed(1)}%
              </Badge>
            )}
          </div>
        )}

        {/* Why this pick chips */}
        {chips.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Why this pick
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c, i) => (
                <Badge key={i} variant="outline" className="text-[11px] font-normal border-primary/30 bg-primary/5">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, subTone }: {
  label: string; value: string; sub?: string;
  subTone?: "bullish" | "bearish" | "warning";
}) {
  const subClass = subTone === "bullish" ? "text-bullish" : subTone === "bearish" ? "text-bearish" : subTone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="rounded-md border bg-surface/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold text-sm mt-0.5">{value}</div>
      {sub && <div className={cn("text-[10px] font-mono mt-0.5", subClass)}>{sub}</div>}
    </div>
  );
}

function SummaryCard({ label, icon: Icon, children }: {
  label: string; icon: typeof Zap; children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <div className="mt-2 flex items-center gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}

function Section({
  side, rows, gradeFilter, onGradeFilter,
}: {
  side: "call" | "put";
  rows: Pick[];
  gradeFilter: GradeFilter;
  onGradeFilter: (g: GradeFilter) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(rows.length ? 0 : null);
  const filtered = useMemo(
    () => gradeFilter === "All" ? rows : rows.filter((r) => r.grade === gradeFilter),
    [rows, gradeFilter],
  );
  useEffect(() => {
    setSelectedIdx(filtered.length ? 0 : null);
  }, [filtered.length, side]);

  const accentBg = side === "call" ? "bg-bullish/10 border-bullish/30" : "bg-bearish/10 border-bearish/30";
  const Icon = side === "call" ? TrendingUp : TrendingDown;
  const title = side === "call" ? "Top Call Picks" : "Top Put Picks";

  return (
    <div className="space-y-3">
      <div className={cn("rounded-lg border px-4 py-2.5 flex items-center justify-between", accentBg)}>
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", side === "call" ? "text-bullish" : "text-bearish")} />
          <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
          <Badge variant="outline" className="font-mono text-[10px]">{rows.length}</Badge>
        </div>
        <Tabs value={gradeFilter} onValueChange={(v) => onGradeFilter(v as GradeFilter)}>
          <TabsList className="h-7">
            {(["All","A","B","C"] as const).map((g) => (
              <TabsTrigger key={g} value={g} className="text-xs h-6 px-2.5">{g}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No picks match the {gradeFilter} filter.
            </Card>
          ) : (
            <PicksTable rows={filtered} kind={side} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />
          )}
        </div>
        <div>
          {selectedIdx != null && filtered[selectedIdx] && (
            <PickDetailCard pick={filtered[selectedIdx]} kind={side} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function Picks() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callFilter, setCallFilter] = useState<GradeFilter>("All");
  const [putFilter, setPutFilter] = useState<GradeFilter>("All");
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async (force = false) => {
    setError(null);
    setLoading((prev) => (data ? prev : true));
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const url = `https://${projectId}.functions.supabase.co/picks-engine${force ? "?refresh=1" : ""}`;
      const r = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${anon}`, apikey: anon },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = (await r.json()) as PicksResponse;
      if (!payload || !Array.isArray(payload.calls)) throw new Error("Invalid response");
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load picks");
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    load();
    timerRef.current = window.setInterval(() => load(false), REFRESH_MS);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    return {
      topCall: data.calls[0] ?? null,
      topPut: data.puts[0] ?? null,
      aCalls: data.calls.filter((p) => p.grade === "A").length,
      aPuts: data.puts.filter((p) => p.grade === "A").length,
    };
  }, [data]);

  const targetSession = nextSessionLabel(data?.generatedAt);
  const generatedLabel = data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : null;

  return (
    <TooltipProvider>
      <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-gradient-primary shadow-primary-glow flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Online Picks</h1>
              <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
                Daily · 38 tickers · 6-signal
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />
              Picks for <span className="font-medium text-foreground">{targetSession}</span>
              {data?.cached && <Badge variant="outline" className="text-[10px] ml-1">Cached</Badge>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Generated</div>
              <div className="font-mono">{generatedLabel ?? (loading ? <Skeleton className="h-3 w-32" /> : "—")}</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading} className="gap-1.5">
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  Refresh
                </Button>
              </TooltipTrigger>
              <TooltipContent>Force a re-scan now (auto-runs daily after close)</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {error && (
          <Card className="border-bearish/40 bg-bearish/5 p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-bearish" />
            <span className="text-sm text-bearish flex-1">{error}</span>
            <Button variant="ghost" size="sm" onClick={() => load(true)}>Retry</Button>
          </Card>
        )}

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Top Call" icon={TrendingUp}>
            {summary?.topCall ? (
              <>
                <span className="font-mono font-bold text-primary">{summary.topCall.ticker}</span>
                <Badge variant="outline" className={cn("font-mono", gradeClasses(summary.topCall.grade))}>{summary.topCall.grade}</Badge>
                <span className="font-mono text-xs text-muted-foreground ml-auto">${summary.topCall.strike}</span>
              </>
            ) : <Skeleton className="h-5 w-24" />}
          </SummaryCard>
          <SummaryCard label="Top Put" icon={TrendingDown}>
            {summary?.topPut ? (
              <>
                <span className="font-mono font-bold text-primary">{summary.topPut.ticker}</span>
                <Badge variant="outline" className={cn("font-mono", gradeClasses(summary.topPut.grade))}>{summary.topPut.grade}</Badge>
                <span className="font-mono text-xs text-muted-foreground ml-auto">${summary.topPut.strike}</span>
              </>
            ) : <Skeleton className="h-5 w-24" />}
          </SummaryCard>
          <SummaryCard label="Grade A Calls" icon={Flame}>
            {summary ? <span className="font-mono text-xl font-bold text-bullish">{summary.aCalls}</span> : <Skeleton className="h-5 w-8" />}
          </SummaryCard>
          <SummaryCard label="Grade A Puts" icon={Droplets}>
            {summary ? <span className="font-mono text-xl font-bold text-bearish">{summary.aPuts}</span> : <Skeleton className="h-5 w-8" />}
          </SummaryCard>
        </div>

        {/* Body: tabs for Calls / Puts so it stays clean on mobile */}
        {loading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : data ? (
          <Tabs defaultValue="calls" className="space-y-4">
            <TabsList>
              <TabsTrigger value="calls" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Calls
                <Badge variant="outline" className="ml-1 font-mono text-[10px]">{data.calls.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="puts" className="gap-1.5">
                <TrendingDown className="h-3.5 w-3.5" /> Puts
                <Badge variant="outline" className="ml-1 font-mono text-[10px]">{data.puts.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="both" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Both
              </TabsTrigger>
            </TabsList>
            <TabsContent value="calls"><Section side="call" rows={data.calls} gradeFilter={callFilter} onGradeFilter={setCallFilter} /></TabsContent>
            <TabsContent value="puts"><Section side="put" rows={data.puts} gradeFilter={putFilter} onGradeFilter={setPutFilter} /></TabsContent>
            <TabsContent value="both" className="space-y-6">
              <Section side="call" rows={data.calls} gradeFilter={callFilter} onGradeFilter={setCallFilter} />
              <Section side="put" rows={data.puts} gradeFilter={putFilter} onGradeFilter={setPutFilter} />
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="p-12 text-center text-sm text-muted-foreground">
            No picks yet — click Refresh.
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
}
