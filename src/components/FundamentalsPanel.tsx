// Fundamentals panel — Yahoo Finance data via fundamentals-fetch.
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, TrendingDown, Building2, Globe, Users } from "lucide-react";
import { useFundamentals, fmtBig, fmtPct, fmtNum } from "@/lib/fundamentals";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string | null;
  spotPrice?: number | null;
}

export function FundamentalsPanel({ symbol, spotPrice }: Props) {
  const { data, isLoading, error } = useFundamentals(symbol);

  if (!symbol) return null;
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <Card className="glass-card p-4 border-warning/40 bg-warning/5">
        <div className="flex items-start gap-2 text-warning text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Fundamentals unavailable</div>
            <div className="text-warning/80 mt-0.5">
              {error instanceof Error ? error.message : "Yahoo didn't return data for this ticker."}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // 52w range positioning
  const range52 = data.week52High != null && data.week52Low != null && spotPrice != null
    ? Math.max(0, Math.min(100, ((spotPrice - data.week52Low) / (data.week52High - data.week52Low)) * 100))
    : null;

  // Analyst target vs current
  const targetUpside = data.targetMeanPrice != null && spotPrice && spotPrice > 0
    ? ((data.targetMeanPrice - spotPrice) / spotPrice) * 100
    : null;

  const recBadge = recommendationBadge(data.recommendationKey);

  return (
    <div className="space-y-3">
      {/* Profile */}
      {(data.sector || data.industry || data.summary) && (
        <Card className="glass-card p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" /> Company
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.sector && <Badge variant="outline" className="text-[10px]">{data.sector}</Badge>}
            {data.industry && <Badge variant="outline" className="text-[10px]">{data.industry}</Badge>}
            {data.country && <Badge variant="outline" className="text-[10px]">{data.country}</Badge>}
            {data.employees != null && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Users className="h-2.5 w-2.5" /> {fmtBig(data.employees)} emp.
              </Badge>
            )}
            {data.website && (
              <a href={data.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                <Globe className="h-2.5 w-2.5" /> Website
              </a>
            )}
          </div>
          {data.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{data.summary}</p>
          )}
        </Card>
      )}

      {/* Key stats grid */}
      <Card className="glass-card p-4 space-y-3">
        <div className="text-sm font-medium">Valuation & size</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Market cap" value={data.marketCap != null ? `$${fmtBig(data.marketCap)}` : "—"} />
          <Stat label="P/E (TTM)" value={fmtNum(data.peTrailing)} />
          <Stat label="P/E (fwd)" value={fmtNum(data.peForward)} />
          <Stat label="PEG" value={fmtNum(data.pegRatio)} />
          <Stat label="P/B" value={fmtNum(data.priceToBook)} />
          <Stat label="P/S" value={fmtNum(data.priceToSales)} />
          <Stat label="EPS (TTM)" value={data.epsTrailing != null ? `$${fmtNum(data.epsTrailing)}` : "—"} />
          <Stat label="EPS (fwd)" value={data.epsForward != null ? `$${fmtNum(data.epsForward)}` : "—"} />
          <Stat label="Beta" value={fmtNum(data.beta)} />
          <Stat
            label="Div yield"
            value={data.dividendYield != null ? fmtPct(data.dividendYield) : "—"}
            tone={data.dividendYield && data.dividendYield > 0.03 ? "good" : undefined}
          />
          <Stat label="Float" value={data.floatShares != null ? fmtBig(data.floatShares) : "—"} />
          <Stat label="Avg vol" value={data.avgVolume != null ? fmtBig(data.avgVolume) : "—"} />
        </div>
      </Card>

      {/* 52w range */}
      {range52 != null && (
        <Card className="glass-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">52-week range</span>
            <span className="mono text-xs text-muted-foreground">
              ${fmtNum(data.week52Low)} – ${fmtNum(data.week52High)}
            </span>
          </div>
          <div className="relative h-2 bg-surface rounded-full">
            <div
              className="absolute h-full w-2 bg-primary rounded-full -translate-x-1/2"
              style={{ left: `${range52}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mono">
            <span>Low</span>
            <span className="text-foreground">${fmtNum(spotPrice ?? null)}</span>
            <span>High</span>
          </div>
        </Card>
      )}

      {/* Analyst consensus */}
      {(data.targetMeanPrice != null || data.recommendationKey) && (
        <Card className="glass-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Wall St consensus</span>
            {recBadge && (
              <Badge className={cn("text-[10px] capitalize", recBadge.cls)}>{recBadge.label}</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Low" value={data.targetLowPrice != null ? `$${fmtNum(data.targetLowPrice)}` : "—"} />
            <Stat
              label="Target"
              value={data.targetMeanPrice != null ? `$${fmtNum(data.targetMeanPrice)}` : "—"}
              tone="primary"
            />
            <Stat label="High" value={data.targetHighPrice != null ? `$${fmtNum(data.targetHighPrice)}` : "—"} />
          </div>
          {targetUpside != null && (
            <div className={cn(
              "text-xs mono flex items-center gap-1.5",
              targetUpside >= 0 ? "text-bullish" : "text-bearish"
            )}>
              {targetUpside >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {targetUpside >= 0 ? "+" : ""}{targetUpside.toFixed(1)}% to target
              {data.numberOfAnalystOpinions != null && (
                <span className="text-muted-foreground ml-auto">
                  {data.numberOfAnalystOpinions} analyst{data.numberOfAnalystOpinions === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Profitability + balance sheet */}
      <Card className="glass-card p-4 space-y-3">
        <div className="text-sm font-medium">Profitability & growth</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Profit margin" value={fmtPct(data.profitMargins)} tone={signTone(data.profitMargins)} />
          <Stat label="Op. margin" value={fmtPct(data.operatingMargins)} tone={signTone(data.operatingMargins)} />
          <Stat label="ROE" value={fmtPct(data.returnOnEquity)} tone={signTone(data.returnOnEquity)} />
          <Stat label="Rev. growth" value={fmtPct(data.revenueGrowth)} tone={signTone(data.revenueGrowth)} />
          <Stat label="EPS growth" value={fmtPct(data.earningsGrowth)} tone={signTone(data.earningsGrowth)} />
          <Stat label="D/E" value={fmtNum(data.debtToEquity)} />
          <Stat label="Cash" value={data.totalCash != null ? `$${fmtBig(data.totalCash)}` : "—"} />
          <Stat label="Debt" value={data.totalDebt != null ? `$${fmtBig(data.totalDebt)}` : "—"} />
          <Stat label="Current ratio" value={fmtNum(data.currentRatio)} />
        </div>
      </Card>

      <div className="text-[10px] text-muted-foreground text-right">
        Source: Yahoo Finance · cached 6h
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "primary" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "mono text-sm font-semibold mt-0.5",
        tone === "good" && "text-bullish",
        tone === "bad" && "text-bearish",
        tone === "primary" && "text-primary",
      )}>
        {value}
      </div>
    </div>
  );
}

function signTone(n: number | null): "good" | "bad" | undefined {
  if (n == null) return undefined;
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return undefined;
}

function recommendationBadge(key: string | null) {
  if (!key) return null;
  const k = key.toLowerCase();
  if (k === "strong_buy" || k === "buy") {
    return { label: k.replace("_", " "), cls: "bg-bullish/15 text-bullish border-bullish/40" };
  }
  if (k === "hold") return { label: "hold", cls: "bg-warning/15 text-warning border-warning/40" };
  if (k === "sell" || k === "strong_sell" || k === "underperform") {
    return { label: k.replace("_", " "), cls: "bg-bearish/15 text-bearish border-bearish/40" };
  }
  return { label: k.replace("_", " "), cls: "bg-surface text-muted-foreground border-border" };
}
