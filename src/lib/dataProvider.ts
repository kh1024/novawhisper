// Stub: routes UI to data providers. Swap mock for real Massive / Alpha Vantage edge function calls.
import { getMockQuotes, getMockPicks, type Quote, type OptionPick } from "./mockData";

export type ProviderName = "mock" | "massive" | "alpha-vantage";

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

// TODO: Wire real providers via Lovable Cloud edge function once API keys are added.
// e.g. const massiveProvider: DataProvider = { ... fetch via supabase.functions.invoke('quote-fetch') }
export const provider: DataProvider = mockProvider;
