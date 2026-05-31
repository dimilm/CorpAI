import { describe, expect, it } from "vitest";

import { formatImportSummary } from "./importSummary";

describe("formatImportSummary", () => {
  it("lists created and updated counts", () => {
    expect(formatImportSummary({ created: 3, updated: 2, skipped: 0 })).toBe(
      "3 neu · 2 aktualisiert"
    );
  });

  it("appends skipped only when non-zero", () => {
    expect(formatImportSummary({ created: 1, updated: 0, skipped: 4 })).toBe(
      "1 neu · 0 aktualisiert · 4 übersprungen"
    );
  });

  it("defaults missing fields to zero", () => {
    expect(formatImportSummary(undefined)).toBe("0 neu · 0 aktualisiert");
    expect(formatImportSummary({})).toBe("0 neu · 0 aktualisiert");
  });
});
