import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";

export interface PriceTrendPoint {
  date: string;
  close: number;
}

interface RawTrendPoint {
  date: string;
  close: number;
}

interface RawTrendItem {
  isin: string;
  points: RawTrendPoint[];
}

interface RawTrendsResponse {
  days: number;
  interval: string;
  items: RawTrendItem[];
}

// 12 months. Matches the column label ("Kurs 12M").
export const PRICE_TREND_DAYS = 365;

export const STOCK_PRICE_TRENDS_KEY = (days: number) =>
  ["stock-price-trends", days] as const;

/** Per-ISIN monthly close-price series powering the watchlist `Kurs 12M`
 *  sparkline column. One bulk call (mirrors `useJobsTrendsAggregate`) to avoid
 *  an N+1 fan-out. The backend serves cached `PriceHistory` only, kept warm by
 *  the refresh pipeline — an ISIN with no cached history is simply absent from
 *  the map and the column falls back to a dash. */
export function useStockPriceTrends(days = PRICE_TREND_DAYS) {
  return useQuery<Record<string, PriceTrendPoint[]>>({
    queryKey: STOCK_PRICE_TRENDS_KEY(days),
    queryFn: async () => {
      const res = await api.get("/stocks/trends", { params: { days } });
      const body = res.data as RawTrendsResponse;
      const out: Record<string, PriceTrendPoint[]> = {};
      for (const item of body.items) {
        out[item.isin] = item.points.map((p) => ({
          date: p.date,
          close: p.close,
        }));
      }
      return out;
    },
    staleTime: 60_000,
  });
}
