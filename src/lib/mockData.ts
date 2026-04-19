// Mock data layer — structured to be swapped for real Massive / Alpha Vantage providers.
// Each entity matches the data model documented in the product spec.

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap?: number;
  sector?: string;
  iv?: number; // implied vol
  ivRank?: number;
  rsi?: number;
  trend?: "bullish" | "bearish" | "neutral";
  source?: "massive" | "alpha-vantage" | "mock";
  status?: "verified" | "close" | "mismatch" | "stale" | "unavailable";
  updatedAt?: string;
};

export type OptionPick = {
  id: string;
  symbol: string;
  // App is BUY-PREMIUM ONLY. No short premium / income strategies are emitted.
  // - long-call / long-put: standard directional buys (14-90 DTE)
  // - leaps-call / leaps-put: long-dated thesis trades (>180 DTE)
  // Legacy values ("covered-call" | "csp" | "wheel" | "leaps") remain in the
  // type union for back-compat with persisted rows but are NEVER produced.
  strategy: "long-call" | "long-put" | "leaps-call" | "leaps-put" | "covered-call" | "csp" | "wheel" | "leaps";
  // riskBucket buckets the trade. "lottery" = tiny-size, high-IV, ≤30 DTE.
  // "mild" is the legacy alias for "moderate" — kept for Planning.tsx etc.
  riskBucket: "safe" | "mild" | "aggressive" | "lottery";
  expiration: string;
  dte: number;
  strike: number;
  premium: number;
  premiumPct: number;
  annualized: number;
  delta: number;
  theta: number;
  vega: number;
  ivRank: number;
  oi: number;
  volume: number;
  spreadPct: number;
  score: number;
  confidence: "A" | "B" | "C";
  bias: "bullish" | "bearish" | "neutral";
  signals: string[];
  reason: string;
  earningsInDays?: number;
};

const seed = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return (h % 10000) / 10000;
  };
};

