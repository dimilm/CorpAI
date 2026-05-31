import { describe, expect, it } from "vitest";

import { sparklineGeometry } from "./Sparkline";

describe("sparklineGeometry", () => {
  it("anchors the domain to data min/max with 15% padding (not 0-based)", () => {
    const geo = sparklineGeometry([40, 48, 44]);
    // span = 8, pad = 1.2 -> [38.8, 49.2]; crucially the low bound is well
    // above 0, which is what stops the line from looking flat.
    expect(geo.domain[0]).toBeCloseTo(38.8);
    expect(geo.domain[1]).toBeCloseTo(49.2);
    expect(geo.domain[0]).toBeGreaterThan(0);
  });

  it("uses a minimum padding of 1 for a perfectly flat series", () => {
    const geo = sparklineGeometry([42, 42]);
    expect(geo.domain).toEqual([41, 43]);
    expect(geo.direction).toBe("flat");
  });

  it("reports an upward direction when the last value exceeds the first", () => {
    const geo = sparklineGeometry([30, 35, 42]);
    expect(geo.direction).toBe("up");
    expect(geo.first).toBe(30);
    expect(geo.last).toBe(42);
  });

  it("reports a downward direction when the last value is below the first", () => {
    const geo = sparklineGeometry([50, 45, 38]);
    expect(geo.direction).toBe("down");
    expect(geo.first).toBe(50);
    expect(geo.last).toBe(38);
  });

  it("keys direction off first vs last only, ignoring interior peaks", () => {
    // dips below the start mid-series but recovers above it.
    const geo = sparklineGeometry([40, 20, 41]);
    expect(geo.direction).toBe("up");
    expect(geo.domain[0]).toBeLessThan(20);
  });

  it("handles fractional (price) values", () => {
    const geo = sparklineGeometry([95.2, 110.4]);
    expect(geo.direction).toBe("up");
    expect(geo.first).toBeCloseTo(95.2);
    expect(geo.last).toBeCloseTo(110.4);
  });
});
