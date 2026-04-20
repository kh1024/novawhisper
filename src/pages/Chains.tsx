import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, RefreshCw } from "lucide-react";
import { useOptionsChain, useLiveQuotes, type OptionContract } from "@/lib/liveData";
import { TICKER_UNIVERSE } from "@/lib/mockData";
import { ResearchDrawer } from "@/components/ResearchDrawer";
import { PreMarketPreviewBanner } from "@/components/PreMarketPreviewBanner";

const POPULAR = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT", "AMD", "META"];

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toFixed(d);
}

export default function Chains() {
  const [underlying, setUnderlying] = useState("AAPL");
  const [search, setSearch] = useState("");
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, error } = useOptionsChain(underlying, 250);
  const { data: quotes = [] } = useLiveQuotes([underlying], { refetchMs: 60_000 });
  const spot = quotes[0]?.price ?? null;

  const contracts = data?.contracts ?? [];
  const expirations = useMemo(
    () => Array.from(new Set(contracts.map((c) => c.expiration))).sort(),
    [contracts]
  );
  const [expiration, setExpiration] = useState<string | null>(null);
  const activeExp = expiration ?? expirations[0] ?? null;

  // Build strike ladder: for each strike, calls + puts side-by-side
  const ladder = useMemo(() => {
    const filtered = contracts.filter((c) => c.expiration === activeExp);
    const byStrike = new Map<number, { call?: OptionContract; put?: OptionContract }>();
    filtered.forEach((c) => {
      const row = byStrike.get(c.strike) ?? {};
      row[c.type] = c;
      byStrike.set(c.strike, row);
    });
    return Array.from(byStrike.entries())
      .sort(([a], [b]) => a - b)
      .map(([strike, row]) => ({ strike, ...row }));
  }, [contracts, activeExp]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = search.trim().toUpperCase();
    if (v) {
      setUnderlying(v);
      setSearch("");
      setExpiration(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Option Chains</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live chains via Massive · spot{" "}
            <span className="mono text-foreground">${spot ? spot.toFixed(2) : "—"}</span> · {contracts.length} contracts loaded
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={submitSearch} className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Underlying…"
              className="pl-9 w-44 bg-surface/60"
            />
          </form>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {POPULAR.map((sym) => {
          const meta = TICKER_UNIVERSE.find((u) => u.symbol === sym);
          const active = sym === underlying;
          return (
            <button
              key={sym}
              onClick={() => { setUnderlying(sym); setExpiration(null); }}
              className={`pill ${active ? "pill-bullish" : "pill-neutral"} cursor-pointer`}
              title={meta?.name}
            >
              {sym}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <Card className="glass-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {underlying} chain…
        </Card>
      )}

      {error && (
        <Card className="glass-card p-6 text-sm text-bearish">
          Failed to load chain for {underlying}. {(error as Error).message}
        </Card>
      )}

      {!isLoading && contracts.length === 0 && !error && (
        <Card className="glass-card p-6 text-sm text-muted-foreground">
          No contracts returned for {underlying}.
        </Card>
      )}

      {expirations.length > 0 && (
        <Tabs value={activeExp ?? ""} onValueChange={setExpiration}>
          <TabsList className="bg-surface/60 h-9 flex-wrap">
            {expirations.slice(0, 12).map((exp) => {
              const dte = contracts.find((c) => c.expiration === exp)?.dte ?? 0;
              return (
                <TabsTrigger key={exp} value={exp} className="h-7 text-xs">
                  <span className="mono">{exp.slice(5)}</span>
                  <span className="text-muted-foreground ml-1.5">{dte}d</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      {ladder.length > 0 && (
        <Card className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th colSpan={6} className="text-center px-3 py-2 font-medium border-r border-border/60 text-bullish">
                    CALLS
                  </th>
                  <th className="text-center px-3 py-2 font-medium bg-surface">STRIKE</th>
                  <th colSpan={6} className="text-center px-3 py-2 font-medium border-l border-border/60 text-bearish">
                    PUTS
                  </th>
                </tr>
                <tr>
                  {["OI", "Vol", "IV", "Δ", "Bid", "Ask"].map((h) => (
                    <th key={`c-${h}`} className="text-right px-2 py-1.5 font-medium">{h}</th>
                  ))}
                  <th className="text-center px-3 py-1.5 bg-surface mono">$</th>
                  {["Bid", "Ask", "Δ", "IV", "Vol", "OI"].map((h) => (
                    <th key={`p-${h}`} className="text-left px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ladder.map(({ strike, call, put }) => {
                  const itm = spot ? strike < spot : false;
                  return (
                    <tr key={strike} className="border-t border-border/60 hover:bg-surface/40 transition-colors">
                      {/* CALLS */}
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{fmt(call?.openInterest, 0)}</td>
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{fmt(call?.volume, 0)}</td>
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{call?.iv ? (call.iv * 100).toFixed(1) + "%" : "—"}</td>
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{fmt(call?.delta, 2)}</td>
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{fmt(call?.bid, 2)}</td>
                      <td className={`px-2 py-2 text-right mono ${call && itm ? "bg-bullish/5" : ""}`}>{fmt(call?.ask, 2)}</td>

                      {/* STRIKE */}
                      <td className="px-3 py-2 text-center mono font-semibold bg-surface/80 border-x border-border">
                        {strike}
                      </td>

                      {/* PUTS */}
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{fmt(put?.bid, 2)}</td>
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{fmt(put?.ask, 2)}</td>
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{fmt(put?.delta, 2)}</td>
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{put?.iv ? (put.iv * 100).toFixed(1) + "%" : "—"}</td>
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{fmt(put?.volume, 0)}</td>
                      <td className={`px-2 py-2 text-left mono ${put && !itm ? "bg-bearish/5" : ""}`}>{fmt(put?.openInterest, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-border/60 text-[10px] text-muted-foreground flex items-center justify-between">
            <span>ITM cells highlighted · {ladder.length} strikes</span>
            <button onClick={() => setOpenSymbol(underlying)} className="text-primary hover:underline">
              Research {underlying} →
            </button>
          </div>
        </Card>
      )}

      <ResearchDrawer symbol={openSymbol} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
