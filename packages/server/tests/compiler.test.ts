import { describe, it, expect } from "vitest";
import { RecipeCompiler } from "../src/engine/compiler.js";

describe("RecipeCompiler (esbuild em memória)", () => {
  const compiler = new RecipeCompiler();

  const sampleTsRecipe = `
    import { defineRecipe } from "@platform/shared";

    export default defineRecipe({
      id: "teste_dashboard",
      name: "Dashboard Teste",
      workspace: { params: [] },
      sources: {
        mock: {
          primaryKey: "id",
          queries: {
            default: { query: "SELECT * FROM mock" }
          }
        }
      },
      persistence: [],
      actions: [],
      ui: {
        layout: { type: "grid", columns: 12 },
        components: []
      }
    });
  `;

  it("deve compilar TypeScript puro para RecipeDef em memória", async () => {
    const start = performance.now();
    const recipe = await compiler.compile("teste_dashboard", sampleTsRecipe);
    const duration = performance.now() - start;

    expect(recipe).toBeDefined();
    expect(recipe.id).toBe("teste_dashboard");
    expect(recipe.name).toBe("Dashboard Teste");
    expect(duration).toBeLessThan(2000); // Cold start no Windows
  });

  it("deve recompilar em menos de 10ms usando cache em memória", async () => {
    // Primeira chamada (popula cache)
    await compiler.compile("teste_dashboard", sampleTsRecipe);

    // Segunda chamada (warm cache)
    const start = performance.now();
    const recipe = await compiler.compile("teste_dashboard", sampleTsRecipe);
    const duration = performance.now() - start;

    expect(recipe).toBeDefined();
    expect(duration).toBeLessThan(10); // Cache em microssegundos
  });
});
