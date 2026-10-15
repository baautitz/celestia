import { describe, expect, it } from "vitest";
import { formatDate, formatPercent } from "./format";

describe("format", () => {
  it("formats ISO date and percent", () => {
    expect(formatDate("2026-09-03")).toBe("03/09/2026");
    expect(formatPercent(33.5)).toBe("33,5%");
  });
});
