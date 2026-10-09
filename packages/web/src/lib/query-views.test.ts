import { describe, it, expect } from "vitest";
import type { ComponentProfileMeta } from "@platform/shared";
import { collectQueryViews, currentView, planForQuery, type ViewComponent } from "./query-views.js";

const profile = (id: string, label: string, sourceName: string, queryName: string, optionId: string, optionLabel: string): ComponentProfileMeta => ({
  id,
  label,
  bindings: [{ id: queryName, sourceName, queryName, optionId, optionLabel }],
});

const vendas = (id: string) => [
  profile("todas", "Todas", "erp", "vendas", "todas", "Todas"),
  profile("proprias", "Minhas", "erp", "vendas", "proprias", "Somente as minhas"),
];

const components: ViewComponent[] = [
  { id: "c1", title: "Cartão 1", profiles: vendas("c1") },
  { id: "c2", title: "Cartão 2", profiles: vendas("c2") },
  { id: "c3", title: "Metas", profiles: [profile("principal", "Principal", "metas", "metas", "principal", "Meta principal"), profile("todas", "Todas", "metas", "metas", "todas", "Todas as metas")] },
  { id: "c4", title: "Só persistência", profiles: [{ id: "p", label: "P", bindings: [{ id: "x", persistenceName: "penalidades" }] }] },
];

describe("query-views", () => {
  it("agrupa os componentes por consulta e lista as visões", () => {
    const groups = collectQueryViews(components);
    expect(groups.map((g) => g.key)).toEqual(["erp.vendas", "metas.metas"]);
    expect(groups[0]!.components.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(groups[0]!.views.map((v) => v.id)).toEqual(["todas", "proprias"]);
    expect(groups[1]!.components.map((c) => c.id)).toEqual(["c3"]); // c4 só tem persistência
  });

  it("calcula a visão atual, o 'mixed' e o padrão (primeiro perfil)", () => {
    const [vendasGroup] = collectQueryViews(components);
    expect(currentView(vendasGroup!, components, {})).toBe("todas");
    expect(currentView(vendasGroup!, components, { c1: "proprias", c2: "proprias" })).toBe("proprias");
    expect(currentView(vendasGroup!, components, { c1: "proprias" })).toBe("mixed");
    expect(currentView(vendasGroup!, components, { c1: "removido" })).toBe("todas"); // perfil inválido volta ao padrão
  });

  it("aplica uma visão a todos os componentes de uma consulta (manual)", () => {
    const [vendasGroup] = collectQueryViews(components);
    expect(planForQuery(vendasGroup!, components, "proprias")).toEqual({ c1: "proprias", c2: "proprias" });
    expect(planForQuery(vendasGroup!, components, "inexistente")).toEqual({});
  });
});
