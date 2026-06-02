import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AIBatchProgress } from "./AIBatchProgress";
import type { AIRunStatus, RunSummary } from "../../types/run";

const runningRun: RunSummary = {
  id: 7,
  run_type: "ai",
  started_at: new Date().toISOString(),
  finished_at: null,
  duration_seconds: 0,
  stocks_total: 2,
  stocks_done: 1,
  stocks_success: 1,
  stocks_error: 0,
  phase: "running",
  status: "ok",
  error_details: null,
};

const items: AIRunStatus[] = [
  {
    isin: "US0378331005",
    stock_name: "Apple",
    agent_id: "fisher",
    status: "done",
    error_text: null,
    created_at: new Date().toISOString(),
    duration_ms: 4200,
  },
  {
    isin: "US5949181045",
    stock_name: "Microsoft",
    agent_id: "tournament",
    status: "running",
    error_text: null,
    created_at: new Date().toISOString(),
    duration_ms: null,
  },
];

const agentLabel = (id: string) =>
  (({ fisher: "Fisher", tournament: "Turnier" }) as Record<string, string>)[id] ?? id;

describe("AIBatchProgress", () => {
  it("renders progress counters, a status badge per row, method labels and an active cancel button", () => {
    render(
      <AIBatchProgress
        run={runningRun}
        items={items}
        agentLabel={agentLabel}
        onCancel={vi.fn()}
        cancelPending={false}
      />,
    );

    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Microsoft")).toBeInTheDocument();

    // method labels resolved via agentLabel
    expect(screen.getByText("Fisher")).toBeInTheDocument();
    expect(screen.getByText("Turnier")).toBeInTheDocument();

    // one StatusBadge (.run-badge) per data row
    expect(document.querySelectorAll(".run-badge").length).toBe(2);

    expect(screen.getByRole("button", { name: "Lauf abbrechen" })).toBeInTheDocument();
  });

  it("hides the cancel button once the run is finished", () => {
    render(
      <AIBatchProgress
        run={{
          ...runningRun,
          phase: "finished",
          status: "ok",
          stocks_done: 2,
          stocks_success: 2,
        }}
        items={items}
        agentLabel={agentLabel}
        onCancel={vi.fn()}
        cancelPending={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Lauf abbrechen" })).not.toBeInTheDocument();
  });

  it("collapses a finished run to a summary and reveals the detail table on toggle", async () => {
    const user = userEvent.setup();
    render(
      <AIBatchProgress
        run={{
          ...runningRun,
          phase: "finished",
          status: "ok",
          stocks_done: 2,
          stocks_success: 2,
        }}
        items={items}
        agentLabel={agentLabel}
        onCancel={vi.fn()}
        cancelPending={false}
      />,
    );

    // Collapsed by default: the per-row detail table is not rendered yet.
    const toggle = screen.getByRole("button", { name: /Letzter Lauf/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".run-badge").length).toBe(0);

    await user.click(toggle);

    // Expanded: the full detail (rows + a status badge each) is now visible.
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(document.querySelectorAll(".run-badge").length).toBe(2);
  });
});
