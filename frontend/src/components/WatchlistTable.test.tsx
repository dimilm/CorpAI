import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import WatchlistTable from "./WatchlistTable";
import type { Stock } from "../types";
import type { JobsTrendPoint } from "../hooks/useJobsTrendsAggregate";

// The real `JobsSparkline` uses `recharts` `<ResponsiveContainer>` which
// relies on `ResizeObserver` — not implemented by jsdom. We don't care
// about chart geometry here; we only assert that the cell decided to
// render a sparkline (vs. the fallback). A stub with a stable test id
// keeps the assertions tight.
vi.mock("./jobs/JobsSparkline", () => ({
  JobsSparkline: ({ points }: { points: JobsTrendPoint[] }) => (
    <div data-testid="jobs-sparkline-stub" data-points={points.length} />
  ),
}));

vi.mock("./PriceSparkline", () => ({
  PriceSparkline: ({ points }: { points: { close: number }[] }) => (
    <div data-testid="price-sparkline-stub" data-points={points.length} />
  ),
}));

function makeStock(overrides: Partial<Stock> = {}): Stock {
  return {
    isin: "DE0001",
    name: "Acme AG",
    sector: "Tech",
    currency: "EUR",
    reasoning: null,
    tranches: 1,
    current_price: 100,
    day_change_pct: 1.2,
    last_updated: "2026-05-01T10:00:00",
    last_status: "ok",
    pe_forward: null,
    pe_min_5y: null,
    pe_max_5y: null,
    pe_avg_5y: null,
    dividend_yield_current: 2.5,
    dividend_yield_avg_5y: null,
    analyst_target_1y: null,
    market_cap: null,
    equity_ratio: null,
    debt_ratio: null,
    revenue_growth: null,
    missing_metrics: [],
    analyst_target_distance_pct: 5,
    invested_capital_eur: 0,
    tags: [],
    latest_ai_runs: {},
    ...overrides,
  };
}

const noop = () => {};
const asyncNoop = () => Promise.resolve();

function renderTable(props: Partial<Parameters<typeof WatchlistTable>[0]>) {
  return render(
    <MemoryRouter>
      <WatchlistTable
        stocks={[makeStock()]}
        sortBy="name"
        sortDir="asc"
        onSort={noop}
        onRefresh={asyncNoop}
        onEdit={noop}
        onDelete={asyncNoop}
        {...props}
      />
    </MemoryRouter>
  );
}

describe("WatchlistTable column structure", () => {
  it("renders 15 <th> elements in the header row", () => {
    const { container } = renderTable({});
    const headerRow = container.querySelector("thead tr");
    expect(headerRow).not.toBeNull();
    const headers = headerRow!.querySelectorAll("th");
    expect(headers).toHaveLength(15);
  });

  it("renders a 'Kurs 12M' header to the right of 'Kurs'", () => {
    const { container } = renderTable({});
    const headers = Array.from(container.querySelectorAll("thead th"));
    const kursIdx = headers.findIndex((th) => th.textContent === "Kurs");
    const kurs12mIdx = headers.findIndex((th) => th.textContent === "Kurs 12M");
    expect(kursIdx).toBeGreaterThanOrEqual(0);
    expect(kurs12mIdx).toBe(kursIdx + 1);
  });

  it("renders a 'Trend' header and a 'Stellen' header", () => {
    renderTable({});
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getByText("Stellen")).toBeInTheDocument();
  });

  it("positions 'Trend' immediately to the left of 'Stellen'", () => {
    const { container } = renderTable({});
    const headerRow = container.querySelector("thead tr");
    const headers = Array.from(headerRow!.querySelectorAll("th"));
    const trendIndex = headers.findIndex((th) => th.textContent === "Trend");
    const stellenIndex = headers.findIndex((th) => th.textContent === "Stellen");
    expect(trendIndex).toBeGreaterThanOrEqual(0);
    expect(stellenIndex).toBeGreaterThanOrEqual(0);
    expect(trendIndex).toBe(stellenIndex - 1);
  });

  it("neither 'Trend' nor 'Stellen' <th> contains a <button>", () => {
    const { container } = renderTable({});
    const headers = Array.from(container.querySelectorAll("thead th"));
    const trendTh = headers.find((th) => th.textContent === "Trend");
    const stellenTh = headers.find((th) => th.textContent === "Stellen");
    expect(trendTh).toBeDefined();
    expect(stellenTh).toBeDefined();
    expect(trendTh!.querySelector("button")).toBeNull();
    expect(stellenTh!.querySelector("button")).toBeNull();
  });
});

/**
 * Helper: returns the Trend <td> and Stellen <td> for the first data row.
 *
 * The header row has 14 <th> elements. We locate the "Trend" and "Stellen"
 * headers to derive their column indices, then pick the matching <td> cells
 * from the first body row.
 */
