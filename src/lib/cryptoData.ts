// Top cryptocurrencies via CoinGecko free public API (no key, ~30 calls/min cap).
import { useQuery } from "@tanstack/react-query";

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number | null;
  total_volume: number;
}

async function fetchTopCoins(limit: number): Promise<Coin[]> {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  const data = (await r.json()) as Coin[];
  return data;
}

export function useTopCoins(limit = 10) {
  return useQuery({
    queryKey: ["top-coins", limit],
    queryFn: () => fetchTopCoins(limit),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: 2,
  });
}
