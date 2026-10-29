// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiCard } from "./layout";

afterEach(cleanup);

describe("KpiCard com tendência", () => {
  it("mostra a variação percentual e o detalhe ao passar o mouse", async () => {
    render(
      <KpiCard
        label="Total Líquido"
        value="R$ 12.340,00"
        icon={<svg />}
        trend={{ current: 12340, previous: 11000, label: "Setembro/2026", format: "currency" }}
      />,
    );
    const trend = screen.getByText("▲ 12,2%");
    expect(trend.className).toContain("text-emerald-600");

    await userEvent.hover(trend);
    expect(await screen.findByText("Setembro/2026")).toBeTruthy();
    expect(screen.getByText("R$ 11.000,00")).toBeTruthy();
    expect(screen.getByText("R$ 12.340,00", { selector: "[data-slot=tooltip-content] *" })).toBeTruthy();
  });

  it("mostra diferença em pontos percentuais para valores em %", () => {
    render(
      <KpiCard
        label="CMV (%)"
        value="31,2%"
        icon={<svg />}
        trend={{ current: 31.2, previous: 32, label: "Setembro/2026", format: "percent", favorable: "down" }}
      />,
    );
    expect(screen.getByText("▼ 0,8 p.p.").className).toContain("text-emerald-600");
  });

  it("pinta de vermelho quando subir é desfavorável", () => {
    render(
      <KpiCard
        label="Descontos"
        value="R$ 1.560,00"
        icon={<svg />}
        trend={{ current: 1560, previous: 1289, label: "Setembro/2026", format: "currency", favorable: "down" }}
      />,
    );
    expect(screen.getByText("▲ 21,0%").className).toContain("text-destructive");
  });

  it("não pinta tendência neutra", () => {
    render(
      <KpiCard
        label="CMV (R$)"
        value="R$ 3.850,00"
        icon={<svg />}
        trend={{ current: 3850, previous: 3500, label: "Setembro/2026", format: "currency", favorable: "neutral" }}
      />,
    );
    expect(screen.getByText("▲ 10,0%").className).toContain("text-muted-foreground");
  });

  it("omite a tendência sem base de comparação", () => {
    render(
      <KpiCard
        label="Vitaminas"
        value="R$ 200,00"
        icon={<svg />}
        trend={{ current: 200, previous: 0, label: "Setembro/2026", format: "currency" }}
      />,
    );
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
  });
});