function getTrendAndStellenCells(container: HTMLElement) {
  const headers = Array.from(container.querySelectorAll("thead th"));
  const trendIdx = headers.findIndex((th) => th.textContent === "Trend");
  const stellenIdx = headers.findIndex((th) => th.textContent === "Stellen");

  const cells = Array.from(container.querySelectorAll("tbody tr:first-child td"));
  return {
    trendCell: cells[trendIdx] as HTMLElement,
    stellenCell: cells[stellenIdx] as HTMLElement,
  };
}

describe("WatchlistTable jobs sparkline cell", () => {
  it("always renders the Stellen column header (no toggle anymore)", () => {
    renderTable({});
    expect(screen.getByText("Stellen")).toBeInTheDocument();
    // No data yet -> the cell falls back to the dash placeholder.
    expect(screen.queryByTestId("jobs-sparkline-stub")).not.toBeInTheDocument();
  });

  it("renders the sparkline + latest count when ≥2 trend points exist", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 42, delta_7d: 3 } },
      trendsByIsin: {
        DE0001: [
          { date: "2026-04-01", count: 30 },
          { date: "2026-04-15", count: 35 },
          { date: "2026-05-01", count: 42 },
        ],
      },
    });

    const { trendCell, stellenCell } = getTrendAndStellenCells(container);

    // Sparkline stub is inside the Trend <td>.
    const sparkline = within(trendCell).getByTestId("jobs-sparkline-stub");
    expect(sparkline).toBeInTheDocument();
    expect(sparkline.dataset.points).toBe("3");

    // Sparkline stub is absent from the Stellen <td>.
    expect(within(stellenCell).queryByTestId("jobs-sparkline-stub")).not.toBeInTheDocument();

    // Latest count is visible in the Stellen cell.
    expect(within(stellenCell).getByText("42")).toBeInTheDocument();

    // Hovering the Stellen cell surfaces a styled tooltip with latest, Δ7T
    // and the 90T min/max band (rendered through a body portal).
    const stellenWrapper = stellenCell.querySelector(".jobs-sparkline-cell") as HTMLElement;
    expect(stellenWrapper).not.toBeNull();
    fireEvent.mouseEnter(stellenWrapper);
    const jobsTip = screen.getByRole("tooltip");
    expect(jobsTip).toHaveTextContent("Offene Stellen");
    expect(jobsTip).toHaveTextContent("Aktuell: 42");
    expect(jobsTip).toHaveTextContent("Δ 7T: +3");
    expect(jobsTip).toHaveTextContent("90 T min/max: 30 / 42");
    fireEvent.mouseLeave(stellenWrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Hovering the Trend cell surfaces a styled period-change tooltip
    // (start→end, absolute Δ and %). It renders through a body portal, so it
    // only exists while hovered.
    const trendWrapper = trendCell.querySelector(".jobs-sparkline-cell") as HTMLElement;
    expect(trendWrapper).not.toBeNull();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(trendWrapper);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("90 Tage");
    expect(tip).toHaveTextContent("30 → 42");
    expect(tip).toHaveTextContent("+12 (+40,0 %)");

    fireEvent.mouseLeave(trendWrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("falls back to count + Δ when fewer than 2 trend points are available", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 42, delta_7d: -2 } },
      trendsByIsin: { DE0001: [{ date: "2026-05-01", count: 42 }] },
    });

    const { trendCell, stellenCell } = getTrendAndStellenCells(container);

    // No sparkline anywhere — insufficient trend points.
    expect(screen.queryByTestId("jobs-sparkline-stub")).not.toBeInTheDocument();

    // Trend cell shows the en-dash fallback.
    expect(trendCell.textContent).toBe("–");

    // Stellen cell still surfaces the numeric count.
    expect(within(stellenCell).getByText("42")).toBeInTheDocument();
  });

  it("falls back to a dash when no aggregate is known for the row", () => {
    const { container } = renderTable({
      jobsByIsin: { OTHER: { latest: 1, delta_7d: 0 } },
      trendsByIsin: {},
    });

    const { trendCell, stellenCell } = getTrendAndStellenCells(container);

    // Both Trend and Stellen cells show the en-dash fallback.
    expect(trendCell.textContent).toBe("–");
    expect(stellenCell.textContent).toBe("–");

    expect(screen.queryByTestId("jobs-sparkline-stub")).not.toBeInTheDocument();
  });
});