type UniverseEntry = Pick<Quote, "symbol" | "name" | "sector" | "marketCap"> & { base: number };
const universe: UniverseEntry[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF", base: 478 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", sector: "ETF", base: 425 },
  { symbol: "DIA", name: "SPDR Dow Jones ETF", sector: "ETF", base: 384 },
  { symbol: "IWM", name: "iShares Russell 2000", sector: "ETF", base: 198 },
  { symbol: "XLK", name: "Tech Select Sector", sector: "ETF", base: 218 },
  { symbol: "XLF", name: "Financial Select Sector", sector: "ETF", base: 41 },
  { symbol: "XLE", name: "Energy Select Sector", sector: "ETF", base: 92 },
  { symbol: "SMH", name: "VanEck Semiconductors", sector: "ETF", base: 248 },
  { symbol: "AAPL", name: "Apple Inc.", sector: "Tech", marketCap: 3.4e12, base: 224 },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Tech", marketCap: 3.1e12, base: 418 },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Semis", marketCap: 3.2e12, base: 138 },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Semis", marketCap: 2.4e11, base: 152 },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Tech", marketCap: 2.0e12, base: 188 },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Tech", marketCap: 2.1e12, base: 172 },
  { symbol: "META", name: "Meta Platforms", sector: "Tech", marketCap: 1.4e12, base: 562 },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Auto", marketCap: 8.5e11, base: 248 },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", marketCap: 6.0e11, base: 218 },
  { symbol: "BAC", name: "Bank of America", sector: "Financials", marketCap: 3.2e11, base: 42 },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", marketCap: 4.5e11, base: 116 },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy", marketCap: 2.8e11, base: 158 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", marketCap: 3.7e11, base: 156 },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Healthcare", marketCap: 1.6e11, base: 28 },
  { symbol: "TSM", name: "Taiwan Semiconductor", sector: "Semis", marketCap: 9.0e11, base: 184 },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Semis", marketCap: 7.5e11, base: 168 },
  { symbol: "ARM", name: "Arm Holdings", sector: "Semis", marketCap: 1.4e11, base: 132 },
  // ── Expanded universe — surfaces more tickers whenever they fit setup criteria ──
  { symbol: "MU", name: "Micron Technology", sector: "Semis", marketCap: 1.2e11, base: 108 },
  { symbol: "INTC", name: "Intel Corp.", sector: "Semis", marketCap: 1.3e11, base: 31 },
  { symbol: "QCOM", name: "Qualcomm Inc.", sector: "Semis", marketCap: 1.9e11, base: 168 },
  { symbol: "MRVL", name: "Marvell Technology", sector: "Semis", marketCap: 6.8e10, base: 78 },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Tech", marketCap: 3.2e11, base: 712 },
  { symbol: "CRM", name: "Salesforce Inc.", sector: "Tech", marketCap: 2.8e11, base: 286 },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Tech", marketCap: 4.5e11, base: 162 },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Tech", marketCap: 2.4e11, base: 528 },
  { symbol: "PLTR", name: "Palantir Technologies", sector: "Tech", marketCap: 1.6e11, base: 72 },
  { symbol: "SHOP", name: "Shopify Inc.", sector: "Tech", marketCap: 1.4e11, base: 108 },
  { symbol: "UBER", name: "Uber Technologies", sector: "Tech", marketCap: 1.5e11, base: 72 },
  { symbol: "COIN", name: "Coinbase Global", sector: "Financials", marketCap: 6.5e10, base: 268 },
  { symbol: "GS", name: "Goldman Sachs", sector: "Financials", marketCap: 1.6e11, base: 502 },
  { symbol: "MS", name: "Morgan Stanley", sector: "Financials", marketCap: 1.7e11, base: 108 },
  { symbol: "WFC", name: "Wells Fargo", sector: "Financials", marketCap: 2.4e11, base: 72 },
  { symbol: "V", name: "Visa Inc.", sector: "Financials", marketCap: 5.6e11, base: 282 },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financials", marketCap: 4.8e11, base: 512 },
  { symbol: "OXY", name: "Occidental Petroleum", sector: "Energy", marketCap: 4.6e10, base: 49 },
  { symbol: "SLB", name: "Schlumberger", sector: "Energy", marketCap: 5.8e10, base: 41 },
  { symbol: "LLY", name: "Eli Lilly", sector: "Healthcare", marketCap: 7.4e11, base: 782 },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare", marketCap: 5.2e11, base: 562 },
  { symbol: "MRK", name: "Merck & Co.", sector: "Healthcare", marketCap: 2.6e11, base: 102 },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Healthcare", marketCap: 3.2e11, base: 182 },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer", marketCap: 6.5e11, base: 81 },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer", marketCap: 4.2e11, base: 938 },
  { symbol: "HD", name: "Home Depot", sector: "Consumer", marketCap: 3.6e11, base: 362 },
  { symbol: "NKE", name: "Nike Inc.", sector: "Consumer", marketCap: 1.1e11, base: 72 },
  { symbol: "MCD", name: "McDonald's Corp.", sector: "Consumer", marketCap: 2.1e11, base: 292 },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Consumer", marketCap: 1.9e11, base: 102 },
  { symbol: "BA", name: "Boeing Co.", sector: "Industrials", marketCap: 1.2e11, base: 168 },
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials", marketCap: 1.7e11, base: 352 },
  { symbol: "GE", name: "General Electric", sector: "Industrials", marketCap: 1.9e11, base: 172 },
  { symbol: "RIVN", name: "Rivian Automotive", sector: "Auto", marketCap: 1.4e10, base: 14 },
  { symbol: "F", name: "Ford Motor Co.", sector: "Auto", marketCap: 4.4e10, base: 11 },
  { symbol: "GM", name: "General Motors", sector: "Auto", marketCap: 5.1e10, base: 47 },
  { symbol: "GLD", name: "SPDR Gold Trust", sector: "ETF", base: 248 },
  { symbol: "TLT", name: "20+ Year Treasury ETF", sector: "ETF", base: 92 },
  { symbol: "ARKK", name: "ARK Innovation ETF", sector: "ETF", base: 58 },
  { symbol: "SOXL", name: "Direxion Semis Bull 3x", sector: "ETF", base: 28 },
] as any;

export const TICKER_UNIVERSE = universe;

export function getMockQuotes(): Quote[] {
  return universe.map((u) => {
    const r = seed(u.symbol + "q");
    const drift = (r() - 0.5) * 0.06;
    const price = +(u.base * (1 + drift)).toFixed(2);
    const change = +(price - u.base).toFixed(2);
    const changePct = +((change / u.base) * 100).toFixed(2);
    const trend = changePct > 0.4 ? "bullish" : changePct < -0.4 ? "bearish" : "neutral";
    return {
      symbol: u.symbol,
      name: u.name,
      sector: u.sector,
      marketCap: u.marketCap,
      price,
      change,
      changePct,
      volume: Math.floor(r() * 8e7 + 1e6),
      iv: +(20 + r() * 50).toFixed(1),
      ivRank: Math.floor(r() * 100),
      rsi: Math.floor(40 + r() * 35),
      trend,
      source: "mock",
      status: r() > 0.08 ? "verified" : "stale",
      updatedAt: new Date().toISOString(),
    };
  });
}

