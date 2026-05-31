import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, TableSkeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("applies width/height styles and hides from AT", () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.querySelector(".skeleton") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("2rem");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
});

describe("TableSkeleton", () => {
  it("exposes an accessible loading status and hides the decorative grid", () => {
    render(<TableSkeleton rows={3} columns={4} label="Lade Daten…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Lade Daten…");
    // 3 body rows + 1 head row, all aria-hidden.
    const rows = status.querySelectorAll(".skeleton-table-row");
    expect(rows.length).toBe(4);
    rows.forEach((r) => expect(r).toHaveAttribute("aria-hidden", "true"));
  });
});
