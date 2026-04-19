// Shared "Bias / Timing / Risk / Contract" labeled row.
// One component used by every place we render a tradeable pick (watchlist,
// dashboard top opportunities, market hottest, planning, etc.) so the
// language and layout stay identical app-wide.
import { useMemo } from "react";

export type PickBias = "bullish" | "bearish" | "neutral" | "reversal" | string | null | undefined;
export type PickOptionType = "call" | "put" | string;
export type PickTier =
  | "safe" | "mild" | "aggressive" | "lottery"
  | "conservative" | "moderate" | "mid"
  | string | null | undefined;

export type Timing = "ready" | "watch" | "wait" | "exit" | "avoid";

interface Props {
  bias: PickBias;
  optionType: PickOptionType;
  strike?: number | string | null;
  expiry?: string | null;
  tier?: PickTier;
  /** Verdict timing — pass explicitly when the page has a verdict. */
  timing?: Timing;
  className?: string;
}

/** Plain-English Bias label + color class. */
function biasOf(bias: PickBias) {
  if (bias === "bullish") return { label: "Bullish", cls: "text-bullish" };
  if (bias === "bearish") return { label: "Bearish", cls: "text-bearish" };
  if (bias === "reversal") return { label: "Reversal", cls: "text-foreground" };
  return { label: "Neutral", cls: "text-foreground" };
}

/** Decide a default Timing label from the market clock when none is given. */
function defaultTiming(): Timing {
  const est = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dow = est.getDay();
  const min = est.getHours() * 60 + est.getMinutes();
  const isOpen = dow >= 1 && dow <= 5 && min >= 9 * 60 + 30 && min < 16 * 60;
  return isOpen ? "watch" : "wait";
}

function timingMeta(t: Timing): { label: string; cls: string } {
  switch (t) {
    case "ready": return { label: "Ready", cls: "text-bullish" };
    case "watch": return { label: "Watch Closely", cls: "text-warning" };
    case "wait":  return { label: "Wait for Open", cls: "text-muted-foreground" };
    case "exit":  return { label: "Exit Soon", cls: "text-warning" };
    case "avoid": return { label: "Avoid", cls: "text-bearish" };
  }
}

/** Normalize the saved tier into a clean Risk label. */
function riskLabel(tier: PickTier): string {
  const t = (tier ?? "").toString().toLowerCase();
  if (t === "safe" || t.startsWith("conserv")) return "Conservative";
  if (t === "mild" || t.startsWith("mod") || t === "mid") return "Mid";
  if (t === "aggressive" || t === "lottery") return "Aggressive";
  return tier ? String(tier).charAt(0).toUpperCase() + String(tier).slice(1) : "—";
}

/** Build the compact contract label, e.g. "$120C" or "$95P". */
function contractLabel(strike: Props["strike"], optionType: PickOptionType): string {
  if (strike == null || strike === "") return String(optionType ?? "").toUpperCase();
  const n = Number(strike);
  const s = Number.isFinite(n) ? (Number.isInteger(n) ? `${n}` : n.toFixed(2)) : `${strike}`;
  const suffix = optionType === "put" ? "P" : optionType === "call" ? "C" : String(optionType ?? "").charAt(0).toUpperCase();
  return `$${s}${suffix}`;
}

export function PickMetaRow({ bias, optionType, strike, expiry, tier, timing, className }: Props) {
  const b = useMemo(() => biasOf(bias), [bias]);
  const t = useMemo(() => timingMeta(timing ?? defaultTiming()), [timing]);
  const risk = useMemo(() => riskLabel(tier), [tier]);
  const contract = useMemo(() => contractLabel(strike, optionType), [strike, optionType]);

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[11px] leading-tight ${className ?? ""}`}>
      <div>
        <span className="text-muted-foreground">Bias:</span>{" "}
        <span className={`font-semibold ${b.cls}`}>{b.label}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Timing:</span>{" "}
        <span className={`font-semibold ${t.cls}`}>{t.label}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Risk:</span>{" "}
        <span className="font-semibold text-foreground">{risk}</span>
      </div>
      <div className="truncate">
        <span className="text-muted-foreground">Contract:</span>{" "}
        <span className="font-semibold mono text-foreground">{contract}</span>
        {expiry ? <span className="text-muted-foreground"> · {expiry}</span> : null}
      </div>
    </div>
  );
}
