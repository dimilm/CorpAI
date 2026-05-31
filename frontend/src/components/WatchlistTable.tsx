import { Link } from "react-router-dom";

import { Stock } from "../types";
import {
  changeClass,
  ColorThresholds,
  defaultThresholds,
  dividendClass,
  targetClass,
} from "../lib/colorRules";
import { formatNumber, formatPercent, trendArrow } from "../lib/format";
import { tagColorClass } from "../lib/tagColor";
import { AIPillRow } from "./ai/AIPillRow";
import { HoverTooltip } from "./HoverTooltip";
import { JobsSparkline } from "./jobs/JobsSparkline";
import { PriceSparkline } from "./PriceSparkline";
import RowActionsMenu from "./RowActionsMenu";
import type { JobsTrendPoint } from "../hooks/useJobsTrendsAggregate";
import type { PriceTrendPoint } from "../hooks/useStockPriceTrends";

const MAX_VISIBLE_TAGS = 3;

export interface JobsAggregate {
  latest: number | null;
  delta_7d: number | null;
}

interface Props {
  stocks: Stock[];
  sortBy: string;
  sortDir: "asc" | "desc";
  thresholds?: ColorThresholds;
  onSort: (key: string) => void;
  onRefresh: (isin: string) => Promise<void>;
  onEdit: (stock: Stock) => void;
  onDelete: (stock: Stock) => Promise<void>;
  refreshDisabled?: boolean;
  // Per-ISIN aggregated job counts (latest + Δ7T). Optional because the
  // data may not have loaded yet — cells fall back to "-" until present.
  jobsByIsin?: Record<string, JobsAggregate>;
  // Per-ISIN 90-day trend timeseries powering the sparkline. Optional for
  // the same reason; cells render the count without a chart when fewer
  // than 2 points are available.
  trendsByIsin?: Record<string, JobsTrendPoint[]>;
  // Per-ISIN 12-month monthly close-price series powering the Kurs 12M
  // sparkline. Optional: cells fall back to a dash until loaded / when a
  // stock has no cached price history yet.
  pricesByIsin?: Record<string, PriceTrendPoint[]>;
}

/** Rich tooltip body for the Stellen cell: the latest count plus the
 *  short-term Δ7T (colour-keyed) and the 90-day min/max band. Mirrors
 *  {@link TrendTooltip}'s styling; together the two columns read as
 *  "short-term move" (here) vs. "90-day trend" (Trend column). */
function JobsTooltip({
  latest,
  delta7d,
  points,
}: {
  latest: number;
  delta7d: number | null;
  points: JobsTrendPoint[] | undefined;
}) {
  let minMax: string | null = null;
  if (points && points.length >= 2) {
    let min = points[0].count;
    let max = points[0].count;
    for (const p of points) {
      if (p.count < min) min = p.count;
      if (p.count > max) max = p.count;
    }
    minMax = `${min} / ${max}`;
  }
  const deltaClass =
    delta7d == null || delta7d === 0
      ? ""
      : delta7d > 0
        ? "delta-up"
        : "delta-down";
  const deltaStr =
    delta7d == null ? null : delta7d > 0 ? `+${delta7d}` : `${delta7d}`;
  return (
    <span className="trend-tip">
      <span className="trend-tip-head">Offene Stellen</span>
      <span className="trend-tip-range">Aktuell: {latest}</span>
      {deltaStr != null && (
        <span className={`trend-tip-delta ${deltaClass}`.trim()}>
          Δ 7T: {deltaStr}
        </span>
      )}
      {minMax && <span className="trend-tip-sub">90 T min/max: {minMax}</span>}
    </span>
  );
}

/** Rich tooltip body for the Kurs 12M sparkline: start→end close prices and
 *  the 12-month % change, colour-keyed to direction. Caller guarantees ≥2
 *  points. */
