import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MemoryRecipeStore } from "../src/data/recipe-store.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const validSource = (id: string, withAction = true) => `
import { defineRecipe } from "@platform/shared";
export default defineRecipe({
  id: "${id}",
  name: "Modelo Teste",
  workspace: { params: [] },
  sources: {},
  actions: [${withAction ? `{ id: "acao_a", label: "A", permission: "recipe:${id}:action:acao_a", action: async () => {} }` : ""}],
  ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [] },
});
`;

describe("Gestão de Modelos em runtime (/api/admin/recipes)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let recipeStore: MemoryRecipeStore;

  async function tokenOf(username: string): Promise<string> {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    });
    return ((await res.json()) as { access_token: string }).access_token;
  }

  const put = (id: string, source: string, token: string) =>
    app.request(`/api/admin/recipes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ source }),
    });

  beforeEach(() => {
    recipeStore = new MemoryRecipeStore();
    app = createPlatformApp({ userStore: createSeededUserStore(), recipeStore });
  });

  it("salva um Modelo válido e o expõe no catálogo de permissões", async () => {
    const token = await tokenOf("carlos.admin");
    const res = await put("novo", validSource("novo"), token);
    expect(res.status).toBe(200);
    expect(await recipeStore.get("novo")).not.toBeNull();

    const get = await app.request("/api/admin/recipes/novo", { headers: { Authorization: `Bearer ${token}` } });
    expect(((await get.json()) as { source: string }).source).toContain('id: "novo"');
  });

  it("recusa código que não compila e não grava", async () => {
    const token = await tokenOf("carlos.admin");
    const res = await put("quebrado", "export default defineRecipe({", token);
    expect(res.status).toBe(400);
    expect(await recipeStore.get("quebrado")).toBeNull();
  });

  it("recusa quando o id do Modelo difere do id da URL", async () => {
    const token = await tokenOf("carlos.admin");
    const res = await put("outro", validSource("diferente"), token);
    expect(res.status).toBe(400);
    expect(await recipeStore.get("outro")).toBeNull();
  });

  it("mostra o Modelo novo no catálogo a quem gerencia permissões, e só com view aos demais", async () => {
    const admin = await tokenOf("carlos.admin");
    await put("novo", validSource("novo"), admin);
    const ids = async (token: string) =>
      ((await (await app.request("/api/recipes", { headers: { Authorization: `Bearer ${token}` } })).json()) as { id: string }[]).map((r) => r.id);
    expect(await ids(admin)).toContain("novo");
    expect(await ids(await tokenOf("joao.silva"))).not.toContain("novo");
  });

  it("exclui um Modelo", async () => {
    const token = await tokenOf("carlos.admin");
    await put("novo", validSource("novo"), token);
    const del = await app.request("/api/admin/recipes/novo", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(del.status).toBe(200);
    expect(await recipeStore.get("novo")).toBeNull();
  });

  it("nega acesso a quem não tem system:recipes:*", async () => {
    const token = await tokenOf("joao.silva");
    expect((await put("novo", validSource("novo"), token)).status).toBe(403);
    const list = await app.request("/api/admin/recipes", { headers: { Authorization: `Bearer ${token}` } });
    expect(list.status).toBe(403);
  });
});

describe("Compilador: isolamento do contexto", () => {
  it("não expõe process nem objetos do host ao código do Modelo", async () => {
    const { RecipeCompiler } = await import("../src/engine/compiler.js");
    const compiler = new RecipeCompiler();
    const probe = (expr: string) =>
      `export default { id: "x", name: String(${expr}), workspace: { params: [] }, sources: {}, ui: { layout: {}, components: [] } };`;

    expect((await compiler.compile("x", probe("typeof process"))).name).toBe("undefined");
    await expect(compiler.compile("y", `export default { id: "y", name: (0, eval)("1") };`)).rejects.toThrow();
    await expect(
      compiler.compile("z", `export default { id: "z", name: require("fs").constructor.constructor("return process")() };`)
    ).rejects.toThrow();
  });
});
