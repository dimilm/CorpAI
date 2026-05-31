import { Sparkline } from "./Sparkline";
import type { PriceTrendPoint } from "../hooks/useStockPriceTrends";

interface PriceSparklineProps {
  points: PriceTrendPoint[];
  width?: number;
  height?: number;
}

/** Watchlist `Kurs 12M` column sparkline: the monthly close-price series.
 *  Thin adapter over the shared {@link Sparkline}; the cell's tooltip carries
 *  the textual values. Caller must guarantee ≥2 points. */
export function PriceSparkline({ points, width, height }: PriceSparklineProps) {
  if (points.length < 2) return null;
  return (
    <Sparkline
      values={points.map((p) => p.close)}
      width={width}
      height={height}
    />
  );
}

export default PriceSparkline;
