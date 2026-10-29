import { describe, expect, it } from "vitest";
import { previousClosingPeriodRange, type ClosingPeriod } from "./previous-closing-period";

const period = (id: string, startDate: string, endDate: string, status: ClosingPeriod["status"] = "closed"): ClosingPeriod => ({
  id,
  name: id,
  startDate,
  endDate,
  status,
});

const agosto = period("Agosto/2026", "2026-08-01", "2026-08-31");
const setembro = period("Setembro/2026", "2026-09-01", "2026-09-30");
const outubro = period("Outubro/2026", "2026-10-01", "2026-10-31", "open");

describe("previousClosingPeriodRange", () => {
  it("usa o Período encerrado mais recente antes do selecionado, por inteiro", () => {
    expect(previousClosingPeriodRange([outubro, agosto, setembro], setembro, "2026-10-28")).toEqual({
      name: "Agosto/2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
  });

  it("corta o anterior nos mesmos dias decorridos quando o selecionado ainda não terminou", () => {
    expect(previousClosingPeriodRange([agosto, setembro, outubro], outubro, "2026-10-28")).toEqual({
      name: "Setembro/2026",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
    });
  });

  it("não passa do fim do anterior quando ele é mais curto", () => {
    const curto = period("Curto", "2026-09-25", "2026-09-30");
    expect(previousClosingPeriodRange([curto, outubro], outubro, "2026-10-28")?.endDate).toBe("2026-09-30");
  });

  it("ignora Períodos cancelados e aceita lacunas entre eles", () => {
    const cancelado = period("Setembro cancelado", "2026-09-01", "2026-09-30", "cancelled");
    expect(previousClosingPeriodRange([agosto, cancelado, outubro], outubro, "2026-11-05")).toEqual({
      name: "Agosto/2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
  });

  it("não compara sem Período anterior", () => {
    expect(previousClosingPeriodRange([agosto, setembro], agosto, "2026-10-28")).toBeUndefined();
  });
});
