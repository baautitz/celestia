import { describe, expect, it } from "vitest";
import { resolvePeriodId } from "./period-selection";

const aberto = { id: "a", status: "open" as const };
const fechado = { id: "f", status: "closed" as const };

describe("resolvePeriodId", () => {
  it("usa a última escolha se ainda existir", () => expect(resolvePeriodId([aberto, fechado], "f")).toBe("f"));
  it("sem escolha, pega o aberto mais recente", () => expect(resolvePeriodId([fechado, aberto], null)).toBe("a"));
  it("escolha que sumiu da lista cai no padrão", () => expect(resolvePeriodId([aberto, fechado], "x")).toBe("a"));
  it("sem aberto, pega o primeiro", () => expect(resolvePeriodId([fechado], null)).toBe("f"));
  it("lista vazia", () => expect(resolvePeriodId([], "a")).toBe(""));
});
