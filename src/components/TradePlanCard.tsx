// "Should I buy this — and how?" card.
//
// Sits at the top of the Research Drawer (above tabs) and answers the six
// questions the user always asks before clicking Buy:
//   WHAT    — exact contract (type, strike, expiry)
//   WHEN    — market session right now + entry trigger / timing
//   WHERE   — entry price (mid), invalidation stop on the underlying
//   WHY     — Nova's one-line reason
//   HOW MANY — contracts that fit the per-trade budget (from Settings)
//   GO/WAIT/NO — the final verdict, color-coded huge so it's unmissable
//
// All numbers come from Nova's `best_contract` + the live spot quote + the
// derived budget (portfolio × risk%). No invented values.
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, Ban, Target, DollarSign, Calendar, AlertTriangle, ShoppingCart, Wallet } from "lucide-react";
import { useCapitalSettings } from "@/lib/budget";
import { useSettings } from "@/lib/settings";
import { classifyAffordability } from "@/lib/affordability";
import { AffordabilityBadge } from "@/components/AffordabilityBadge";
import { isMarketOpen, isWeekend } from "@/lib/verdictModel";
import type { NovaCard } from "@/components/NovaVerdictCard";

type Props = {
  card: NovaCard;
  symbol: string;
  spot: number | null;
  /** Optional: link to broker for one-tap buy. */
  brokerHref?: string;
};

function sessionInfo(): { label: string; tone: "good" | "warn" | "bad"; hint: string } {
  if (isWeekend()) {
    return { label: "Market closed · weekend", tone: "bad", hint: "Plan now, place the order Monday at the open." };
  }
  if (isMarketOpen()) {
    return { label: "Market OPEN · regular hours", tone: "good", hint: "Live quotes — order will fill at mid/ask." };
  }
  // Weekday but not 9:30–16:00 ET
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = ny.getHours() * 60 + ny.getMinutes();
  if (m >= 4 * 60 && m < 9 * 60 + 30) {
    return { label: "Pre-market", tone: "warn", hint: "Wide spreads — wait for 9:30 ET open before entering." };
  }
  if (m >= 16 * 60 && m < 20 * 60) {
    return { label: "After-hours", tone: "warn", hint: "Options don't trade after-hours. Plan now, fire tomorrow." };
  }
  return { label: "Market closed", tone: "bad", hint: "Set an alert for the next open." };
}

const ACTION_META = {
  BUY:  { Icon: CheckCircle2, label: "BUY NOW",     bg: "bg-bullish/15", text: "text-bullish", ring: "ring-bullish/50" },
  WAIT: { Icon: Clock,        label: "WAIT",        bg: "bg-warning/15", text: "text-warning", ring: "ring-warning/50" },
  SKIP: { Icon: Ban,          label: "DON'T BUY",   bg: "bg-bearish/15", text: "text-bearish", ring: "ring-bearish/50" },
} as const;