function PriceTooltip({
  points,
  currency,
}: {
  points: PriceTrendPoint[];
  currency: string | null;
}) {
  const first = points[0].close;
  const last = points[points.length - 1].close;
  const delta = last - first;
  const fmt = (v: number) =>
    v.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const unit = currency ? ` ${currency}` : "";
  let pctStr: string;
  if (first === 0) {
    pctStr = "n. v.";
  } else {
    const pct = (delta / first) * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "±";
    pctStr = `${sign}${Math.abs(pct).toLocaleString("de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} %`;
  }
  const deltaClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "";
  return (
    <span className="trend-tip">
      <span className="trend-tip-head">Kurs · 12 Monate</span>
      <span className="trend-tip-range">
        {fmt(first)} → {fmt(last)}
        {unit}
      </span>
      <span className={`trend-tip-delta ${deltaClass}`.trim()}>{pctStr}</span>
    </span>
  );
}

/** Rich tooltip body for the (axis-less) Trend sparkline: the whole-period
 *  swing the micro-chart's shape implies but can't quantify — start→end,
 *  absolute Δ and % of the starting value, colour-keyed to direction.
 *  Complements the Stellen cell's Δ7T (short-term). Caller guarantees ≥2
 *  points. */
function TrendTooltip({ points }: { points: JobsTrendPoint[] }) {
  const first = points[0].count;
  const last = points[points.length - 1].count;
  const delta = last - first;
  const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
  let pctStr: string;
  if (first === 0) {
    pctStr = "n. v.";
  } else {
    const pct = (delta / first) * 100;
    const formatted = Math.abs(pct).toLocaleString("de-DE", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "±";
    pctStr = `${sign}${formatted} %`;
  }
  const deltaClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "";
  return (
    <span className="trend-tip">
      <span className="trend-tip-head">90 Tage</span>
      <span className="trend-tip-range">
        {first} → {last}
      </span>
      <span className={`trend-tip-delta ${deltaClass}`.trim()}>
        {deltaStr} ({pctStr})
      </span>
    </span>
  );
}

function SortHeader({
  label,
  keyName,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  keyName: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}) {
  const marker = sortBy === keyName ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th className={className}>
      <button type="button" onClick={() => onSort(keyName)}>
        {label}
        {marker}
      </button>
    </th>
  );
}

