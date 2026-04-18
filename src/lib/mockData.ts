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
  strategy: "covered-call" | "csp" | "long-call" | "long-put" | "wheel" | "leaps";
  riskBucket: "safe" | "mild" | "aggressive";
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

const universe: Array<OptionPick<Quote, "symbol" | "name" | "sector" | "marketCap"> & { base: number }> = [
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

const STRATS: OptionPick["strategy"][] = ["covered-call", "csp", "long-call", "long-put", "wheel", "leaps"];
const REASONS = [
  "Premium-selling candidate: IV elevated vs realized vol.",
  "Bullish trend: above 20/50 EMA, MACD positive.",
  "Sympathy setup: sector leader broke out today.",
  "Caution: earnings within 2 sessions — IV crush risk.",
  "Wheel-friendly: blue chip, deep liquidity, stable theta.",
  "LEAPS opportunity: cheap vol, structural uptrend.",
];

export function getMockPicks(count = 60): OptionPick[] {
  const quotes = getMockQuotes();
  const picks: OptionPick[] = [];
  quotes.forEach((q) => {
    const r = seed(q.symbol + "p");
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n && picks.length < count; i++) {
      const dte = [7, 14, 30, 45, 60, 180, 365][Math.floor(r() * 7)];
      const strategy = STRATS[Math.floor(r() * STRATS.length)];
      const isCall = strategy.includes("call") || strategy === "wheel" || strategy === "leaps";
      const moneyness = (r() - 0.5) * 0.1;
      const strike = +(q.price * (1 + moneyness)).toFixed(0);
      const premium = +(q.price * (0.005 + r() * 0.04)).toFixed(2);
      const premiumPct = +((premium / strike) * 100).toFixed(2);
      const annualized = +((premiumPct * 365) / dte).toFixed(1);
      const score = Math.floor(45 + r() * 55);
      const confidence: OptionPick["confidence"] = score > 80 ? "A" : score > 65 ? "B" : "C";
      const riskBucket: OptionPick["riskBucket"] = score > 75 ? "safe" : score > 60 ? "mild" : "aggressive";
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
        delta: +((isCall ? 0.2 + r() * 0.5 : -(0.2 + r() * 0.5))).toFixed(2),
        theta: +(-0.02 - r() * 0.08).toFixed(3),
        vega: +(0.05 + r() * 0.2).toFixed(3),
        ivRank: q.ivRank ?? 50,
        oi: Math.floor(500 + r() * 20000),
        volume: Math.floor(100 + r() * 8000),
        spreadPct: +(0.5 + r() * 4).toFixed(2),
        score,
        confidence,
        bias: q.trend ?? "neutral",
        signals: [
          q.trend === "bullish" ? "EMA20>EMA50" : q.trend === "bearish" ? "EMA20<EMA50" : "EMA flat",
          (q.ivRank ?? 50) > 50 ? "IVR high" : "IVR low",
          `RSI ${q.rsi}`,
          `OI ${(500 + r() * 20000).toFixed(0)}`,
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
