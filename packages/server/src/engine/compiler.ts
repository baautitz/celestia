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

    // Cria o contexto isolado para extrair a recipe
    const sandbox: Record<string, unknown> = {
      exports: {},
      module: { exports: {} },
      require: (moduleName: string) => {
        if (moduleName === "@platform/shared") {
          return { defineRecipe: (config: unknown) => config };
        }
        return {};
      },
      defineRecipe: (config: unknown) => config,
      console,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
    };

    const context = createContext(sandbox);
    const script = new Script(transformResult.code);
    script.runInContext(context, { timeout: 1000 });

    const moduleObj = sandbox.module as { exports: { default?: RecipeDef } } | undefined;
    const exportsObj = sandbox.exports as { default?: RecipeDef } | undefined;

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
