// Plain-English market hero cards with visual meters.
// Each card translates a metric into Bad → Caution → Good with a clear label
// and a colored meter bar. Numbers are kept as small secondary detail.
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, type Variants } from "framer-motion";
import { Activity, AlertTriangle, ShieldCheck, TrendingUp, Info, Cpu, Zap } from "lucide-react";
import { MARKET_REGIME } from "@/lib/mockData";
import { useNarrativeSignals } from "@/lib/sentimentSignals";

const fade: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: "easeOut" } }),
};

type Tone = "good" | "ok" | "bad";

interface MeterCard {
  label: string;
  status: string;            // big plain-English word
  tone: Tone;                // drives color
  meter: number;             // 0-100, position on the meter
  detail: string;            // small subtitle (numbers OK here)
  icon: typeof TrendingUp;
  tip: string;               // hover explanation
}

const TONE_STYLES: Record<Tone, { bar: string; text: string; pillBg: string; ring: string }> = {
  good: { bar: "bg-bullish", text: "text-bullish", pillBg: "bg-bullish/15", ring: "ring-bullish/40" },
  ok:   { bar: "bg-neutral", text: "text-neutral", pillBg: "bg-neutral/15", ring: "ring-neutral/40" },
  bad:  { bar: "bg-bearish", text: "text-bearish", pillBg: "bg-bearish/15", ring: "ring-bearish/40" },
};

function buildCards(): MeterCard[] {
  // 1) Market Regime — bullish/risk-on label drives tone
  const regimeTone: Tone = MARKET_REGIME.regime.toLowerCase().includes("on") ? "good" : MARKET_REGIME.regime.toLowerCase().includes("off") ? "bad" : "ok";
  const regimeMeter = regimeTone === "good" ? 85 : regimeTone === "ok" ? 50 : 20;

  // 2) VIX — lower is calmer (good), higher is fearful (bad)
  // Calm <15 · Normal 15-22 · Elevated 22-30 · Panic 30+
  const vix = MARKET_REGIME.vix;
  const vixTone: Tone = vix < 15 ? "good" : vix < 22 ? "ok" : "bad";
  const vixLabel = vix < 15 ? "Calm" : vix < 22 ? "Normal" : vix < 30 ? "Elevated" : "Panic";
  const vixMeter = Math.max(5, Math.min(100, 100 - ((vix - 10) / 30) * 100));

  // 3) Breadth — % of stocks above 50DMA
  const b = MARKET_REGIME.breadth;
  const breadthTone: Tone = b >= 60 ? "good" : b >= 40 ? "ok" : "bad";
  const breadthLabel = b >= 70 ? "Strong" : b >= 55 ? "Healthy" : b >= 40 ? "Mixed" : "Weak";

  // 4) Event Risk — qualitative
  const eventTone: Tone = "bad"; // FOMC + earnings present
  const eventMeter = 80;

  return [
    {
      label: "Market Mood",
      status: regimeTone === "good" ? "Good" : regimeTone === "ok" ? "Mixed" : "Risky",
      tone: regimeTone,
      meter: regimeMeter,
      detail: `${MARKET_REGIME.regime} · ${MARKET_REGIME.trend}`,
      icon: TrendingUp,
      tip: "How aggressive money is positioning. Risk-On = buying growth, Risk-Off = flight to safety.",
    },
    {
      label: "Fear Level",
      status: vixLabel,
      tone: vixTone,
      meter: vixMeter,
      detail: `VIX ${vix.toFixed(2)} (${MARKET_REGIME.vixChange >= 0 ? "+" : ""}${MARKET_REGIME.vixChange} today)`,
      icon: Activity,
      tip: "VIX measures expected volatility. Below 15 = calm, 15-22 = normal, 22+ = elevated fear.",
    },
    {
      label: "Market Breadth",
      status: breadthLabel,
      tone: breadthTone,
      meter: b,
      detail: `${b}% of stocks above 50-day avg`,
      icon: ShieldCheck,
      tip: "How many stocks are participating in the trend. Higher = healthier rally.",
    },
    {
      label: "Event Risk",
      status: "Watch Out",
      tone: eventTone,
      meter: eventMeter,
      detail: "FOMC + 2 earnings this week",
      icon: AlertTriangle,
      tip: "Major scheduled events that can spike volatility. Size positions smaller this week.",
    },
  ];
}

export function MarketHeroCards() {
  const cards = buildCards();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c, i) => {
        const styles = TONE_STYLES[c.tone];
        return (
          <motion.div key={c.label} variants={fade} initial="hidden" animate="show" custom={i}>
            <Card className="glass-card-elevated p-5 relative overflow-hidden group h-full">
              <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full ${styles.pillBg} blur-2xl opacity-60 group-hover:opacity-100 transition-opacity`} />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">{c.label}</span>
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button aria-label={`About ${c.label}`} className="text-muted-foreground/60 hover:text-foreground transition-colors">
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

                {/* Meter bar */}
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
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
