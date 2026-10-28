import { describe, expect, it } from "vitest";
import { menuSections } from "./modules";

describe("menu dos módulos registrados", () => {
  it("mantém a ordem: Fechamento, Relatórios, Administração & IAM", () => {
    const menu = menuSections(() => true);
    expect(menu.map((s) => s.label)).toEqual(["Fechamento", "Relatórios", "Administração & IAM"]);
    expect(menu[2].entries.map((e) => e.label)).toEqual(["Usuários", "Grupos", "ERPs", "Auditoria"]);
  });
});
