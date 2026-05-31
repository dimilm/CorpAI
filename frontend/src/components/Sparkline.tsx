import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";

import { useChartTheme } from "../hooks/useChartTheme";

export type SparklineDirection = "up" | "down" | "flat";

export interface SparklineGeometry {
  /** Tight `[low, high]` Y-domain that makes the series fill the cell. */
  domain: [number, number];
  /** First value — the baseline the reference line is drawn at. */
  first: number;
  /** Latest value. */
  last: number;
  /** Sign of `last - first`, used to colour the line. */
  direction: SparklineDirection;
}

/** Derives a tight Y-domain and trend direction from a value series.
 *
 *  A 0-based axis collapses a narrow band (e.g. prices 100–120, or job
 *  counts 40–48) into a sliver, so every series looks flat. Anchoring the
 *  domain to `min/max` (with 15 % padding, floored at 1) lets the actual
 *  swing use the full height; a perfectly flat series stays centred.
 *  Caller must pass ≥1 value. */
export function sparklineGeometry(values: number[]): SparklineGeometry {
  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const pad = Math.max(1, (max - min) * 0.15);
  const first = values[0];
  const last = values[values.length - 1];
  const direction: SparklineDirection =
    last > first ? "up" : last < first ? "down" : "flat";
  return { domain: [min - pad, max + pad], first, last, direction };
}

interface SparkDotProps {
  cx?: number;
  cy?: number;
  index?: number;
}

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

/** Tiny axis-less recharts area for table cells. Renders a value series with:
 *    - a tight Y-domain (see {@link sparklineGeometry}) so swings are visible,
 *    - a green/red stroke keyed to the start→end direction,
 *    - a faint fill and a baseline marking the starting value,
 *    - a single dot on the latest point.
 *  Caller must guarantee ≥2 values; with fewer, recharts renders an empty box.
 *  Decorative — wrap it in a tooltip/`aria` context for the textual values. */
export function Sparkline({ values, width = 112, height = 34 }: SparklineProps) {
  const theme = useChartTheme();
  if (values.length < 2) return null;

  const { domain, first, direction } = sparklineGeometry(values);
  const color =
    direction === "up"
      ? theme.lineUp
      : direction === "down"
        ? theme.lineDown
        : theme.line;
  const gradientId = `spark-${direction}`;
  const data = values.map((value, i) => ({ i, value }));
  const lastIndex = data.length - 1;

  return (
    <div className="sparkline" style={{ width, height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 3, right: 4, bottom: 3, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Hidden axis pins the series to a tight [min, max] domain so swings
              fill the cell instead of hugging a 0-based baseline. */}
          <YAxis hide domain={domain} />
          <ReferenceLine
            y={first}
            stroke={theme.grid}
            strokeDasharray="2 2"
            strokeWidth={1}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            baseValue="dataMin"
            dot={(props: SparkDotProps) => {
              const { cx, cy, index } = props;
              if (index !== lastIndex || cx == null || cy == null) {
                // recharts requires an SVG node per data point.
                return <g key={`spark-dot-${index}`} />;
              }
              return (
                <circle
                  key={`spark-dot-${index}`}
                  cx={cx}
                  cy={cy}
                  r={2.5}
                  fill={color}
                  stroke="none"
                />
              );
            }}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default Sparkline;
