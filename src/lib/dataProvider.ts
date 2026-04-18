// Routes UI to data providers. Live = Lovable Cloud edge function with Massive + Alpha Vantage verification.
import { supabase } from "@/integrations/supabase/client";
import { getMockQuotes, getMockPicks, TICKER_UNIVERSE, type Quote, type OptionPick } from "./mockData";

export type ProviderName = "mock" | "live";

export interface DataProvider {
  name: ProviderName;
  getQuotes(symbols?: string[]): Promise<Quote[]>;
  getPicks(): Promise<OptionPick[]>;
}

const mockProvider: DataProvider = {
  name: "mock",
  async getQuotes() { return getMockQuotes(); },
  async getPicks() { return getMockPicks(80); },
};

type VerifiedQuote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  primary: number | null;
  secondary: number | null;
  status: Quote["status"];
  diffPct: number | null;
  updatedAt: string;
};

const liveProvider: DataProvider = {
  name: "live",
  async getQuotes(symbols?: string[]) {
    const universe = TICKER_UNIVERSE;
    const wanted = symbols && symbols.length ? symbols : universe.map((u) => u.symbol);
    const meta = new Map(universe.map((u) => [u.symbol, u]));

    const { data, error } = await supabase.functions.invoke("quotes-fetch", {
      body: { symbols: wanted },
    });
    if (error) {
      console.error("[live] quotes-fetch failed, falling back to mock:", error);
      return getMockQuotes();
    }
    const quotes: VerifiedQuote[] = data?.quotes ?? [];
    return quotes.map((q): Quote => {
      const m = meta.get(q.symbol);
      const trend = q.changePct > 0.4 ? "bullish" : q.changePct < -0.4 ? "bearish" : "neutral";
      return {
        symbol: q.symbol,
        name: m?.name ?? q.symbol,
        sector: m?.sector,
        marketCap: m?.marketCap,
        price: q.price,
        change: q.change,
        changePct: q.changePct,
        volume: q.volume,
        trend,
        source: "massive",
        status: q.status,
        updatedAt: q.updatedAt,
      };
    });
  },
  async getPicks() {
    // Options chains from Massive will be wired next; keep mock picks for now so Scanner stays populated.
    return getMockPicks(80);
  },
};

const providerName = (import.meta.env.VITE_DATA_PROVIDER ?? "live") as ProviderName;
export const provider: DataProvider = providerName === "mock" ? mockProvider : liveProvider;
