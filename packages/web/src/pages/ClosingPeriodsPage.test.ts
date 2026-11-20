import { describe, expect, it } from "vitest";
import { suggestPeriodName } from "./ClosingPeriodsPage";

describe("suggestPeriodName", () => {
  it("uses <Mês>/<Ano> of the end date", () => {
    expect(suggestPeriodName(new Date(2026, 2, 1), new Date(2026, 2, 31))).toBe("Março/2026");
  });

  it("uses the end date month when the period crosses months", () => {
    expect(suggestPeriodName(new Date(2026, 2, 15), new Date(2026, 3, 14))).toBe("Abril/2026");
  });
});
