// Plain-English market hero cards with visual meters.
// Event-risk cards (Geopolitics, Political Posts, Fed/Rates, Earnings) are
// derived live from the news feed and are clickable — they open a dialog
// listing every matched headline with a direct link to the source article.
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { motion, type Variants } from "framer-motion";
import { Activity, ShieldCheck, TrendingUp, Info, Globe2, Megaphone, Landmark, BarChart3, ExternalLink, Newspaper } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { MARKET_REGIME } from "@/lib/mockData";
import { useEventRiskSignals, type EventRiskSignal, type EventRiskMatch } from "@/lib/sentimentSignals";

const fade: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: "easeOut" } }),
};

type Tone = "good" | "ok" | "bad";

interface MeterCard {
  label: string;
  status: string;
  tone: Tone;
  meter: number;
  detail: string;
  icon: typeof TrendingUp;
  tip: string;
  event?: EventRiskSignal;
}

const TONE_STYLES: Record<Tone, { bar: string; text: string; pillBg: string; ring: string }> = {
  good: { bar: "bg-bullish", text: "text-bullish", pillBg: "bg-bullish/15", ring: "ring-bullish/40" },
  ok:   { bar: "bg-neutral", text: "text-neutral", pillBg: "bg-neutral/15", ring: "ring-neutral/40" },
  bad:  { bar: "bg-bearish", text: "text-bearish", pillBg: "bg-bearish/15", ring: "ring-bearish/40" },
};

const EVENT_ICON: Record<EventRiskSignal["key"], typeof TrendingUp> = {
  geopolitics: Globe2,
  political: Megaphone,
  fed: Landmark,
  earnings: BarChart3,
};

const EVENT_TIP: Record<EventRiskSignal["key"], string> = {
  geopolitics: "War, sanctions, tariffs, missile strikes. Hot = expect intraday gaps and risk-off flows.",
  political: "Trump/Xi/Putin posts, executive orders, Senate votes. Hot = single-tweet moves possible — size down.",
  fed: "FOMC, CPI/PPI/PCE, jobs report, Powell remarks, yields. Hot = rate-sensitive sectors will whipsaw.",
  earnings: "Major earnings prints + guidance. Hot = single-name gap risk; avoid short-dated naked options.",
};

function buildCards(events: EventRiskSignal[]): MeterCard[] {
  const regimeTone: Tone = MARKET_REGIME.regime.toLowerCase().includes("on") ? "good" : MARKET_REGIME.regime.toLowerCase().includes("off") ? "bad" : "ok";
  const regimeMeter = regimeTone === "good" ? 85 : regimeTone === "ok" ? 50 : 20;

  const vix = MARKET_REGIME.vix;
  const vixTone: Tone = vix < 15 ? "good" : vix < 22 ? "ok" : "bad";
  const vixLabel = vix < 15 ? "Calm" : vix < 22 ? "Normal" : vix < 30 ? "Elevated" : "Panic";
  const vixMeter = Math.max(5, Math.min(100, 100 - ((vix - 10) / 30) * 100));

  const b = MARKET_REGIME.breadth;
  const breadthTone: Tone = b >= 60 ? "good" : b >= 40 ? "ok" : "bad";
  const breadthLabel = b >= 70 ? "Strong" : b >= 55 ? "Healthy" : b >= 40 ? "Mixed" : "Weak";

  const baseCards: MeterCard[] = [
    {
      label: "Market Mood",
      status: regimeTone === "good" ? "Good" : regimeTone === "ok" ? "Mixed" : "Risky",
      tone: regimeTone, meter: regimeMeter,
      detail: `${MARKET_REGIME.regime} · ${MARKET_REGIME.trend}`,
      icon: TrendingUp,
      tip: "How aggressive money is positioning. Risk-On = buying growth, Risk-Off = flight to safety.",
    },
    {
      label: "Fear Level",
      status: vixLabel, tone: vixTone, meter: vixMeter,
      detail: `VIX ${vix.toFixed(2)} (${MARKET_REGIME.vixChange >= 0 ? "+" : ""}${MARKET_REGIME.vixChange} today)`,
      icon: Activity,
      tip: "VIX measures expected volatility. Below 15 = calm, 15-22 = normal, 22+ = elevated fear.",
    },
    {
      label: "Market Breadth",
      status: breadthLabel, tone: breadthTone, meter: b,
      detail: `${b}% of stocks above 50-day avg`,
      icon: ShieldCheck,
      tip: "How many stocks are participating in the trend. Higher = healthier rally.",
    },
  ];

  const eventCards: MeterCard[] = events.map((e) => ({
    label: e.label,
    status: e.status,
    tone: e.tone,
    meter: e.meter,
    detail: e.detail,
    icon: EVENT_ICON[e.key],
    tip: EVENT_TIP[e.key],
    event: e,
  }));

  return [...baseCards, ...eventCards];
}

