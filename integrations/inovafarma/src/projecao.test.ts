import { describe, expect, it } from "vitest";
import { indicadorPorId } from "./indicadores";
import { projetar } from "./projecao";

const periodo = { startDate: "2026-10-01", endDate: "2026-10-30", status: "open" as const };

describe("Projeção", () => {
  it("Indicador que acumula segue o ritmo diário e diz quanto precisa por dia", () => {
    // 10 de 30 dias, R$ 1.000,00 vendidos: no ritmo, R$ 3.000,00; faltam R$ 3.000,00 em 20 dias.
    const p = projetar(indicadorPorId("venda-liquida"), 100_000, 400_000, periodo, "2026-10-10")!;
    expect(p.valor).toBe(300_000);
    expect(p.atinge).toBe(false);
    expect(p.dica).toContain("R$ 150,00 por dia nos 20 dias restantes");
  });

  it("Indicador em % fica no valor de hoje e diz quanto precisa baixar", () => {
    const p = projetar(indicadorPorId("cmv"), 32, 30, periodo, "2026-10-10")!;
    expect(p.valor).toBe(32);
    expect(p.atinge).toBe(false);
    expect(p.dica).toContain("Precisa baixar 2 p.p.");
  });

  it("Período fechado: a projeção é o resultado final; Avaliações não projetam", () => {
    expect(projetar(indicadorPorId("venda-liquida"), 100_000, 50_000, { ...periodo, status: "closed" }, "2026-11-05")).toEqual({ valor: 100_000, atinge: true, dica: null });
    expect(projetar(indicadorPorId("avaliacoes"), 100, 200, periodo, "2026-10-10")).toBeNull();
  });
});
