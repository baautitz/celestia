import { describe, expect, it } from "vitest";
import { menuSections } from "./modules";

describe("menu dos módulos registrados", () => {
  it("mantém a ordem: Fechamento, Lançamentos, Relatórios, InovaFarma, Administração & IAM", () => {
    const menu = menuSections(() => true);
    expect(menu.map((s) => s.label)).toEqual(["Fechamento", "Lançamentos", "Relatórios", "InovaFarma", "Administração & IAM"]);
    expect(menu[4].entries.map((e) => e.label)).toEqual(["Usuários", "Grupos", "Dispositivos", "ERPs", "Auditoria"]);
  });

  it("mostra Pré-vencidos, Avaliações e Furo de Estoque em Lançamentos, Colaboradores em InovaFarma e mantém Desempenho de Vendas em Relatórios", () => {
    const menu = menuSections(() => true);
    expect(menu.find((s) => s.label === "Lançamentos")?.entries.map((e) => e.label)).toEqual(["Pré-vencidos", "Avaliações", "Furo de Estoque"]);
    expect(menu.find((s) => s.label === "InovaFarma")?.entries.map((e) => e.label)).toEqual(["Colaboradores"]);
    expect(menu.find((s) => s.label === "Relatórios")?.entries.map((e) => e.label)).toContain("Desempenho de Vendas");
  });

  it("esconde as Seções do InovaFarma de quem não tem nenhuma Permission delas", () => {
    const menu = menuSections((permission) => !permission.startsWith("inovafarma:colaboradores:") && !permission.startsWith("inovafarma:pre-vencidos-") && !permission.startsWith("inovafarma:avaliacoes-") && !permission.startsWith("inovafarma:furo-estoque-"));
    expect(menu.map((s) => s.label)).not.toContain("InovaFarma");
    expect(menu.map((s) => s.label)).not.toContain("Lançamentos");
  });

  it("quem só confere Pré-vencidos vê só essa entrada, na Seção Lançamentos", () => {
    const menu = menuSections((permission) => permission === "inovafarma:pre-vencidos-conferencia:view");
    expect(menu.map((s) => s.label)).toEqual(["Lançamentos"]);
    expect(menu.find((s) => s.label === "Lançamentos")?.entries.map((e) => e.label)).toEqual(["Pré-vencidos"]);
  });
});
