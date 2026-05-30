import { Sparkline } from "../Sparkline";
import type { JobsTrendPoint } from "../../hooks/useJobsTrendsAggregate";

interface JobsSparklineProps {
  points: JobsTrendPoint[];
  width?: number;
  height?: number;
}

/** Watchlist `Trend` column sparkline: the 90-day job-count series. Thin
 *  adapter over the shared {@link Sparkline}; the Stellen cell's tooltip
 *  carries the textual values. Caller must guarantee ≥2 points. */
export function JobsSparkline({ points, width, height }: JobsSparklineProps) {
  if (points.length < 2) return null;
  return (
    <Sparkline
      values={points.map((p) => p.count)}
      width={width}
      height={height}
    />
  );
}

export default JobsSparkline;