describe("WatchlistTable Kurs 12M price sparkline cell", () => {
  function getPriceCell(container: HTMLElement) {
    const headers = Array.from(container.querySelectorAll("thead th"));
    const idx = headers.findIndex((th) => th.textContent === "Kurs 12M");
    const cells = Array.from(container.querySelectorAll("tbody tr:first-child td"));
    return cells[idx] as HTMLElement;
  }

  it("renders the price sparkline when ≥2 price points exist", () => {
    const { container } = renderTable({
      pricesByIsin: {
        DE0001: [
          { date: "2025-06-01", close: 95.2 },
          { date: "2026-05-01", close: 110.4 },
        ],
      },
    });
    const cell = getPriceCell(container);
    const stub = within(cell).getByTestId("price-sparkline-stub");
    expect(stub).toBeInTheDocument();
    expect(stub.dataset.points).toBe("2");
  });

  it("hovering reveals a 12-month price-change tooltip", () => {
    const { container } = renderTable({
      pricesByIsin: {
        DE0001: [
          { date: "2025-06-01", close: 100 },
          { date: "2026-05-01", close: 120 },
        ],
      },
    });
    const cell = getPriceCell(container);
    const wrapper = cell.querySelector(".jobs-sparkline-cell") as HTMLElement;
    expect(wrapper).not.toBeNull();
    fireEvent.mouseEnter(wrapper);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Kurs · 12 Monate");
    expect(tip).toHaveTextContent("100,00 → 120,00 EUR");
    expect(tip).toHaveTextContent("+20,0 %");
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("falls back to a dash when fewer than 2 price points are available", () => {
    const { container } = renderTable({
      pricesByIsin: { DE0001: [{ date: "2026-05-01", close: 100 }] },
    });
    const cell = getPriceCell(container);
    expect(cell.textContent).toBe("–");
    expect(within(cell).queryByTestId("price-sparkline-stub")).not.toBeInTheDocument();
  });
});

describe("WatchlistTable Stellen cell arrow behaviour", () => {
  // Requirements: 3.3, 4.1 — positive delta renders up-arrow with delta-up class
  it("positive delta — span.delta-up with text '↑' present in Stellen cell", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: 5 } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    const arrow = stellenCell.querySelector(".delta-up");
    expect(arrow).not.toBeNull();
    expect(arrow!.textContent).toBe("↑");
    expect(stellenCell.querySelector(".delta-down")).toBeNull();
  });

  // Requirements: 3.4, 4.1 — negative delta renders down-arrow with delta-down class
  it("negative delta — span.delta-down with text '↓' present in Stellen cell", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: -3 } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    const arrow = stellenCell.querySelector(".delta-down");
    expect(arrow).not.toBeNull();
    expect(arrow!.textContent).toBe("↓");
    expect(stellenCell.querySelector(".delta-up")).toBeNull();
  });

  // Requirements: 3.5, 4.5 — zero delta renders no arrow span
  it("zero delta — no arrow span in Stellen cell", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: 0 } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    expect(stellenCell.querySelector(".delta-up")).toBeNull();
    expect(stellenCell.querySelector(".delta-down")).toBeNull();
  });

  // Requirements: 3.5, 4.5 — null delta renders no arrow span
  it("null delta — no arrow span in Stellen cell", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: null } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    expect(stellenCell.querySelector(".delta-up")).toBeNull();
    expect(stellenCell.querySelector(".delta-down")).toBeNull();
  });

  // Requirements: 3.2, 5.3 — null latest renders "–" and no arrow span
  it("null latest — '–' in Stellen cell, no arrow span", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: null, delta_7d: 5 } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    expect(stellenCell.textContent).toBe("–");
    expect(stellenCell.querySelector(".delta-up")).toBeNull();
    expect(stellenCell.querySelector(".delta-down")).toBeNull();
  });

  // Requirements: 4.2 — arrow span has margin-left: 0.25em inline style
  it("arrow margin — arrow span has style containing 'margin-left: 0.25em'", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: 7 } },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    const arrow = stellenCell.querySelector(".delta-up") as HTMLElement | null;
    expect(arrow).not.toBeNull();
    expect(arrow!.style.marginLeft).toBe("0.25em");
  });

  // Requirements: 3.7 — hover tooltip surfaces "Aktuell:", "Δ 7T:", "min/max" content
  it("tooltip — hovering the Stellen cell reveals required tooltip content", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 20, delta_7d: 4 } },
      trendsByIsin: {
        DE0001: [
          { date: "2026-03-01", count: 15 },
          { date: "2026-05-01", count: 25 },
        ],
      },
    });
    const { stellenCell } = getTrendAndStellenCells(container);
    const wrapper = stellenCell.querySelector(".jobs-sparkline-cell") as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    fireEvent.mouseEnter(wrapper!);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Aktuell:");
    expect(tip).toHaveTextContent("Δ 7T:");
    expect(tip).toHaveTextContent("min/max:");
  });

  // Requirements: 4.3, 4.4 — both Trend and Stellen <td> carry the num-cell class
  it("num-cell classes — both Trend and Stellen <td> carry the num-cell class", () => {
    const { container } = renderTable({
      jobsByIsin: { DE0001: { latest: 10, delta_7d: 1 } },
    });
    const { trendCell, stellenCell } = getTrendAndStellenCells(container);
    expect(trendCell.classList.contains("num-cell")).toBe(true);
    expect(stellenCell.classList.contains("num-cell")).toBe(true);
  });
});