function timeAgo(iso: string): string {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ""; }
}

function HeadlinesDialog({ event, onOpenChange }: { event: EventRiskSignal | null; onOpenChange: (o: boolean) => void }) {
  const open = !!event;
  const matches: EventRiskMatch[] = event?.matches ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            {event?.label} — {matches.length} {matches.length === 1 ? "headline" : "headlines"}
          </DialogTitle>
          <DialogDescription>
            Tap any story to open the original source in a new tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 overflow-y-auto pr-1 -mr-1">
          {matches.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No matching stories in the current feed.
            </div>
          )}
          {matches.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="flex gap-3 p-3 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-surface/60 transition-all group"
            >
              {m.image ? (
                <img
                  src={m.image}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 rounded-md object-cover bg-muted shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <div className="h-16 w-16 rounded-md bg-surface/60 flex items-center justify-center shrink-0">
                  <Newspaper className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                  {m.headline}
                </div>
                {m.summary && (
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.summary}</div>
                )}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1.5">
                  <span className="font-medium uppercase tracking-wide text-primary/80">{m.source}</span>
                  <span>·</span>
                  <span>{timeAgo(m.publishedAt)}</span>
                  <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarketHeroCards() {
  const { all } = useEventRiskSignals();
  const cards = buildCards(all);
  const [openEvent, setOpenEvent] = useState<EventRiskSignal | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {cards.map((c, i) => {
          const styles = TONE_STYLES[c.tone];
          const clickable = !!c.event;
          const handleClick = () => { if (c.event) setOpenEvent(c.event); };
          return (
            <motion.div key={c.label} variants={fade} initial="hidden" animate="show" custom={i}>
              <Card
                onClick={clickable ? handleClick : undefined}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } : undefined}
                aria-label={clickable ? `Open ${c.label} headlines` : undefined}
                className={`glass-card-elevated p-5 relative overflow-hidden group h-full transition-all ${clickable ? "cursor-pointer hover:ring-1 hover:ring-primary/40 hover:-translate-y-0.5" : ""}`}
              >
                <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full ${styles.pillBg} blur-2xl opacity-60 group-hover:opacity-100 transition-opacity`} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">{c.label}</span>
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              aria-label={`About ${c.label}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground/60 hover:text-foreground transition-colors"
                            >
                              <Info className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[240px] text-xs leading-relaxed">
                            {c.tip}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <c.icon className={`h-4 w-4 ${styles.text}`} />
                  </div>

                  <div className="flex items-baseline gap-2 mb-3">
                    <span className={`text-2xl font-bold tracking-tight ${styles.text}`}>{c.status}</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="h-2 rounded-full bg-muted/60 overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${c.meter}%` }}
                        transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 + i * 0.05 }}
                        className={`h-full ${styles.bar} rounded-full`}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] tracking-wider uppercase text-muted-foreground/70">
                      <span>Bad</span>
                      <span>Good</span>
                    </div>
                  </div>

                  <div className="text-[11px] text-muted-foreground mt-3 leading-snug line-clamp-2">{c.detail}</div>
                  {clickable && c.event && c.event.matches.length > 0 && (
                    <div className="text-[10px] text-primary/80 mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ExternalLink className="h-2.5 w-2.5" /> View {c.event.matches.length} {c.event.matches.length === 1 ? "story" : "stories"}
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
      <HeadlinesDialog event={openEvent} onOpenChange={(o) => { if (!o) setOpenEvent(null); }} />
    </>
  );
}
