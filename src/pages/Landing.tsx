// Look a Logic — public marketing landing.
// Standalone route (no AppLayout). Dark-only, trader-terminal aesthetic.
import { Link } from "react-router-dom";
import { ArrowRight, Check, Minus, Filter, BarChart3, Download, Zap, Shield, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LiveMiniScanner } from "@/components/LiveMiniScanner";

const FILTER_CHIPS = ["theta", "delta", "IV", "DTE", "volume", "open interest", "pullback %", "ROI"];

const CONTENT_CARDS = [
  {
    tag: "Live scanner",
    title: "Live 2026 options scanner: high-theta plays on pullbacks",
    summary: "Filter, chart, and export qualified contracts instantly. Tune theta, delta, and DTE without rebuilding the scan.",
    cta: "See how",
  },
  {
    tag: "Comparison",
    title: "Top 10 option scanners ranked: pricing, filters, and why traders switch in 2026",
    summary: "Side-by-side breakdown of filter depth, alerting, export, and total cost across the leading platforms.",
    cta: "Read guide",
  },
  {
    tag: "Tutorial",
    title: "How to build custom scanners in thinkorswim Option Hacker",
    summary: "Map the 25-filter limit, save useful queries, and migrate the scan into Look a Logic without losing logic.",
    cta: "Read guide",
  },
  {
    tag: "Comparison",
    title: "ORATS vs Barchart option screeners: which one ranks better trades?",
    summary: "Volatility metrics vs strategy screening — where each tool wins and where Look a Logic closes the gap.",
    cta: "See how",
  },
  {
    tag: "Playbook",
    title: "Best filters for high-ROI theta decay trades",
    summary: "The exact filter stack we run on Mondays and Wednesdays for theta-positive setups under $500 per contract.",
    cta: "Read guide",
  },
];

type Cell = "yes" | "no" | "partial" | string;
const COMPARE_ROWS: { label: string; cols: [Cell, Cell, Cell, Cell] }[] = [
  { label: "Custom filter logic",       cols: ["Unlimited + AND/OR", "Up to 25 filters", "Volatility-focused", "Preset-driven"] },
  { label: "Saved scans",               cols: ["yes", "yes", "yes", "partial"] },
  { label: "Real-time alerts",          cols: ["yes", "yes", "partial", "partial"] },
  { label: "CSV / API export",          cols: ["yes", "partial", "yes", "partial"] },
  { label: "Strategy scanning",         cols: ["yes", "yes", "yes", "yes"] },
  { label: "Trader-friendly UI",        cols: ["Built for speed", "Powerful, dense", "Quant-leaning", "Web tables"] },
  { label: "Pricing transparency",      cols: ["Flat, public", "Brokerage-tied", "Tiered", "Tiered"] },
];

function CompareCell({ v }: { v: Cell }) {
  if (v === "yes") return <Check className="h-4 w-4 text-bullish" />;
  if (v === "no") return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (v === "partial") return <span className="pill pill-neutral">partial</span>;
  return <span className="text-foreground/90 text-sm">{v}</span>;
}

