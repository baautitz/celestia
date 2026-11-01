import { describe, expect, it } from "vitest";
import { menuSections } from "./modules";

describe("menu dos módulos registrados", () => {
  it("mantém a ordem: Fechamento, Relatórios, InovaFarma, Administração & IAM", () => {
    const menu = menuSections(() => true);
    expect(menu.map((s) => s.label)).toEqual(["Fechamento", "Relatórios", "InovaFarma", "Administração & IAM"]);
    expect(menu[3].entries.map((e) => e.label)).toEqual(["Usuários", "Grupos", "Dispositivos", "ERPs", "Auditoria"]);
  });

  it("mostra Colaboradores na Seção InovaFarma e mantém Desempenho de Vendas em Relatórios", () => {
    const menu = menuSections(() => true);
    expect(menu.find((s) => s.label === "InovaFarma")?.entries.map((e) => e.label)).toEqual(["Colaboradores"]);
    expect(menu.find((s) => s.label === "Relatórios")?.entries.map((e) => e.label)).toContain("Desempenho de Vendas");
  });

  it("esconde a Seção InovaFarma de quem não tem a Permission de Colaboradores", () => {
    const menu = menuSections((permission) => permission !== "inovafarma:colaboradores:view");
    expect(menu.map((s) => s.label)).not.toContain("InovaFarma");
  });
});
