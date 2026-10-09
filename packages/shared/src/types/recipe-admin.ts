/**
 * Resumo de um Modelo cadastrado em runtime (gestão administrativa).
 */
export interface RecipeAdminSummary {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Modelo cadastrado em runtime, com o código-fonte TypeScript.
 */
export interface RecipeAdminRecord {
  id: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
