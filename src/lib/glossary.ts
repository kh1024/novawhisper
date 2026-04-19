// Centralized plain-English explanations for every badge / verdict / label
// that appears across the app. Surface these via the <Hint> tooltip wrapper
// so users can hover any chip and instantly understand what it means.

export const VERDICT_HINT: Record<string, string> = {
  GO: "GO — All signals align. The setup, options chain, and risk picture say take the trade now (or scale in).",
  WAIT: "WAIT — Setup is forming but not confirmed. Mixed signals; let it develop before committing capital.",
  NO: "NO — Don't enter. Either the score is too low, the chart is broken, or premium is wrong for the move.",
  EXIT: "EXIT — You hold this position and the engine is telling you to close it now (stop hit, trend broke, or theta is bleeding faster than the move can recover).",
  NEUTRAL: "NEUTRAL — No clear directional edge right now. Bias and momentum cancel out; better setups exist elsewhere.",
  BLOCKED: "BLOCKED — A NOVA Guard (e.g. price below 200-SMA for a long call) overrode the GO signal. The trade is filtered out for safety.",
};

export const BIAS_HINT: Record<string, string> = {
  bullish: "Bullish — Trend, momentum, and breadth point UP. Calls or bull call spreads are the natural structure.",
  bearish: "Bearish — Trend, momentum, and breadth point DOWN. Puts or bear put spreads are the natural structure.",
  neutral: "Neutral / Range — No clear directional edge. Stock is chopping in a range; iron condors or staying flat make more sense than directional bets.",
  reversal: "Reversal — Setup suggests the prior trend is exhausting and the next leg flips direction. Higher conviction, but timing matters more.",
};

export const ACTION_HINT: Record<string, string> = {
  BUY: "BUY — High conviction (score ≥ 80). Take the trade now per the playbook.",
  WATCHLIST: "WATCHLIST — Solid setup (score 65–79). Wait for a clean trigger (break of level, volume confirm) before entering.",
  WAIT: "WAIT — Mixed signals (score 50–64). Monitor and revisit; do not enter yet.",
  "DON'T BUY": "DON'T BUY — No edge (score < 50). Skip this one entirely.",
};

export const RISK_HINT: Record<string, string> = {
  Safe: "Safe — Premium aligns with the underlying move; max-loss is small relative to expected reward.",
  Mild: "Mild — Some risk flags (e.g. premium slightly rich, IV elevated). Position-size accordingly.",
  Aggressive: "Aggressive — Lottery-ticket pricing or high IV. Treat as a small-allocation, high-conviction-only trade.",
};

export const READINESS_HINT: Record<string, string> = {
  ELITE: "ELITE — Final rank ≥ 90. Best-in-class setup right now.",
  "GO NOW": "GO NOW — Final rank ≥ 80. Trigger and confirmation aligned; act per the playbook.",
  GOOD: "GOOD — Final rank ≥ 70. Clean setup, take it if it fits your sizing.",
  WATCHLIST: "WATCHLIST — Final rank ≥ 60. Promising but needs more confirmation.",
  AVOID: "AVOID — Final rank < 60. Too many red flags; skip.",
};
