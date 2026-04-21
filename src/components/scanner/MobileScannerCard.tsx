import { memo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChevronRight, TrendingUp, TrendingDown, Minus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { VerdictBadge } from "@/components/PickMetaRow";
import { BudgetImpactPill } from "@/components/BudgetImpactPill";
import { NovaGuardBadges } from "@/components/NovaGuardBadges";
import { SaveToWatchlistButton } from "@/components/SaveToWatchlistButton";
import { AddToPortfolioButton } from "@/components/AddToPortfolioButton";
import { rowBucket } from "@/lib/scannerBucket";
import type { SetupRow, Bias } from "@/lib/setupScore";
import type { VerdictResult } from "@/lib/verdictModel";
import type { ValidationResult } from "@/lib/gates";

const biasMeta = (b: Bias) => {
  switch (b) {
    case "bullish":  return { cls: "pill-bullish",  Icon: TrendingUp };
    case "bearish":  return { cls: "pill-bearish",  Icon: TrendingDown };
    case "reversal": return { cls: "pill-neutral",  Icon: RotateCcw };
    default:         return { cls: "pill-neutral",  Icon: Minus };
  }
};

interface Props {
  row: SetupRow;
  verdict: VerdictResult | null;
  budgetCheck?: ValidationResult | null;
  guard?: { shouldBlockSignal: boolean; chips?: any[] } | null;
  contract: {
    symbol: string;
    optionType: "call" | "put";
    direction: string;
    strike: number;
    expiry: string;
  };
  /** Live VIX level — renders a tiny chip in the header when present. */
  vix?: number | null;
  /** Real 52w IV Rank when available — overrides row.ivRank in the IVR stat. */
  ivRankUsed?: number | null;
  /** True when ivRankUsed came from real 52w history; false = IVP proxy ("est."). */
  ivRankIsReal?: boolean;
  onOpen: (symbol: string) => void;
}

function MobileScannerCardImpl({ row, verdict, budgetCheck, guard, contract, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const { cls: bcls, Icon: BIcon } = biasMeta(row.bias);
  const isCall = contract.optionType === "call";

  const status = verdict?.verdict ?? "Wait";

  return (
    <Card
      className={cn(
        "p-3 space-y-2 border bg-card",
        status === "Avoid" && "opacity-80",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onOpen(row.symbol)}
          className="text-left min-w-0 flex-1 active:opacity-70"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-semibold text-base">{row.symbol}</span>
            <span className="mono text-sm">${row.price.toFixed(2)}</span>
            <span className={cn("mono text-[11px]", row.changePct >= 0 ? "text-bullish" : "text-bearish")}>
              {row.changePct >= 0 ? "+" : ""}{row.changePct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{row.name}</div>
        </button>
        {verdict && <VerdictBadge verdict={verdict.verdict} reason={verdict.reason} />}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`pill ${bcls} capitalize gap-1`}>
          <BIcon className="h-3 w-3" />{row.bias}
        </span>
        <span
          className={cn(
            "mono text-[11px] font-bold px-2 py-0.5 rounded border",
            isCall
              ? "text-bullish border-bullish/60 bg-bullish/10"
              : "text-bearish border-bearish/60 bg-bearish/10",
          )}
        >
          ${contract.strike}{isCall ? "C" : "P"}
        </span>
        {budgetCheck && <BudgetImpactPill result={budgetCheck} />}
      </div>

      <Accordion
        type="single"
        collapsible
        value={open ? "details" : ""}
        onValueChange={(v) => setOpen(v === "details")}
      >
        <AccordionItem value="details" className="border-0">
          <AccordionTrigger className="py-1 text-[11px] text-muted-foreground hover:no-underline">
            <span className="flex items-center gap-1">
              <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
              Details · Setup {row.setupScore}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-0 space-y-2">
            <div className="grid grid-cols-4 gap-2 text-[10px]">
              <Stat label="RSI" value={row.rsi.toFixed(0)} />
              <Stat label="IVR" value={row.ivRank.toFixed(0)} />
              <Stat label="ATR%" value={`${row.atrPct.toFixed(1)}%`} />
              <Stat label="Liq" value={row.optionsLiquidity.toFixed(0)} />
            </div>

            {verdict && (
              <div className="text-[11px] space-y-0.5">
                <Row k="Timing" v={verdict.timing} />
                <Row k="Risk" v={verdict.risk} />
                <Row k="Contract" v={verdict.contract.label} />
              </div>
            )}

            {guard && <NovaGuardBadges guard={guard as any} compact />}

            {row.warnings[0] && (
              <div className="text-[10px] text-bearish/90">⚠ {row.warnings[0]}</div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <Button
          onClick={() => onOpen(row.symbol)}
          className="flex-1 min-w-[120px] h-11 text-sm font-semibold"
          size="sm"
        >
          Open {row.symbol}
        </Button>
        <SaveToWatchlistButton
          size="sm"
          symbol={row.symbol}
          direction={contract.direction}
          optionType={contract.optionType}
          strike={contract.strike}
          expiry={contract.expiry}
          bias={row.bias}
          tier={row.readiness}
          entryPrice={row.price}
          thesis={row.warnings[0] ?? row.trendLabel}
          source="scanner"
          meta={{ setupScore: row.setupScore }}
        />
        <AddToPortfolioButton
          size="sm"
          spec={{
            symbol: row.symbol,
            optionType: contract.optionType,
            strike: contract.strike,
            expiry: contract.expiry,
            spot: row.price,
            ivRank: row.ivRank,
            bucket: rowBucket({ riskBadge: row.crl?.riskBadge, earningsInDays: row.earningsInDays, ivRank: row.ivRank }),
            initialScore: row.setupScore,
            thesis: row.warnings[0] ?? row.trendLabel,
            source: "scanner-mobile",
          }}
        />
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center rounded border border-border/50 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className="mono font-semibold text-foreground text-[11px]">{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}

export const MobileScannerCard = memo(MobileScannerCardImpl, (prev, next) => {
  if (prev.row.symbol !== next.row.symbol) return false;
  if (prev.row.price !== next.row.price) return false;
  if (prev.row.changePct !== next.row.changePct) return false;
  if (prev.row.setupScore !== next.row.setupScore) return false;
  if (prev.row.rsi !== next.row.rsi) return false;
  if (prev.verdict?.verdict !== next.verdict?.verdict) return false;
  if (prev.verdict?.timing !== next.verdict?.timing) return false;
  if (prev.budgetCheck?.budgetImpact?.pctOfPortfolio !== next.budgetCheck?.budgetImpact?.pctOfPortfolio) return false;
  if (prev.contract.strike !== next.contract.strike) return false;
  if (prev.contract.optionType !== next.contract.optionType) return false;
  return true;
});
