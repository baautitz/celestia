import type { FormFieldDef, FieldType } from "./fields.js";
import type { ImperativeUIContext } from "./ui.js";
import type { LayoutDefinition, UIComponentDef } from "./components.js";
import type { WorkspaceDateRange } from "./workspace.js";

/**
 * Operações disponíveis no objeto persistence injetado na action.
 */
export interface PersistenceContext {
  push(targetCollection: string, item: Record<string, unknown>): Promise<unknown>;
  delete(targetCollection: string, itemId: string | number): Promise<void>;
  set(targetCollection: string, itemId: string | number, payload: Record<string, unknown>): Promise<unknown>;
  get?(targetCollection: string, itemId: string | number): Promise<unknown>;
}

/**
 * Contexto injetado na execução de uma action.
 */
export interface ActionContext<
  TRow = any,
  TForm = Record<string, unknown>
> {
  row: TRow;
  form?: TForm;
  persistence: PersistenceContext;
  ui: ImperativeUIContext;
  workspace: {
    id: string;
    startDate: string;
    endDate: string;
    params?: Record<string, unknown>;
    version: number;
  };
}

/**
 * Definição de uma Action operacional de linha.
 */
export interface ActionDef<TRow = any> {
  id: string;
  label: string;
  icon?: string;
  variant?: "default" | "destructive" | "secondary" | "outline" | "ghost";
  nature?: "read" | "mutation";
  permission?: string;
  action(context: ActionContext<TRow, Record<string, unknown>>): Promise<void>;
}

/**
 * Definição de uma Query SQL vinculada a uma permissão.
 */
export interface SourceQueryDef {
  id?: string;
  query: string;
  columns?: Array<{
    name: string;
    type: FieldType;
    label?: string;
  }>;
}

/**
 * Definição de uma Fonte de Dados externa (ERP).
 */
export interface SourceDef {
  primaryKey: string;
  queries: Record<string, SourceQueryDef>;
}

/**
 * Schema de um campo de persistência com valor padrão obrigatório.
 */
export interface PersistenceFieldDef {
  type: FieldType;
  label?: string;
  defaultValue: unknown;
}

/**
 * Definição de um campo agregado computado na persistência.
 */
export interface ComputedFieldDef {
  type: FieldType;
  aggregate: {
    function: "sum" | "count" | "avg" | "min" | "max";
    field: string;
  };
}

/**
 * Definição de uma coleção ou registro escalar de persistência da plataforma.
 */
export interface PersistenceDef {
  id: string;
  targetSource: string;
  targetForeignKey: string;
  mode: "collection" | "scalar";
  itemSchema: Record<string, PersistenceFieldDef>;
  computedFields?: Record<string, ComputedFieldDef>;
}

/**
 * Estrutura completa de uma Recipe declarativa da plataforma.
 */
export interface RecipeDef<TRow = any> {
  id: string;
  name: string;
  description?: string;
  workspace: {
    params: FormFieldDef[];
  };
  sources: Record<string, SourceDef>;
  persistence: PersistenceDef[];
  actions: ActionDef<any>[];
  ui: {
    layout: LayoutDefinition;
    components: UIComponentDef<TRow>[];
  };
}

/**
 * Resumo de um Modelo (Recipe) para o catálogo público da plataforma.
 */
export interface RecipeSummary {
  id: string;
  name: string;
  description?: string;
}

/**
 * Função construtora tipada com inferência de tipos para recipes de dashboards.
 */
export function defineRecipe<TRow = any>(
  recipe: RecipeDef<TRow>
): RecipeDef<TRow> {
  return recipe;
}
