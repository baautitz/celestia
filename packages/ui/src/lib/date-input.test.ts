import { describe, expect, it } from "vitest";
import { maskDate, maskDateRange, parseDate, parseDateRange } from "./date-input";

describe("maskDate", () => {
  it("inserts slashes while typing and ignores non-digits", () => {
    expect(maskDate("1")).toBe("1");
    expect(maskDate("150")).toBe("15/0");
    expect(maskDate("15032026")).toBe("15/03/2026");
    expect(maskDate("15/03/2026999")).toBe("15/03/2026");
    expect(maskDate("ab1c5")).toBe("15");
  });
});

describe("parseDate", () => {
  it("returns the date for a complete valid text", () => {
    const d = parseDate("15/03/2026");
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 2, 15]);
  });
  it("returns undefined for incomplete or impossible dates", () => {
    expect(parseDate("15/03/20")).toBeUndefined();
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("00/10/2026")).toBeUndefined();
    expect(parseDate("10/13/2026")).toBeUndefined();
  });
});

describe("range", () => {
  it("masks two dates separated by a dash", () => {
    expect(maskDateRange("1503202620")).toBe("15/03/2026 - 20");
    expect(maskDateRange("1503202620042026")).toBe("15/03/2026 - 20/04/2026");
  });
  it("parses a valid range", () => {
    const r = parseDateRange("15/03/2026 - 20/04/2026");
    expect([r?.from.getDate(), r?.to.getMonth()]).toEqual([15, 3]);
  });
  it("rejects end before start or invalid parts", () => {
    expect(parseDateRange("20/04/2026 - 15/03/2026")).toBeUndefined();
    expect(parseDateRange("15/03/2026 - 31/02/2026")).toBeUndefined();
    expect(parseDateRange("15/03/2026")).toBeUndefined();
  });
});
