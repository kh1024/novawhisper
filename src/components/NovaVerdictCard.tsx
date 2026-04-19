// Big, glanceable Nova verdict — designed so the user never has to read prose.
// Shows: huge action label (BUY / WAIT / SKIP), one contract OR a skip reason,
// stop price, and tiny meta chips. Long analysis is hidden behind a toggle.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ShieldX, LayoutList } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Sparkline } from "@/components/Sparkline";
import { computeRSI14 } from "@/lib/streak";

export interface NovaCard {
  verdict: "GOOD SETUP" | "POSSIBLE BUT EARLY" | "SPECULATIVE" | "LOW-QUALITY IDEA" | "NO TRADE";
  action: "BUY" | "WAIT" | "SKIP";
  one_line_reason: string;
  data_quality: "PASS" | "PARTIAL" | "FAIL";
  fit_score: number;
  confidence: "Low" | "Medium" | "High";
  best_contract?: {
    type: "call" | "put";
    strike: number;
    expiry: string;
    mid: number;
    cost_per_contract_usd: number;
    stop_price?: number | null;
    max_size_contracts?: number;
  } | null;
  better_structure?: string | null;
  full_analysis_md?: string;
}

const ACTION_STYLES: Record<NovaCard["action"], { bg: string; text: string; ring: string; emoji: string }> = {
  BUY:  { bg: "bg-bullish/15", text: "text-bullish", ring: "ring-bullish/40", emoji: "✅" },
  WAIT: { bg: "bg-yellow-500/15", text: "text-yellow-400", ring: "ring-yellow-500/40", emoji: "⏳" },
  SKIP: { bg: "bg-bearish/15", text: "text-bearish", ring: "ring-bearish/40", emoji: "🚫" },
};

const DATA_ICON = {
  PASS:    <ShieldCheck className="h-3 w-3" />,
  PARTIAL: <ShieldAlert className="h-3 w-3" />,
  FAIL:    <ShieldX className="h-3 w-3" />,
};

export function NovaVerdictCard({
  card,
  closes,
}: {
  card: NovaCard;
  /** Optional recent daily closes — last 20 are used for a tiny trend sparkline. */
  closes?: number[];
}) {
  const [showFull, setShowFull] = useState(false);
  const [sparkMode, setSparkMode] = useState<"price" | "rsi">("price");
  const style = ACTION_STYLES[card.action];
  const c = card.best_contract;

  // Last 20 closes for the sparkline (price mode) and a 14-step RSI walk (rsi mode).
  const priceTail = closes && closes.length >= 2 ? closes.slice(-20) : null;
  const rsiSeries =
    closes && closes.length >= 16
      ? Array.from({ length: Math.min(20, closes.length - 14) }, (_, i) => {
          const end = closes.length - (Math.min(20, closes.length - 14) - 1 - i);
          return computeRSI14(closes.slice(0, end));
        })
      : null;
  const sparkValues = sparkMode === "rsi" ? rsiSeries : priceTail;

  return (
    <Card className={`glass-card p-5 ring-1 ${style.ring}`}>
      {/* Hero: action label */}
      <div className={`rounded-lg ${style.bg} p-4 text-center`}>
        <div className={`text-4xl font-bold tracking-tight ${style.text} flex items-center justify-center gap-2`}>
          <span aria-hidden>{style.emoji}</span>
          {card.action}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
          {card.verdict}
        </div>
        <div className="mt-2 text-sm text-foreground/90 max-w-md mx-auto">
          {card.one_line_reason}
        </div>
        {sparkValues && sparkValues.length >= 2 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <Sparkline
              values={sparkValues}
              width={120}
              height={28}
              domain={sparkMode === "rsi" ? [0, 100] : undefined}
              refs={sparkMode === "rsi" ? [30, 70] : undefined}
              ariaLabel={sparkMode === "rsi" ? "RSI(14) sparkline" : "Recent close sparkline"}
            />
            <button
              type="button"
              onClick={() => setSparkMode((m) => (m === "price" ? "rsi" : "price"))}
              aria-label={`Switch sparkline to ${sparkMode === "price" ? "RSI" : "Price"}`}
              title={`Switch to ${sparkMode === "price" ? "RSI" : "Price"}`}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border transition-colors min-h-[24px]"
            >
              <span className={sparkMode === "price" ? "text-foreground" : ""}>Price</span>
              <span className="text-muted-foreground/50">/</span>
              <span className={sparkMode === "rsi" ? "text-foreground" : ""}>RSI</span>
            </button>
          </div>
        )}
      </div>

      {/* The single play (or no-trade reason) */}
      {card.action !== "SKIP" && c ? (
        <div className="mt-4 rounded-lg border border-border bg-surface/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            The play
          </div>
          <div className="mt-1 font-mono text-base font-semibold">
            {c.type.toUpperCase()} ${c.strike} · exp {c.expiry}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Cost</div>
              <div className="mono text-sm font-semibold">${c.cost_per_contract_usd.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Stop</div>
              <div className="mono text-sm font-semibold">
                {c.stop_price != null ? `$${c.stop_price.toFixed(2)}` : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Max size</div>
              <div className="mono text-sm font-semibold">
                {c.max_size_contracts != null ? `${c.max_size_contracts}x` : "—"}
              </div>
            </div>
          </div>
        </div>
      ) : card.action === "SKIP" ? (
        <div className="mt-4 rounded-lg border border-bearish/30 bg-bearish/5 p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-bearish">Do not trade</div>
          <div className="mt-1 text-sm text-foreground/90">{card.one_line_reason}</div>
          {card.better_structure && (
            <div className="mt-2 text-xs text-muted-foreground">
              Instead: {card.better_structure}
            </div>
          )}
        </div>
      ) : null}

      {/* Better structure hint when not SKIP */}
      {card.action !== "SKIP" && card.better_structure && (
        <div className="mt-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground/80">Better:</span> {card.better_structure}
        </div>
      )}

      {/* Compact meta chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className={`pill ${card.data_quality === "PASS" ? "pill-bullish" : card.data_quality === "PARTIAL" ? "pill-neutral" : "pill-bearish"}`}>
          {DATA_ICON[card.data_quality]}
          Data {card.data_quality}
        </span>
        <span className="pill pill-neutral">Fit {card.fit_score}/5</span>
        <span className={`pill ${card.confidence === "High" ? "pill-bullish" : card.confidence === "Medium" ? "pill-neutral" : "pill-bearish"}`}>
          Confidence {card.confidence}
        </span>
      </div>

      {/* Toggle full analysis */}
      {card.full_analysis_md && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowFull((v) => !v)}
          >
            {showFull ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showFull ? "Hide" : "Show"} full analysis
          </Button>
          {showFull && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-foreground/85 leading-relaxed [&_strong]:text-foreground [&_strong]:font-semibold [&_p]:my-1.5 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:list-disc [&_li]:my-0.5 [&_code]:bg-surface/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono">
              <ReactMarkdown>{card.full_analysis_md}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
