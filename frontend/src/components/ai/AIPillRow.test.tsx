import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AIPillRow } from "./AIPillRow";
import type { Stock } from "../../types";

function makeStock(latest: Stock["latest_ai_runs"]): Stock {
  return { isin: "DE000TEST001", latest_ai_runs: latest } as Stock;
}

describe("AIPillRow", () => {
  it("shows a rich tooltip with the result details on hover", () => {
    const stock = makeStock({
      fisher: {
        agent_id: "fisher",
        created_at: "2026-01-01T00:00:00Z",
        model: "gpt-stub",
        summary: { score: 21, verdict: "strong", summary: "Hervorragendes Management" },
      },
    });

    const { container } = render(
      <MemoryRouter>
        <AIPillRow stock={stock} />
      </MemoryRouter>
    );

    // The tooltip body is rendered through a portal and absent until hover.
    expect(screen.queryByText("Score 21/30 · Stark")).not.toBeInTheDocument();

    // HoverTooltip's onMouseEnter is synthesized by React from native mouseover.
    const trigger = container.querySelector(".ai-pill-tip") as HTMLElement;
    fireEvent.mouseOver(trigger);

    expect(screen.getByText("Score 21/30 · Stark")).toBeInTheDocument();
    expect(screen.getByText("Hervorragendes Management")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/stocks/DE000TEST001?agent=fisher"
    );
  });

  it("renders an em dash when there are no runs", () => {
    render(
      <MemoryRouter>
        <AIPillRow stock={makeStock({})} />
      </MemoryRouter>
    );
    expect(screen.getByText("–")).toBeInTheDocument();
  });
});
