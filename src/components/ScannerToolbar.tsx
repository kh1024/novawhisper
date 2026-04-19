// Trading-desk style filter toolbar for the Market Scanner.
// Replaces the old loose filter card with:
//   • a single sticky bar (search · sector · bias · readiness segmented)
//   • a "More filters" popover for the numeric ranges
//   • active-filter chips so users see (and can clear) every applied filter
// Pure presentational — wires into the same `filters` state in Scanner.tsx.
import { useMemo } from "react";
import { Search, SlidersHorizontal, RotateCcw, X, TrendingUp, TrendingDown, Minus, RotateCcw as Reversal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Bias, Readiness } from "@/lib/setupScore";

export interface ScannerFilters {
  search: string;
  sector: string;
  bias: "all" | Bias;
  readiness: "all" | Readiness;
  minScore: number[];
  minRelVol: number[];
  ivrRange: number[];
  rsiRange: number[];
  changeRange: number[];
  minOptionsLiq: number[];
  excludeEarnings: boolean;
  weeklyOnly: boolean;
  hideAvoid: boolean;
}

interface Props {
  filters: ScannerFilters;
  defaults: ScannerFilters;
  onChange: (next: ScannerFilters) => void;
  sectors: string[];
  matchCount: number;
  totalCount: number;
}

const BIAS_SEG: { v: "all" | Bias; label: string; Icon: any; cls: string }[] = [
  { v: "all", label: "All", Icon: Minus, cls: "" },
  { v: "bullish", label: "Bull", Icon: TrendingUp, cls: "data-[active=true]:bg-bullish/15 data-[active=true]:text-bullish data-[active=true]:border-bullish/50" },
  { v: "bearish", label: "Bear", Icon: TrendingDown, cls: "data-[active=true]:bg-bearish/15 data-[active=true]:text-bearish data-[active=true]:border-bearish/50" },
  { v: "neutral", label: "Range", Icon: Minus, cls: "" },
  { v: "reversal", label: "Rev", Icon: Reversal, cls: "" },
];

const READY_SEG: { v: "all" | Readiness; label: string; cls: string }[] = [
  { v: "all", label: "Any", cls: "" },
  { v: "NOW", label: "NOW", cls: "data-[active=true]:bg-bullish/15 data-[active=true]:text-bullish data-[active=true]:border-bullish/50" },
  { v: "WAIT", label: "WAIT", cls: "data-[active=true]:bg-warning/15 data-[active=true]:text-warning data-[active=true]:border-warning/50" },
  { v: "AVOID", label: "AVOID", cls: "data-[active=true]:bg-bearish/15 data-[active=true]:text-bearish data-[active=true]:border-bearish/50" },
];