export default function WatchlistTable({
  stocks,
  sortBy,
  sortDir,
  thresholds = defaultThresholds,
  onSort,
  onRefresh,
  onEdit,
  onDelete,
  refreshDisabled = false,
  jobsByIsin,
  trendsByIsin,
  pricesByIsin,
}: Props) {
  return (
    <div className="table-scroll">
    <table className="watchlist-table" aria-label="Watchlist der beobachteten Aktien">
      <thead>
        <tr>
          <SortHeader label="ISIN" keyName="isin" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Name" keyName="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Sektor" keyName="sector" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <th>Tags</th>
          <SortHeader label="Tranchen" keyName="tranches" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="num-cell" />
          <SortHeader label="Kurs" keyName="current_price" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="num-cell" />
          <th className="num-cell">Kurs 12M</th>
          <SortHeader label="Tagesänd. (%)" keyName="day_change_pct" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="num-cell" />
          <SortHeader label="Kursziel (%)" keyName="analyst_target_distance_pct" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="num-cell" />
          <SortHeader label="Div. (%)" keyName="dividend_yield_current" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="num-cell" />
          <th className="num-cell">Trend</th>
          <th className="num-cell">Stellen</th>
          <SortHeader label="Status" keyName="last_status" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <th>KI</th>
          <th className="actions-header" aria-label="Aktionen" />
        </tr>
      </thead>
      <tbody>
        {stocks.map((s) => (
          <tr key={s.isin}>
            <td>{s.isin}</td>
            <td>
              <Link to={`/stocks/${s.isin}`} className="stock-name-link">
                {s.name}
              </Link>
            </td>
            <td>{s.sector ?? "-"}</td>
            <td>
              {s.tags && s.tags.length > 0 ? (
                <span className="tag-list">
                  {s.tags.slice(0, MAX_VISIBLE_TAGS).map((t) => (
                    <span key={t} className={`tag-pill tag-pill-sm ${tagColorClass(t)}`}>
                      {t}
                    </span>
                  ))}
                  {s.tags.length > MAX_VISIBLE_TAGS && (
                    <span
                      className="tag-pill tag-pill-sm tag-pill-overflow"
                      title={s.tags.slice(MAX_VISIBLE_TAGS).join(", ")}
                    >
                      +{s.tags.length - MAX_VISIBLE_TAGS}
                    </span>
                  )}
                </span>
              ) : (
                "-"
              )}
            </td>
            <td className="num-cell">{s.tranches}</td>
            <td className="num-cell">{formatNumber(s.current_price)}</td>
            <td className="num-cell">
              {(() => {
                const pricePoints = pricesByIsin?.[s.isin];
                if (!pricePoints || pricePoints.length < 2) return "–";
                return (
                  <HoverTooltip
                    className="jobs-sparkline-cell"
                    content={
                      <PriceTooltip points={pricePoints} currency={s.currency} />
                    }
                  >
                    <PriceSparkline points={pricePoints} />
                  </HoverTooltip>
                );
              })()}
            </td>
            <td className="num-cell">
              <span className={changeClass(s.day_change_pct, thresholds)}>
                {trendArrow(s.day_change_pct) && (
                  <span className="trend-arrow" aria-hidden="true">
                    {trendArrow(s.day_change_pct)}{" "}
                  </span>
                )}
                {formatPercent(s.day_change_pct, 2, { withUnit: false })}
              </span>
            </td>
            <td className="num-cell">
              <span className={targetClass(s.analyst_target_distance_pct, thresholds)}>
                {formatPercent(s.analyst_target_distance_pct, 2, { withUnit: false })}
              </span>
            </td>
            <td className="num-cell">
              <span className={dividendClass(s.dividend_yield_current, thresholds)}>
                {formatPercent(s.dividend_yield_current, 2, { withUnit: false, showSign: false })}
              </span>
            </td>
            <td className="num-cell">
              {(() => {
                const trendPoints = trendsByIsin?.[s.isin];
                if (!trendPoints || trendPoints.length < 2) return "–";
                return (
                  <HoverTooltip
                    className="jobs-sparkline-cell"
                    content={<TrendTooltip points={trendPoints} />}
                  >
                    <JobsSparkline points={trendPoints} />
                  </HoverTooltip>
                );
              })()}
            </td>
            <td className="num-cell">
              {(() => {
                const aggregate = jobsByIsin?.[s.isin];
                if (!aggregate || aggregate.latest == null) return "–";
                const trendPoints = trendsByIsin?.[s.isin];
                return (
                  <HoverTooltip
                    className="jobs-sparkline-cell"
                    content={
                      <JobsTooltip
                        latest={aggregate.latest}
                        delta7d={aggregate.delta_7d}
                        points={trendPoints}
                      />
                    }
                  >
                    <span className="jobs-sparkline-cell-value">
                      {aggregate.latest}
                      {aggregate.delta_7d != null && aggregate.delta_7d !== 0 ? (
                        <span
                          className={aggregate.delta_7d > 0 ? "delta-up" : "delta-down"}
                          style={{ marginLeft: "0.25em" }}
                        >
                          {aggregate.delta_7d > 0 ? "↑" : "↓"}
                        </span>
                      ) : null}
                    </span>
                  </HoverTooltip>
                );
              })()}
            </td>
            <td>{s.last_status ?? "-"}</td>
            <td className="ai-pills-cell">
              <AIPillRow stock={s} />
            </td>
            <td className="actions-cell">
              <RowActionsMenu
                stock={s}
                onRefresh={onRefresh}
                onEdit={onEdit}
                onDelete={onDelete}
                refreshDisabled={refreshDisabled}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
