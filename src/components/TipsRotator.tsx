// 100+ rotating knowledge tips about how to use the app + options trading basics.
// Picks a new tip every 60s with a smooth fade.
import { Lightbulb, ChevronRight, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type TipCategory = "app" | "options" | "risk" | "strategy" | "psychology";

interface Tip {
  category: TipCategory;
  title: string;
  body: string;
}

const TIPS: Tip[] = [
  // ── App usage ──────────────────────────────────────────────
  { category: "app", title: "Save any pick to Portfolio", body: "Hit the Save button on any Web Pick, Top Opportunity, or Planning idea. Nova then tracks the underlying live and tells you straight if it's working." },
  { category: "app", title: "Re-scrape for fresh ideas", body: "The Re-scrape button on Web Picks pulls the latest articles from Benzinga, Barchart, CNBC, Seeking Alpha and more — runs are saved to History so you can compare." },
  { category: "app", title: "Check the History tab", body: "Every web-pick run is persisted. Open History to see how older ideas played out before trusting today's batch." },
  { category: "app", title: "Honest verdicts on Portfolio", body: "Click Refresh verdict — Nova reads live spot vs your strike and labels each play as winning, running fine, bleeding, or in trouble. No sugar-coating." },
  { category: "app", title: "Source badge = traceability", body: "The small domain badge on each Web Pick links straight to the article that flagged the idea. Always sanity-check before risking real money." },
  { category: "app", title: "Live price next to ticker", body: "Every ticker now shows a live price and intraday change — no need to alt-tab to your broker just to see where SPY is." },
  { category: "app", title: "Risk tabs on Top Opportunities", body: "Switch between Safe / Mild / Aggressive on the Dashboard to match the day's energy and your account size." },
  { category: "app", title: "Moneyness flags on Portfolio", body: "ITM / OTM badges show whether your option has intrinsic value right now — critical near expiration." },
  { category: "app", title: "Close a position with one click", body: "Hit Close on any open position, paste the closing premium, and realized P&L flows into the header total automatically." },
  { category: "app", title: "Use the Research drawer", body: "Tap any ticker tile on the Dashboard to open the research drawer — news, sector context, and options-chain quality in one spot." },
  { category: "app", title: "Quote status pills explained", body: "✓ Good = two providers agree. ≈ OK = within 1%. ⚠ Check = 1%+ disagreement — cross-check before trading." },
  { category: "app", title: "Sector ETFs at a glance", body: "The ETF strip on Dashboard reveals which sector is actually driving today's tape — leaders are real signal." },
  { category: "app", title: "Owner-key portfolio", body: "Your portfolio is tied to this browser. Same browser = same portfolio. Clearing storage will lose it — back up your trades elsewhere." },
  { category: "app", title: "Total cost preview", body: "When saving, the popover shows total dollars at risk (premium × contracts × 100). If that number scares you, size down." },
  { category: "app", title: "Refresh interval is global", body: "Settings lets you tune how often live quotes refetch — slower interval = fewer API calls if you're hitting limits." },

  // ── Options basics ─────────────────────────────────────────
  { category: "options", title: "Calls vs Puts in one line", body: "Call = right to BUY at the strike. Put = right to SELL at the strike. Long = you paid; Short = you collected." },
  { category: "options", title: "ITM / ATM / OTM", body: "Call is ITM when spot > strike. Put is ITM when spot < strike. ATM ≈ at the strike. OTM = needs the stock to move your way." },
  { category: "options", title: "Premium has two parts", body: "Intrinsic value (how deep ITM) + extrinsic value (time + volatility). At expiry, only intrinsic remains." },
  { category: "options", title: "Delta ≈ probability of finishing ITM", body: "A 0.30 delta call has roughly a 30% chance of expiring ITM and moves ~$0.30 per $1 the stock moves." },
  { category: "options", title: "Theta is the daily bleed", body: "Long options lose theta every day, especially the last 21 DTE. Short options collect theta — that's the trade-off." },
  { category: "options", title: "IV crush is real", body: "After earnings/FDA/Fed, implied volatility drops fast. Long premium can lose money even when the stock moves your way." },
  { category: "options", title: "Vega = volatility sensitivity", body: "If IV rises 1 point, a long position with +0.10 vega gains $10 per contract. Long options love volatility expansion." },
  { category: "options", title: "Gamma spikes near expiry", body: "0DTE options have huge gamma — small moves = wild P&L swings. Either tiny size or stay away if you're new." },
  { category: "options", title: "DTE matters for theta", body: "A 45 DTE option decays slowly; a 7 DTE option decays fast. Pick DTE around your expected catalyst." },
  { category: "options", title: "Bid-ask spread = friction", body: "If a contract is bid 1.00 / ask 1.40, you lose ~17% just entering and exiting. Stick to liquid names with tight spreads." },
  { category: "options", title: "Open interest = liquidity", body: "OI under 100 = you'll get sliced. Look for OI above 500 on the strike you want to trade." },
  { category: "options", title: "Volume confirms today's interest", body: "High option volume + rising OI on one strike often signals smart-money positioning. That's what 'unusual activity' means." },
  { category: "options", title: "Contract = 100 shares", body: "1 call contract controls 100 shares. A $2 premium = $200 cost per contract. Sizing mistakes here destroy accounts." },

  // ── Single-leg playbook ─────────────────────────────────────
  { category: "strategy", title: "Long call basics", body: "Buy a call when you expect the stock to move up significantly before expiry. Max loss = premium paid. Pick ATM for leverage, ITM for safety." },
  { category: "strategy", title: "Long put basics", body: "Buy a put when you expect the stock to drop. Max loss = premium paid. Same delta-band rules as calls, just inverted." },
  { category: "strategy", title: "Stock-replacement call", body: "Deep-ITM call (Δ ≥ 0.80) tracks the stock ~1:1 with less capital and minimal theta drag. Great for high-priced names you'd own anyway." },
  { category: "strategy", title: "Match strategy to thesis", body: "Bullish + low IV → long call (premium is on sale). Bearish + low IV → long put. High IV? Wait for IV to cool — long premium will get crushed." },
  { category: "strategy", title: "Take profits on the way up", body: "Trim 50% at +50% to lock in cost basis, let the rest run with a trailing stop. Beats holding to expiry hoping for a moonshot." },
  { category: "strategy", title: "Don't double down on losers", body: "Adding to a losing long-premium position is how accounts get blown up. Theta and IV won't bail you out." },

  // ── Risk management ────────────────────────────────────────
  { category: "risk", title: "1-2% rule", body: "Risk no more than 1-2% of account on a single options trade. One bad print should never end your week." },
  { category: "risk", title: "Position-size off max loss", body: "For a defined-risk spread, max loss is known. Size so that even if all positions hit max loss, you're still standing." },
  { category: "risk", title: "Never short naked calls without a hedge", body: "Undefined upside risk. A surprise buyout or a squeeze can wipe years of premium in a single morning." },
  { category: "risk", title: "Avoid earnings unless that's your strategy", body: "Holding long premium through earnings = praying. IV crush usually punishes the obvious play." },
  { category: "risk", title: "Watch upcoming events", body: "FOMC, CPI, NFP, earnings, FDA — they create binary moves and IV crush. Plan around them, don't get blindsided." },
  { category: "risk", title: "Set a stop in your head", body: "Decide before entry: at what loss do you cut? At what profit do you take? Without these, emotions run the trade." },
  { category: "risk", title: "Diversify by direction AND time", body: "All long calls expiring same Friday = you're betting on one outcome. Spread expirations and mix bullish/bearish exposure." },
  { category: "risk", title: "Beware Friday morning theta cliff", body: "Weekend theta often bleeds in Thursday afternoon and Friday morning. Plan exits accordingly." },
  { category: "risk", title: "Liquidity > Greeks", body: "A 'perfect' setup on an illiquid contract is a worse trade than an OK setup on SPY. You have to be able to exit." },
  { category: "risk", title: "Account drawdown compounds painfully", body: "A 50% drawdown needs a 100% gain to recover. Defense first, offense second." },
  { category: "risk", title: "Black swan = portfolio killer", body: "One untrimmed naked short option through a 5%+ gap can erase a year. Always have a hedge or a stop." },
  { category: "risk", title: "IV rank > raw IV", body: "IV of 40 sounds high, but if the stock's 52-week range is 30-90, it's actually low. Use IV rank/percentile." },
  { category: "risk", title: "Don't trade size you can't sleep with", body: "If a position's overnight risk keeps you up, it's too big — regardless of the math." },

  // ── Psychology ─────────────────────────────────────────────
  { category: "psychology", title: "Boredom is the enemy", body: "Most great traders take 0-2 setups a day. Forcing trades when nothing lines up is the #1 way amateurs bleed out." },
  { category: "psychology", title: "Revenge trading rule: stop", body: "Two losers in a row? Walk away from the screen for an hour. The market will be there tomorrow." },
  { category: "psychology", title: "Journal every trade", body: "Use the Journal page. Write the thesis BEFORE entry. Review weekly — patterns in your mistakes become obvious fast." },
  { category: "psychology", title: "Ego costs money", body: "Being right matters less than being profitable. Cut losers fast even when 'you know' you're right." },
  { category: "psychology", title: "FOMO = instant -10%", body: "Chasing a stock that's already up 5% pre-market into long calls is how options traders donate to market makers." },
  { category: "psychology", title: "Don't anchor to entry price", body: "The market doesn't care what you paid. Manage from the current chart, not from your cost basis." },
  { category: "psychology", title: "Process > outcome", body: "A great trade can lose money. A terrible trade can win. Judge yourself on adherence to plan, not P&L of one day." },
  { category: "psychology", title: "Pattern recognition takes reps", body: "1000 chart hours before you 'see' setups instinctively. There's no shortcut — keep showing up." },

  // ── Market mechanics ───────────────────────────────────────
  { category: "options", title: "Market open is the wildest hour", body: "9:30-10:30 ET sees the widest spreads and biggest gamma. Beginners often skip the first 30 mins for a reason." },
  { category: "options", title: "Power hour can fake you out", body: "3:00-4:00 ET often reverses the day's direction. Position trims and 0DTE squeezes drive it." },
  { category: "options", title: "Options are European-style on indexes", body: "SPX, NDX, RUT can't be exercised early. SPY, QQQ, IWM (ETFs) are American — assignment risk near ex-div dates." },
  { category: "options", title: "Pin risk on expiration day", body: "If your short option closes within pennies of the strike, assignment is unpredictable. Close the trade Friday afternoon." },
  { category: "options", title: "Dividend = early assignment risk", body: "Short ITM calls on dividend-paying stocks can be assigned the day before ex-div. Roll or close ahead of it." },
  { category: "options", title: "Greeks are not constant", body: "Delta, gamma, theta all shift as the stock moves and time passes. Re-check the chain — don't trust entry-time numbers all week." },
  { category: "options", title: "0DTE = skill OR gambling", body: "Same-day expiration options have huge gamma and tiny theta-time. Either you have a real edge, or you're paying tuition." },

  // ── Catalyst & flow ────────────────────────────────────────
  { category: "strategy", title: "Earnings expected move", body: "Take ATM call + ATM put price ÷ stock price = market-implied % move through earnings. Trade only if your view differs from this." },
  { category: "strategy", title: "Unusual options activity = clue", body: "Big sweeps on OTM strikes can signal informed positioning, but most are noise. Confirm with price action before following." },
  { category: "strategy", title: "Watch the VIX", body: "VIX > 25 = elevated fear, premium-selling shines. VIX < 14 = complacency, long-premium / hedges get cheap." },
  { category: "strategy", title: "Sector rotation > stock picks", body: "Most stocks follow their sector ETF. Get the sector right (XLF, XLK, XLE) and individual picks become much easier." },
  { category: "strategy", title: "Macro days own everything", body: "FOMC, CPI, NFP can override every chart pattern. Reduce size and stay nimble around them." },
  { category: "strategy", title: "Trend on multiple timeframes", body: "Daily up + 1-hour pullback to support = high-probability long setup. Counter-trend trades require near-perfect entries." },
  { category: "strategy", title: "Volume confirms breakouts", body: "Breakout on weak volume = trap. Wait for the volume burst or buy the retest with rising volume." },
  { category: "strategy", title: "Round numbers act as magnets", body: "$100, $200, $500 levels see institutional flows and option strike clusters. Expect reaction at them." },
  { category: "strategy", title: "Friday close = position day", body: "Big funds rebalance Thursday/Friday afternoons. Sudden drift into the close often reflects hedging, not new info." },

  // ── Greeks deeper ──────────────────────────────────────────
  { category: "options", title: "Theta accelerates non-linearly", body: "Daily theta nearly doubles in the last 30 days vs the 30-60 day window. Time decay is exponential, not linear." },
  { category: "options", title: "Charm = delta's daily drift", body: "OTM options lose delta every day even with no stock move. That's why long lottery tickets fade quietly." },
  { category: "options", title: "Vanna links delta to vol", body: "When IV drops, OTM call deltas shrink. That's why short calls can win even on a green day after IV crush." },
  { category: "options", title: "Skew tells a story", body: "Index puts trade at a higher IV than calls — that's the skew. Steep skew = market is paying up for crash protection." },

  // ── Mindset & process ────────────────────────────────────
  { category: "psychology", title: "Have a daily routine", body: "Pre-market scan → economic calendar check → game-plan top 3 ideas → set alerts → wait. Random screen-staring is not strategy." },
  { category: "psychology", title: "Define your edge in one sentence", body: "If you can't, you don't have one yet. 'I sell premium on liquid mega-caps when IV rank > 50' is an edge. 'I trade options' is not." },
  { category: "psychology", title: "Track win rate AND avg R", body: "60% win rate at 0.5R loses money. 40% win rate at 2R is excellent. Both numbers, always." },
  { category: "psychology", title: "Trade what you understand", body: "If you can't explain why a trade works in 2 sentences to a friend, don't take it. Curiosity > complexity." },
  { category: "psychology", title: "Cash is a position", body: "Doing nothing during chop is a trade. Preserving capital for a great setup beats churning for mediocre ones." },
  { category: "psychology", title: "One trade ≠ your edge", body: "Edges play out over 100+ trades. Don't change strategy after 3 losses or 3 wins — sample size is everything." },

  // ── App-specific power tips ──────────────────────────────
  { category: "app", title: "Use Planning before market open", body: "The Planning page synthesizes YouTube + scraped news into a ranked watchlist. Run it the night before." },
  { category: "app", title: "Alerts page = your eyes off-screen", body: "Set price + sentiment alerts so you don't have to babysit the market. Trades come to you, not the reverse." },
  { category: "app", title: "Chains page for liquidity check", body: "Before saving any pick, peek at the options chain to confirm tight bid/ask and OI on the strike. 30 seconds saves real money." },
  { category: "app", title: "Settings → refresh rate", body: "Heavy intraday user? Drop refresh to 30s. Light user? 5 min keeps API costs down." },
  { category: "app", title: "Dashboard AI summary", body: "The 'AI Summary of the Day' card synthesizes the regime — read it first to set your bias before scanning picks." },
  { category: "app", title: "Sentiment signals = crowd mood", body: "The sentiment module reads Reddit + news. Extreme readings often mark short-term reversals." },
  { category: "app", title: "Setup score grades quality", body: "Picks with score 80+ have multiple confirming factors. Below 60 = single-factor, treat as speculative." },
  { category: "app", title: "Journal closed trades", body: "Every closed Portfolio position can be exported to Journal. Reviewing weekly is the fastest way to improve." },
  { category: "app", title: "Options Scout = web brain", body: "Web Picks is Nova reading Benzinga, Barchart, CNBC, Seeking Alpha + others, then bucketing by risk. Use it as your idea funnel, not as gospel." },
  { category: "app", title: "Verdict refresh costs an AI call", body: "Each Refresh verdict click hits the AI gateway. Refresh once after a real intraday move, not every minute." },

  // ── Common mistakes to avoid ──────────────────────────────
  { category: "risk", title: "Don't buy weeklies on a hunch", body: "0-7 DTE long calls/puts are theta bombs. If you're wrong by even a day, premium evaporates." },
  { category: "risk", title: "Don't fight the trend", body: "Buying puts in a screaming bull market is the most expensive lesson in trading. Trade with the regime." },
  { category: "risk", title: "Don't ignore commissions on spreads", body: "4-leg condors on cheap names can have commissions eating 10%+ of credit. Size and instrument selection matter." },
  { category: "risk", title: "Don't margin-call yourself", body: "Naked options margin requirements can spike during stress, forcing forced liquidation at the worst price." },
  { category: "risk", title: "Don't average down naked shorts", body: "Adding to a losing short option = doubling exposure to the move you're wrong about. Roll or cut, never add." },
  { category: "risk", title: "Don't trade unfamiliar tickers", body: "First-time trade on a thinly-traded biotech is a gift to market makers. Stick to names you've watched for weeks." },
  { category: "risk", title: "Don't hold expiring OTM into Friday close", body: "If your long option is OTM at 3pm Friday, the math says close it for whatever's left rather than gamble on a 0% PoP." },

  // ── Quick wins ────────────────────────────────────────────
  { category: "strategy", title: "Wheel strategy in one breath", body: "Sell CSP → assigned → sell covered call → called away → repeat. Income on stocks you'd own anyway." },
  { category: "strategy", title: "Poor man's covered call", body: "Long deep-ITM LEAPS call + short near-dated OTM call. Capital-efficient version of the covered call." },
  { category: "strategy", title: "Protective put as insurance", body: "Long stock + long OTM put = floor on losses. Costs premium but lets you hold conviction names through volatility." },
  { category: "strategy", title: "Collar strategy", body: "Long stock + long put + short call = defined range. Free or near-free hedge for concentrated positions." },
  { category: "strategy", title: "Diagonal spread for trends", body: "Long longer-dated ITM call + short shorter-dated OTM call. Trends + theta in one package." },
  { category: "options", title: "Synthetic long stock", body: "Long ATM call + short ATM put = same payoff as 100 shares but with much less capital. Great for portfolio margin accounts." },
  { category: "options", title: "Risk reversal", body: "Short OTM put + long OTM call = bullish, often free. Just remember the assignment risk on the put side." },
];

export function TipsRotator({ className }: { className?: string }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % TIPS.length);
      setFadeKey((k) => k + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const next = () => {
    setIndex((i) => (i + 1) % TIPS.length);
    setFadeKey((k) => k + 1);
  };

  const tip = TIPS[index];
  const catColor: Record<TipCategory, string> = {
    app: "text-primary border-primary/40 bg-primary/10",
    options: "text-bullish border-bullish/40 bg-bullish/10",
    risk: "text-bearish border-bearish/40 bg-bearish/10",
    strategy: "text-foreground border-border bg-muted/40",
    psychology: "text-neutral border-neutral/40 bg-neutral/10",
  };

  return (
    <Card className={cn("glass-card p-5 overflow-hidden", className)}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          Nova's Knowledge Drop
          <Sparkles className="h-3 w-3 text-primary/60" />
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {index + 1} / {TIPS.length}
          </span>
          <button
            onClick={next}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            aria-label="Next tip"
          >
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div key={fadeKey} className="animate-fade-in space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-widest", catColor[tip.category])}>
            {tip.category}
          </span>
          <h3 className="text-sm font-semibold text-foreground">{tip.title}</h3>
        </div>
        <p className="text-sm text-foreground/85 leading-relaxed">{tip.body}</p>
      </div>

      <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Auto-rotates every 60 seconds</span>
        <span>{TIPS.length}+ tips loaded</span>
      </div>
    </Card>
  );
}