function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string; Icon?: any; cls?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface/40 p-0.5">
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            data-active={active}
            onClick={() => onChange(o.v)}
            className={cn(
              "px-2.5 h-7 inline-flex items-center gap-1 rounded-[5px] text-[11px] font-semibold tracking-wide border border-transparent transition-colors",
              "text-muted-foreground hover:text-foreground",
              "data-[active=true]:bg-foreground/10 data-[active=true]:text-foreground data-[active=true]:border-border",
              o.cls,
            )}
          >
            {o.Icon && <o.Icon className="h-3 w-3" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ScannerToolbar({ filters, defaults, onChange, sectors, matchCount, totalCount }: Props) {
  const set = <K extends keyof ScannerFilters>(k: K, v: ScannerFilters[K]) =>
    onChange({ ...filters, [k]: v });

  // Build a list of active-filter chips so users can see + remove each one.
  const activeChips = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    if (filters.search) out.push({ key: "search", label: `"${filters.search}"`, clear: () => set("search", "") });
    if (filters.sector !== "all") out.push({ key: "sector", label: filters.sector, clear: () => set("sector", "all") });
    if (filters.bias !== "all") out.push({ key: "bias", label: `Bias: ${filters.bias}`, clear: () => set("bias", "all") });
    if (filters.readiness !== "all") out.push({ key: "ready", label: filters.readiness, clear: () => set("readiness", "all") });
    if (filters.minScore[0] > defaults.minScore[0]) out.push({ key: "score", label: `Score ≥ ${filters.minScore[0]}`, clear: () => set("minScore", defaults.minScore) });
    if (filters.minRelVol[0] > defaults.minRelVol[0]) out.push({ key: "rv", label: `RV ≥ ${filters.minRelVol[0].toFixed(1)}×`, clear: () => set("minRelVol", defaults.minRelVol) });
    if (filters.minOptionsLiq[0] > defaults.minOptionsLiq[0]) out.push({ key: "liq", label: `Opt liq ≥ ${filters.minOptionsLiq[0]}`, clear: () => set("minOptionsLiq", defaults.minOptionsLiq) });
    if (filters.ivrRange[0] !== defaults.ivrRange[0] || filters.ivrRange[1] !== defaults.ivrRange[1])
      out.push({ key: "ivr", label: `IVR ${filters.ivrRange[0]}–${filters.ivrRange[1]}`, clear: () => set("ivrRange", defaults.ivrRange) });
    if (filters.rsiRange[0] !== defaults.rsiRange[0] || filters.rsiRange[1] !== defaults.rsiRange[1])
      out.push({ key: "rsi", label: `RSI ${filters.rsiRange[0]}–${filters.rsiRange[1]}`, clear: () => set("rsiRange", defaults.rsiRange) });
    if (filters.changeRange[0] !== defaults.changeRange[0] || filters.changeRange[1] !== defaults.changeRange[1])
      out.push({ key: "chg", label: `Chg ${filters.changeRange[0]}%–${filters.changeRange[1]}%`, clear: () => set("changeRange", defaults.changeRange) });
    if (filters.excludeEarnings) out.push({ key: "ern", label: "No earnings ≤7d", clear: () => set("excludeEarnings", false) });
    if (filters.hideAvoid) out.push({ key: "av", label: "Hide AVOID", clear: () => set("hideAvoid", false) });
    return out;
  }, [filters, defaults]);

  const advancedActive = activeChips.filter((c) =>
    ["score", "rv", "liq", "ivr", "rsi", "chg", "ern", "av"].includes(c.key),
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Primary bar */}
      <div className="flex items-center gap-2 p-2.5 border-b border-border/60 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Ticker or name…"
            value={filters.search}
            onChange={(e) => set("search", e.target.value.toUpperCase())}
            className="h-9 pl-8 bg-background border-border text-sm"
          />
        </div>

        <Select value={filters.sector} onValueChange={(v) => set("sector", v)}>
          <SelectTrigger className="h-9 w-[150px] bg-background text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sectors.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All sectors" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Seg options={BIAS_SEG} value={filters.bias} onChange={(v) => set("bias", v)} />
        <Seg options={READY_SEG} value={filters.readiness} onChange={(v) => set("readiness", v)} />

        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px] border-border">
            {matchCount} <span className="text-muted-foreground">/ {totalCount}</span>
          </Badge>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                More
                {advancedActive > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {advancedActive}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[360px] p-4 space-y-4">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Advanced filters
              </div>
              <Range label="Min Setup Score" v={filters.minScore} onChange={(v) => set("minScore", v)} min={0} max={100} display={`${filters.minScore[0]}+`} />
              <Range label="Min Relative Volume" v={filters.minRelVol} onChange={(v) => set("minRelVol", v)} min={0} max={5} step={0.1} display={`${filters.minRelVol[0].toFixed(1)}×`} />
              <Range label="Min Options Liquidity" v={filters.minOptionsLiq} onChange={(v) => set("minOptionsLiq", v)} min={0} max={100} display={`${filters.minOptionsLiq[0]}+`} />
              <Range label="IV Rank" v={filters.ivrRange} onChange={(v) => set("ivrRange", v)} min={0} max={100} display={`${filters.ivrRange[0]}–${filters.ivrRange[1]}`} />
              <Range label="RSI" v={filters.rsiRange} onChange={(v) => set("rsiRange", v)} min={0} max={100} display={`${filters.rsiRange[0]}–${filters.rsiRange[1]}`} />
              <Range label="Daily % change" v={filters.changeRange} onChange={(v) => set("changeRange", v)} min={-15} max={15} step={0.5} display={`${filters.changeRange[0]}% to ${filters.changeRange[1]}%`} />

              <div className="space-y-2 pt-2 border-t border-border/60">
                <ToggleRow label="Exclude earnings ≤ 7d" checked={filters.excludeEarnings} onChange={(v) => set("excludeEarnings", v)} />
                <ToggleRow label="Hide AVOID rows" checked={filters.hideAvoid} onChange={(v) => set("hideAvoid", v)} />
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(defaults)}
            className="h-9 gap-1.5 text-xs"
            disabled={activeChips.length === 0}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </Button>
        </div>
      </div>

      {/* Active chips row */}
      {activeChips.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-2 flex-wrap bg-surface/30">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Active:</span>
          {activeChips.map((c) => (
            <button
              key={c.key}
              onClick={c.clear}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-primary/40 bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 transition-colors"
            >
              {c.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Range({ label, v, onChange, min, max, step = 1, display }: {
  label: string; v: number[]; onChange: (v: number[]) => void;
  min: number; max: number; step?: number; display: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="mono text-foreground font-semibold">{display}</span>
      </div>
      <Slider min={min} max={max} step={step} value={v} onValueChange={onChange} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer text-xs py-1">
      <span className="text-foreground/90">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
