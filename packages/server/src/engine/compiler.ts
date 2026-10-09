import * as esbuild from "esbuild";
import { createContext, Script } from "node:vm";
import type { RecipeDef } from "@platform/shared";

export class RecipeCompiler {
  private cache = new Map<string, { codeHash: string; recipe: RecipeDef }>();

  /**
   * Compila o código TypeScript de uma recipe em memória e retorna o objeto RecipeDef.
   */
  async compile(recipeId: string, tsSourceCode: string): Promise<RecipeDef> {
    const cached = this.cache.get(recipeId);
    if (cached && cached.codeHash === tsSourceCode) {
      return cached.recipe;
    }

    // Transpila TS para CommonJS usando esbuild em < 2ms
    const transformResult = await esbuild.transform(tsSourceCode, {
      loader: "ts",
      target: "node20",
      format: "cjs",
      sourcemap: "inline",
    });

    // Contexto vazio: nenhum objeto do host é exposto (os intrínsecos Object, Array, Date... são do próprio contexto).
    // O prelúdio roda dentro do contexto para que require/defineRecipe também sejam do contexto, não do host.
    const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    new Script(
      `var module = { exports: {} }; var exports = module.exports;
       var defineRecipe = function (config) { return config; };
       var require = function () { return { defineRecipe: defineRecipe }; };`
    ).runInContext(context);
    new Script(transformResult.code).runInContext(context, { timeout: 1000 });

    const { module: moduleObj, exports: exportsObj } = context as {
      module?: { exports: { default?: RecipeDef } };
      exports?: { default?: RecipeDef };
    };

    const recipe = (moduleObj?.exports?.default ||
      exportsObj?.default ||
      moduleObj?.exports) as RecipeDef | undefined;

    if (!recipe || typeof recipe !== "object" || !recipe.id) {
      throw new Error(
        `A recipe compilada para '${recipeId}' não exporta um default válido com defineRecipe().`
      );
    }

    this.cache.set(recipeId, {
      codeHash: tsSourceCode,
      recipe,
    });

    return recipe;
  }

  /**
   * Invalida o cache de uma recipe (chamado após salvar alterações).
   */
  invalidate(recipeId: string): void {
    this.cache.delete(recipeId);
  }

  /**
   * Limpa todo o cache em memória.
   */
  clear(): void {
    this.cache.clear();
  }
}
