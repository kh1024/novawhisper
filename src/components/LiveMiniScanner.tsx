// Live mini-scanner used on the /landing hero. Pulls real quotes via the same
// useLiveQuotes → computeSetups → rankSetup pipeline as /scanner, then shows
// the top 5 by Final Rank. Falls back to a skeleton while loading.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { useLiveQuotes } from "@/lib/liveData";
import { computeSetups } from "@/lib/setupScore";
import { selectStrategy } from "@/lib/strategySelector";
import { rankSetup } from "@/lib/finalRank";
import { useBudget } from "@/lib/budget";

export function LiveMiniScanner() {
  const query = useLiveQuotes(undefined, { refetchMs: 60_000 });
  const quotes = query.data;
  const loading = query.isLoading;
  const [budget] = useBudget();

  const rows = useMemo(() => {
    if (!quotes?.length) return [];
    const setups = computeSetups(quotes);
    return setups
      .map((s) => ({ s, rank: rankSetup(s, selectStrategy({ ...s, maxLossBudget: budget })) }))
      .sort((a, b) => b.rank.finalRank - a.rank.finalRank)
      .slice(0, 5);
  }, [quotes, budget]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="glass-card-elevated rounded-xl overflow-hidden shadow-elevated">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-surface/60">
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-bearish/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-bullish/70" />
          <span className="ml-3 mono text-muted-foreground">scan · final-rank · {today}</span>
        </div>
        <span className="pill pill-live"><span className="live-dot" /> live</span>
      </div>

      <div className="p-3 border-b border-border/60 bg-surface/30 flex flex-wrap gap-1.5">
        {["bias filter", "setup ≥ 60", "readiness", "options score", "penalties"].map((f) => (
          <span key={f} className="mono text-[10px] px-2 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary">
            {f}
          </span>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/60">
            <th className="text-left p-3">Sym</th>
            <th className="text-left p-3">Bias</th>
            <th className="text-right p-3">Price</th>
            <th className="text-right p-3">Setup</th>
            <th className="text-right p-3">Ready</th>
            <th className="text-right p-3 pr-4">Rank</th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0">
                <td colSpan={6} className="p-3">
                  <div className="h-5 rounded bg-surface/60 animate-pulse" />
                </td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> loading live setups…
              </td>
            </tr>
          ) : (
            rows.map(({ s, rank }) => {
              const tone =
                s.bias === "bullish" ? "pill-bullish" :
                s.bias === "bearish" ? "pill-bearish" : "pill-neutral";
              const rankTone =
                rank.label === "BUY NOW" ? "pill-bullish" :
                (rank.label === "AVOID" || rank.label === "EXIT") ? "pill-bearish" : "pill-neutral";
              return (
                <tr key={s.symbol} className="border-b border-border/40 last:border-0 hover:bg-surface/40 transition-colors">
                  <td className="p-3 font-semibold mono">{s.symbol}</td>
                  <td className="p-3"><span className={`pill ${tone}`}>{s.bias}</span></td>
                  <td className="p-3 text-right mono">${s.price.toFixed(2)}</td>
                  <td className="p-3 text-right mono">{s.setupScore}</td>
                  <td className="p-3 text-right mono">{rank.readinessScore}</td>
                  <td className="p-3 pr-4 text-right">
                    <span className={`pill ${rankTone}`}>{rank.label}</span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <div className="px-4 py-2.5 border-t border-border/60 bg-surface/40 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="mono">top 5 of {quotes?.length ?? 0} live tickers</span>
        <Link to="/scanner" className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors">
          open full scanner <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