function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="lal-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--primary-glow))" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#lal-g)" opacity="0.15" stroke="hsl(var(--primary) / 0.6)" />
      <path d="M6 22 L12 14 L17 19 L26 8" stroke="url(#lal-g)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26" cy="8" r="2" fill="hsl(var(--primary-glow))" />
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-primary focus:text-primary-foreground focus:rounded">
        Skip to content
      </a>

      {/* Sticky header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/landing" className="flex items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="font-semibold tracking-tight">Look a Logic</span>
            <Badge variant="outline" className="ml-1 text-[10px] border-primary/30 bg-primary/10 text-primary">Scanner</Badge>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#scanner" className="hover:text-foreground transition-colors">Scanner</a>
            <a href="#guides" className="hover:text-foreground transition-colors">Guides</a>
            <a href="#compare" className="hover:text-foreground transition-colors">Compare</a>
            <a href="#how" className="hover:text-foreground transition-colors">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline-block">Sign in</Link>
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/scanner">Try the Scanner <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/60">
          <div className="absolute inset-0 grid-bg opacity-[0.25] pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-border/60 bg-surface/60 text-[11px] text-muted-foreground mb-5">
                <span className="live-dot" /> Live scans · 2026 chains · theta-positive
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
                Scan high-theta pullback setups
                <span className="block text-transparent bg-clip-text bg-gradient-primary">in seconds.</span>
              </h1>
              <p className="mt-5 text-lg text-muted-foreground max-w-xl">
                Filter, chart, rank, and export option opportunities with logic-based scanning built for theta traders. No fluff, no preset lock-in.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="gap-2">
                  <Link to="/scanner">Try the Scanner <ArrowRight className="h-4 w-4" /></Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#scanner">See live scans</a>
                </Button>
              </div>
              <div className="mt-8 flex flex-wrap gap-1.5">
                {FILTER_CHIPS.map((c) => (
                  <span key={c} className="text-[11px] mono px-2 py-0.5 rounded border border-border/60 bg-surface/60 text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Mock scanner panel */}
            <div className="lg:col-span-6">
              <MockScanner />
            </div>
          </div>
        </section>

        {/* Feature: high-theta pullback */}
        <section id="scanner" className="border-b border-border/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20 grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <p className="text-xs uppercase tracking-widest text-primary font-medium mb-3">High-theta pullback scanner</p>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Live 2026 options scanner — filter, chart, export instantly.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Build the exact scan you'd build in thinkorswim, but tune it live. Every filter is composable, every result is exportable, every contract is rankable.
              </p>
              <div className="mt-6 flex items-center gap-2 text-sm">
                <WorkflowStep icon={Filter} label="Filter" />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <WorkflowStep icon={BarChart3} label="Chart" />
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <WorkflowStep icon={Download} label="Export" />
              </div>
            </div>
            <div className="lg:col-span-7 grid sm:grid-cols-2 gap-3">
              {[
                { icon: Zap, title: "Sub-second filter tuning", body: "Adjust theta, delta, IV, DTE without rebuilding the scan. Results re-rank live." },
                { icon: Activity, title: "Pullback intent built in", body: "Pre-wired underlying conditions: pullback %, RSI band, EMA reclaim — no custom scripting." },
                { icon: Shield, title: "Liquidity guardrails", body: "Min OI, spread %, and IV-trap penalties enforced automatically. Bad fills filtered out." },
                { icon: Download, title: "CSV + webhook export", body: "Push qualified contracts to your journal, alerts, or broker queue in one click." },
              ].map((f) => (
                <div key={f.title} className="glass-card rounded-lg p-5">
                  <f.icon className="h-5 w-5 text-primary" />
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Content cluster */}
        <section id="guides" className="border-b border-border/60 bg-surface/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="flex items-end justify-between gap-6 mb-8">
              <div>
                <p className="text-xs uppercase tracking-widest text-primary font-medium mb-2">Guides & comparisons</p>
                <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">Trader-grade reading, not blog filler.</h2>
              </div>
              <a href="#" className="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground items-center gap-1">All guides <ArrowRight className="h-3.5 w-3.5" /></a>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CONTENT_CARDS.map((c, i) => (
                <article
                  key={c.title}
                  className={`glass-card rounded-lg p-6 hover:border-primary/40 transition-colors ${i === 0 ? "lg:col-span-2 lg:row-span-1" : ""}`}
                >
                  <Badge variant="outline" className="text-[10px] border-primary/30 bg-primary/10 text-primary">{c.tag}</Badge>
                  <h3 className={`mt-3 font-semibold tracking-tight ${i === 0 ? "text-2xl" : "text-lg"}`}>{c.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{c.summary}</p>
                  <a href="#" className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-glow">
                    {c.cta} <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section id="compare" className="border-b border-border/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20">
            <div className="max-w-2xl mb-10">
              <p className="text-xs uppercase tracking-widest text-primary font-medium mb-2">Compare</p>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">How Look a Logic stacks up.</h2>
              <p className="mt-3 text-muted-foreground">
                Honest comparison against the tools traders actually use. We're built for filter speed and trader workflows — not for charting we don't need.
              </p>
            </div>
            <div className="glass-card-elevated rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface/60 border-b border-border/60">
                      <th className="text-left font-medium text-muted-foreground p-4 w-1/4">Capability</th>
                      <th className="text-left font-medium p-4">
                        <div className="flex items-center gap-2"><Logo className="h-4 w-4" /> Look a Logic</div>
                      </th>
                      <th className="text-left font-medium text-muted-foreground p-4">thinkorswim Option Hacker</th>
                      <th className="text-left font-medium text-muted-foreground p-4">ORATS</th>
                      <th className="text-left font-medium text-muted-foreground p-4">Barchart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map((row, i) => (
                      <tr key={row.label} className={i % 2 ? "bg-surface/20" : ""}>
                        <td className="p-4 font-medium text-foreground/90">{row.label}</td>
                        <td className="p-4 bg-primary/5"><CompareCell v={row.cols[0]} /></td>
                        <td className="p-4"><CompareCell v={row.cols[1]} /></td>
                        <td className="p-4"><CompareCell v={row.cols[2]} /></td>
                        <td className="p-4"><CompareCell v={row.cols[3]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-b border-border/60 bg-surface/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20">
            <p className="text-xs uppercase tracking-widest text-primary font-medium mb-2">Workflow</p>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-2xl">From scan to action in three moves.</h2>
            <div className="mt-10 grid md:grid-cols-3 gap-4">
              {[
                { n: "01", title: "Build your logic", body: "Stack filters with AND/OR. Save the scan. No 25-filter ceiling, no scripting language to learn." },
                { n: "02", title: "Surface qualified contracts", body: "Live re-ranking on theta, ROI, and liquidity. Penalties auto-applied for IV traps and stale data." },
                { n: "03", title: "Export and act", body: "CSV, webhook, or one-click into your journal. Alerts when a contract re-enters your scan." },
              ].map((s) => (
                <div key={s.n} className="glass-card rounded-lg p-6">
                  <div className="mono text-xs text-primary">{s.n}</div>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust */}
        <section className="border-b border-border/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-20 grid md:grid-cols-3 gap-6">
            {[
              { stat: "12,400+", label: "scans run last week" },
              { stat: "< 400ms", label: "median filter re-rank" },
              { stat: "0", label: "preset lock-in" },
            ].map((t) => (
              <div key={t.label} className="glass-card rounded-lg p-6">
                <div className="text-3xl font-semibold tracking-tight">{t.stat}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
          <div className="relative mx-auto max-w-4xl px-4 sm:px-6 py-20 sm:py-28 text-center">
            <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">Run your first scan.</h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              See live theta setups on today's pullbacks. No card, no demo wall — just the scanner.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link to="/scanner">Start free <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#scanner">See live theta setups</a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Logo className="h-5 w-5" />
            <span>© {new Date().getFullYear()} Look a Logic. Built for traders who filter with intent.</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#guides" className="hover:text-foreground">Guides</a>
            <a href="#compare" className="hover:text-foreground">Compare</a>
            <Link to="/scanner" className="hover:text-foreground">Scanner</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function WorkflowStep({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/60 bg-surface/60">
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function MockScanner() {
  const rows = [
    { sym: "NVDA",  bias: "Bull", theta: -0.42, delta: 0.58, iv: "34%",  roi: "+18%", rank: "ELITE",   tone: "bullish" as const },
    { sym: "AMD",   bias: "Bull", theta: -0.31, delta: 0.55, iv: "41%",  roi: "+14%", rank: "GO NOW",  tone: "bullish" as const },
    { sym: "META",  bias: "Bull", theta: -0.28, delta: 0.62, iv: "28%",  roi: "+11%", rank: "GOOD",    tone: "bullish" as const },
    { sym: "TSLA",  bias: "Bear", theta: -0.55, delta: 0.48, iv: "62%",  roi: "+9%",  rank: "WAIT",    tone: "bearish" as const },
    { sym: "SMCI",  bias: "—",    theta: -0.12, delta: 0.22, iv: "88%",  roi: "—",    rank: "PASS",    tone: "neutral" as const },
  ];
  return (
    <div className="glass-card-elevated rounded-xl overflow-hidden shadow-elevated">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-surface/60">
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-bearish/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-bullish/70" />
          <span className="ml-3 mono text-muted-foreground">scan · theta-pullback · 2026-04-19</span>
        </div>
        <span className="pill pill-live"><span className="live-dot" /> live</span>
      </div>
      <div className="p-3 border-b border-border/60 bg-surface/30 flex flex-wrap gap-1.5">
        {["theta < -0.20", "delta 0.45–0.70", "IV < 50%", "DTE 14–45", "OI > 500", "pullback 3–7%"].map((f) => (
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
            <th className="text-right p-3">Theta</th>
            <th className="text-right p-3">Δ</th>
            <th className="text-right p-3">IV</th>
            <th className="text-right p-3">ROI</th>
            <th className="text-right p-3 pr-4">Rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sym} className="border-b border-border/40 last:border-0 hover:bg-surface/40 transition-colors">
              <td className="p-3 font-semibold mono">{r.sym}</td>
              <td className="p-3">
                <span className={`pill ${r.tone === "bullish" ? "pill-bullish" : r.tone === "bearish" ? "pill-bearish" : "pill-neutral"}`}>
                  {r.bias}
                </span>
              </td>
              <td className="p-3 text-right mono text-bearish">{r.theta.toFixed(2)}</td>
              <td className="p-3 text-right mono">{r.delta.toFixed(2)}</td>
              <td className="p-3 text-right mono">{r.iv}</td>
              <td className="p-3 text-right mono text-bullish">{r.roi}</td>
              <td className="p-3 pr-4 text-right">
                <span className={`pill ${
                  r.rank === "ELITE" || r.rank === "GO NOW" ? "pill-bullish" :
                  r.rank === "PASS" ? "pill-bearish" : "pill-neutral"
                }`}>
                  {r.rank}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2.5 border-t border-border/60 bg-surface/40 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="mono">5 of 1,284 contracts match</span>
        <span className="inline-flex items-center gap-1.5"><Download className="h-3 w-3" /> export.csv</span>
      </div>
    </div>
  );
}