// Buy-premium-only strategy palette. Long calls + long puts dominate; LEAPS
// surface as a smaller share for long-thesis trades. Short premium structures
// (covered call / CSP / wheel) are intentionally OFF.
const STRATS: OptionPick["strategy"][] = [
  "long-call", "long-call", "long-call",
  "long-put", "long-put",
  "leaps-call",
  "leaps-put",
];
const REASONS = [
  "Bullish trend continuation: above 20/50 EMA, MACD positive, rel-vol 1.4×.",
  "Pullback to support inside an uptrend — defined-risk long call.",
  "Breakdown setup: failed retest of 20-EMA on rising volume — long put.",
  "LEAPS opportunity: cheap IV vs HV, structural multi-quarter uptrend.",
  "Catalyst-driven: earnings 5-10 sessions out, IV still fair for premium buy.",
  "Momentum breakout from base — aggressive ATM long call into rel-strength.",
];

export function getMockPicks(count = 60): OptionPick[] {
  const quotes = getMockQuotes();
  const picks: OptionPick[] = [];
  quotes.forEach((q) => {
    const r = seed(q.symbol + "p");
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n && picks.length < count; i++) {
      const strategy = STRATS[Math.floor(r() * STRATS.length)];
      const isLeaps = strategy === "leaps-call" || strategy === "leaps-put";
      const isPut = strategy === "long-put" || strategy === "leaps-put";
      const isCall = !isPut;
      // DTE depends on strategy. Lottery picks come out of long-call/put with
      // the shortest DTE bucket below.
      const dte = isLeaps
        ? [365, 540, 730][Math.floor(r() * 3)]
        : [7, 14, 21, 30, 45, 60, 90][Math.floor(r() * 7)];
      // Long premium → strike near the money (ITM/ATM/slightly OTM).
      const moneyness = (r() - 0.5) * 0.08;
      const strike = +(q.price * (1 + (isCall ? -moneyness : moneyness))).toFixed(0);
      const premium = +(q.price * (0.01 + r() * 0.05)).toFixed(2);
      const premiumPct = +((premium / strike) * 100).toFixed(2);
      const annualized = +((premiumPct * 365) / Math.max(1, dte)).toFixed(1);
      const score = Math.floor(45 + r() * 55);
      const confidence: OptionPick["confidence"] = score > 80 ? "A" : score > 65 ? "B" : "C";
      // Bucket assignment per institutional spec:
      //  • LEAPS or score ≥ 80 + DTE ≥ 60  → safe (Conservative)
      //  • Score ≥ 60 + DTE 21-90           → mild (Moderate)
      //  • DTE ≤ 14 + high IVR              → lottery (tiny size, asymmetric)
      //  • Else                             → aggressive
      let riskBucket: OptionPick["riskBucket"];
      if (isLeaps || (score >= 80 && dte >= 60)) riskBucket = "safe";
      else if (dte <= 14 && (q.ivRank ?? 50) > 55) riskBucket = "lottery";
      else if (score >= 60 && dte >= 21) riskBucket = "mild";
      else riskBucket = "aggressive";
      picks.push({
        id: `${q.symbol}-${i}-${dte}`,
        symbol: q.symbol,
        strategy,
        riskBucket,
        expiration: new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10),
        dte,
        strike,
        premium,
        premiumPct,
        annualized,
        delta: +((isCall ? 0.35 + r() * 0.45 : -(0.35 + r() * 0.45))).toFixed(2),
        theta: +(-0.02 - r() * 0.08).toFixed(3),
        vega: +(0.05 + r() * 0.2).toFixed(3),
        ivRank: q.ivRank ?? 50,
        oi: Math.floor(500 + r() * 20000),
        volume: Math.floor(100 + r() * 8000),
        spreadPct: +(0.5 + r() * 4).toFixed(2),
        score,
        confidence,
        bias: isPut ? "bearish" : isCall ? "bullish" : "neutral",
        signals: [
          isPut ? "EMA20<EMA50" : "EMA20>EMA50",
          (q.ivRank ?? 50) > 50 ? "IVR high" : "IVR low",
          `RSI ${q.rsi}`,
          isLeaps ? "LEAPS thesis" : `${dte}d`,
        ],
        reason: REASONS[Math.floor(r() * REASONS.length)],
        earningsInDays: r() > 0.7 ? Math.floor(r() * 14) : undefined,
      });
    }
  });
  return picks.sort((a, b) => b.score - a.score);
}

export const MARKET_REGIME = {
  regime: "Risk-On",
  vix: 14.8,
  vixChange: -0.42,
  trend: "Uptrend, broadening participation",
  breadth: 68,
};

export const TOP_SECTORS = [
  { name: "Semiconductors", change: 2.4 },
  { name: "Technology", change: 1.6 },
  { name: "Financials", change: 0.8 },
  { name: "Energy", change: -0.5 },
  { name: "Healthcare", change: -1.1 },
];

export const UPCOMING_EVENTS = [
  { label: "FOMC Minutes", when: "Wed 2:00 PM", risk: "high" },
  { label: "NVDA Earnings", when: "Thu AMC", risk: "high" },
  { label: "CPI Print", when: "Next Tue", risk: "medium" },
];
