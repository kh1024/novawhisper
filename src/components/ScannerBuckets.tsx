// ─── SCANNER BUCKETS ─────────────────────────────────────────────────────────
// Renders ApprovedPicks grouped into the 4 final-classifier tiers:
//   • BUY NOW       — all 4 gates passed
//   • WATCHLIST     — good idea, fixable issue
//   • NEEDS RECHECK — quote/data issue, refresh before acting
//   • AVOID         — hard-blocked or too many failures (collapsed by default)
//
// AVOID is always collapsed. Each section shows count + helper subtitle.
import { useState } from "react";
import { ApprovedPickCard } from "@/components/ApprovedPickCard";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovedPick } from "@/lib/useScannerPicks";
import type { FinalTier } from "@/lib/scoring/finalClassifier";

interface Props {
  picks: ApprovedPick[];
  onOpen?: (symbol: string) => void;
}

const BUY_NOW_TIERS    = ["BUY NOW", "BUY_NOW", "APPROVED"];
const WATCHLIST_TIERS  = ["WATCHLIST", "WATCH", "WAIT"];
const RECHECK_TIERS    = ["NEEDS RECHECK", "NEEDS_RECHECK", "OVER_BUDGET_WATCHLIST"];
const AVOID_TIERS      = ["AVOID", "BLOCKED", "SKIP"];

function tierOf(p: ApprovedPick): string {
  return (p.tier4 ?? "WATCHLIST").toUpperCase();
}

export function ScannerBuckets({ picks, onOpen }: Props) {
  const buckets = {
    buyNow:    picks.filter((p) => BUY_NOW_TIERS.includes(tierOf(p))),
    watchlist: picks.filter((p) => WATCHLIST_TIERS.includes(tierOf(p))),
    recheck:   picks.filter((p) => RECHECK_TIERS.includes(tierOf(p))),
    avoid:     picks.filter((p) => AVOID_TIERS.includes(tierOf(p))),
  };

  const [showAvoid, setShowAvoid] = useState(false);

  if (picks.length === 0) {
    return (
      <div className="text-center py-10 px-4 text-muted-foreground">
        <div className="text-base mb-1">No picks yet</div>
        <div className="text-[12px]">
          Scanner is loading or no candidates passed quality filters.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {buckets.buyNow.length > 0 && (
        <BucketSection
          title="BUY NOW"
          count={buckets.buyNow.length}
          subtitle="All 4 scores verified — live entry conditions met"
          accent="bullish"
          picks={buckets.buyNow}
          onOpen={onOpen}
        />
      )}

      {buckets.watchlist.length > 0 && (
        <BucketSection
          title="WATCHLIST"
          count={buckets.watchlist.length}
          subtitle="Good setup — waiting for trigger, cleaner quote, or session open"
          accent="primary"
          picks={buckets.watchlist}
          onOpen={onOpen}
        />
      )}

      {buckets.recheck.length > 0 && (
        <BucketSection
          title="NEEDS RECHECK"
          count={buckets.recheck.length}
          subtitle="Stale quote, provider conflict, or budget stretch — verify before acting"
          accent="warning"
          picks={buckets.recheck}
          onOpen={onOpen}
          dim
        />
      )}

      {buckets.avoid.length > 0 && (
        <section>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[12px] gap-1.5"
            onClick={() => setShowAvoid((s) => !s)}
          >
            {showAvoid ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {showAvoid ? "Hide" : "Show"} {buckets.avoid.length} Avoid / Blocked picks
          </Button>
          {showAvoid && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 opacity-60">
              {buckets.avoid.map((p) => (
                <ApprovedPickCard key={p.key} pick={p} onOpen={onOpen} />
              ))}
            </div>
          )}
        </section>
      )}

      {buckets.buyNow.length === 0 && buckets.watchlist.length === 0 && (
        <div className="text-center py-8 px-4 text-muted-foreground">
          <div className="text-sm">
            No live entries — only{" "}
            {buckets.recheck.length + buckets.avoid.length} pick(s) need recheck or are blocked.
          </div>
        </div>
      )}
    </div>
  );
}

function BucketSection({
  title,
  count,
  subtitle,
  accent,
  picks,
  onOpen,
  dim,
}: {
  title: string;
  count: number;
  subtitle: string;
  accent: "bullish" | "primary" | "warning";
  picks: ApprovedPick[];
  onOpen?: (symbol: string) => void;
  dim?: boolean;
}) {
  const accentText =
    accent === "bullish" ? "text-bullish" : accent === "primary" ? "text-primary" : "text-warning";
  const accentBorder =
    accent === "bullish"
      ? "border-bullish"
      : accent === "primary"
      ? "border-primary"
      : "border-warning";
  const badgeBg =
    accent === "bullish"
      ? "bg-bullish text-bullish-foreground"
      : accent === "primary"
      ? "bg-primary text-primary-foreground"
      : "bg-warning text-warning-foreground";

  return (
    <section>
      <div
        className={cn(
          "flex items-center gap-2 mb-3 pb-2 border-b-2",
          accentBorder,
        )}
      >
        <span className={cn("text-sm font-extrabold tracking-wider", accentText)}>{title}</span>
        <span
          className={cn(
            "mono text-[11px] font-extrabold rounded-full px-2 py-0.5",
            badgeBg,
          )}
        >
          {count}
        </span>
        <span className="text-[11px] text-muted-foreground hidden sm:inline">{subtitle}</span>
      </div>
      <div
        className={cn(
          "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3",
          dim && "opacity-80",
        )}
      >
        {picks.map((p) => (
          <ApprovedPickCard key={p.key} pick={p} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
