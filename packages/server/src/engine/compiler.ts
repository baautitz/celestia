import * as esbuild from "esbuild";
import type { RecipeDef } from "@platform/shared";
import { SandboxedRecipe } from "./recipe-sandbox.js";

export class RecipeCompiler {
  private cache = new Map<string, { source: string; recipe: RecipeDef; sandbox: SandboxedRecipe }>();

  /**
   * Transpila o TypeScript da recipe (esbuild, no host) e carrega o resultado num isolate do V8.
   * O código do Modelo nunca roda no processo do servidor: as funções dele viram proxies assíncronos.
   */
  async compile(recipeId: string, tsSourceCode: string): Promise<RecipeDef> {
    const cached = this.cache.get(recipeId);
    if (cached && cached.source === tsSourceCode) {
      return cached.recipe;
    }

    // Transpila TS para CommonJS usando esbuild
    const transformResult = await esbuild.transform(tsSourceCode, {
      loader: "ts",
      target: "node20",
      format: "cjs",
      sourcemap: "inline",
    });

    let loaded: Awaited<ReturnType<typeof SandboxedRecipe.load>>;
    try {
      loaded = await SandboxedRecipe.load(transformResult.code);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`A recipe '${recipeId}' é inválida: ${reason}`);
    }

    if (loaded.recipe.id !== recipeId) {
      loaded.sandbox.dispose();
      throw new Error(`O id do Modelo ('${loaded.recipe.id}') deve ser igual ao id informado ('${recipeId}').`);
    }

    // Só troca a versão em cache quando a nova carregou e foi validada: se falhar, a anterior continua válida.
    cached?.sandbox.dispose();
    this.cache.set(recipeId, { source: tsSourceCode, recipe: loaded.recipe, sandbox: loaded.sandbox });
    return loaded.recipe;
  }

  /**
   * Descarta uma recipe do cache e libera o isolate dela (ex.: Modelo excluído).
   */
  invalidate(recipeId: string): void {
    this.cache.get(recipeId)?.sandbox.dispose();
    this.cache.delete(recipeId);
  }

  /**
   * Limpa todo o cache em memória.
   */
  clear(): void {
    for (const entry of this.cache.values()) entry.sandbox.dispose();
    this.cache.clear();
  }
}