export function TradePlanCard({ card, symbol, spot, brokerHref }: Props) {
  const { portfolio, riskPct, budget } = useCapitalSettings();
  const session = sessionInfo();
  const c = card.best_contract ?? null;
  const meta = ACTION_META[card.action];
  const Icon = meta.Icon;

  // Budget math — uses the per-trade cap from Settings (portfolio × risk%).
  const cost = c?.cost_per_contract_usd ?? null;
  const affordableQty = cost && cost > 0 ? Math.floor(budget / cost) : 0;
  // Nova may have already capped size; use the smaller of the two.
  const novaCap = c?.max_size_contracts ?? null;
  const finalQty = novaCap != null ? Math.min(novaCap, affordableQty) : affordableQty;
  const totalSpend = finalQty * (cost ?? 0);
  const overBudget = cost != null && cost > budget;

  // "Where" — invalidation level vs current spot.
  const stopDistPct =
    c?.stop_price != null && spot && spot > 0
      ? ((spot - c.stop_price) / spot) * 100
      : null;

  return (
    <Card className={`p-0 overflow-hidden ring-1 ${meta.ring} bg-gradient-surface`}>
      {/* HERO — verdict + one-line why */}
      <div className={`${meta.bg} px-4 py-3 flex items-center gap-3`}>
        <Icon className={`h-7 w-7 ${meta.text} shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className={`text-xl font-bold ${meta.text} leading-none`}>{meta.label}</div>
          <div className="text-xs text-foreground/85 mt-1 line-clamp-2">{card.one_line_reason}</div>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
          Confidence · {card.confidence}
        </Badge>
      </div>

      {/* WHEN — market session band */}
      <div
        className={`px-4 py-2 border-b border-border flex items-center gap-2 text-xs ${
          session.tone === "good"
            ? "bg-bullish/5 text-bullish"
            : session.tone === "warn"
            ? "bg-warning/5 text-warning"
            : "bg-bearish/5 text-bearish"
        }`}
      >
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">{session.label}</span>
        <span className="text-foreground/70 truncate">· {session.hint}</span>
      </div>

      {/* PLAN GRID — only if Nova suggests an actual contract */}
      {c ? (
        <div className="p-4 space-y-3">
          {/* WHAT */}
          <div className="flex items-start gap-3">
            <Target className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">What to buy</div>
              <div className="font-mono text-base font-semibold mt-0.5">
                {symbol} {c.type.toUpperCase()} ${c.strike}
                <span className="text-muted-foreground font-normal text-sm"> · exp {c.expiry}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* WHERE — entry */}
            <Stat
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Entry (mid)"
              value={`$${c.mid.toFixed(2)}`}
              sub={cost != null ? `$${cost.toFixed(0)}/contract` : undefined}
            />
            {/* WHERE — stop */}
            <Stat
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Stop (underlying)"
              value={c.stop_price != null ? `$${c.stop_price.toFixed(2)}` : "—"}
              sub={stopDistPct != null ? `${stopDistPct >= 0 ? "−" : "+"}${Math.abs(stopDistPct).toFixed(1)}% from spot` : undefined}
              tone={stopDistPct != null && Math.abs(stopDistPct) > 8 ? "warn" : "default"}
            />
            {/* HOW MANY — budget fit */}
            <Stat
              icon={<Wallet className="h-3.5 w-3.5" />}
              label="Your size"
              value={overBudget ? "0×" : `${finalQty}×`}
              sub={overBudget ? `Over $${budget} cap` : `≈ $${totalSpend.toFixed(0)} of $${budget}`}
              tone={overBudget ? "bad" : finalQty === 0 ? "warn" : "good"}
            />
            {/* WHEN — DTE / expiry countdown */}
            <Stat
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Time horizon"
              value={daysUntil(c.expiry)}
              sub={`exp ${c.expiry}`}
            />
          </div>

          {/* Budget context — small print so user trusts the number */}
          <div className="text-[10px] text-muted-foreground bg-surface/40 border border-border/40 rounded px-2 py-1.5 flex items-center gap-1.5">
            <Wallet className="h-3 w-3 shrink-0" />
            Budget cap = ${portfolio.toLocaleString()} × {riskPct}% = <span className="font-mono font-semibold text-foreground">${budget}</span> per trade
            <span className="ml-auto">(edit in Settings)</span>
          </div>

          {/* Better structure hint */}
          {card.better_structure && (
            <div className="text-xs text-foreground/85 bg-primary/5 border border-primary/20 rounded px-3 py-2">
              <span className="font-semibold">Smarter alternative: </span>
              {card.better_structure}
            </div>
          )}

          {/* CTA — only when Nova says BUY and budget allows it */}
          {card.action === "BUY" && !overBudget && finalQty > 0 && brokerHref && (
            <Button asChild className="w-full h-11 gap-2" size="lg">
              <a href={brokerHref} target="_blank" rel="noreferrer">
                <ShoppingCart className="h-4 w-4" />
                Open {symbol} chain in broker
              </a>
            </Button>
          )}
          {card.action === "BUY" && overBudget && (
            <div className="text-xs text-bearish bg-bearish/10 border border-bearish/30 rounded px-3 py-2 flex items-center gap-2">
              <Ban className="h-3.5 w-3.5 shrink-0" />
              One contract costs <span className="font-mono font-semibold">${cost?.toFixed(0)}</span> — over your <span className="font-mono">${budget}</span> per-trade cap. Skip or raise budget in Settings.
            </div>
          )}
          {card.action === "WAIT" && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Don't buy yet. See "The Clock" in Nova's note for the trigger that flips this to GO.
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground text-center">
          Nova didn't surface a tradeable contract. {card.better_structure ? `Consider: ${card.better_structure}` : "Wait for a cleaner setup."}
        </div>
      )}
    </Card>
  );
}

function Stat({
  icon, label, value, sub, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good" ? "text-bullish"
    : tone === "warn" ? "text-warning"
    : tone === "bad" ? "text-bearish"
    : "text-foreground";
  return (
    <div className="rounded border border-border/60 bg-surface/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mono text-sm font-bold mt-0.5 ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function daysUntil(iso: string): string {
  const d = new Date(iso + "T16:00:00-05:00");
  const ms = d.getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86_400_000));
  if (days === 0) return "0 DTE";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return `${months}mo · ${days}d`;
}
