import type { UIEffect } from "./ui.js";
import type { LayoutDefinition, UIComponentDef } from "./components.js";
import type { FormFieldDef } from "./fields.js";

/**
 * Contrato de requisição para execução de Action Operacional (RPC).
 */
export interface ActionExecRequest<TRow = Record<string, unknown>, TForm = Record<string, unknown>> {
  recipe_id: string;
  action_id: string;
  row: TRow;
  form_data?: TForm;
  workspace_version: number;
}

/**
 * Resposta da execução de Action Operacional.
 */
export interface ActionExecResponse {
  success: boolean;
  effects: UIEffect[];
  newWorkspaceVersion: number;
}

/**
 * Contrato de requisição de dados de um componente específico.
 */
export interface ComponentDataRequest {
  recipe_id: string;
  page?: number;
  page_size?: number;
  start_date: string;
  end_date: string;
  sort_by?: string;
  order?: "asc" | "desc";
  search?: string;
}

/**
 * Resposta paginada para componentes de tabela.
 */
export interface TableDataResponse<TRow = Record<string, unknown>> {
  type: "table";
  data: TRow[];
  meta: {
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
    sortBy?: string;
    order?: "asc" | "desc";
  };
}

/**
 * Resposta agregada para componentes de KPI (StatCard).
 */
export interface StatDataResponse {
  type: "stat";
  value: number | string;
  title?: string;
}

/**
 * Resposta de série consolidada para componentes de gráfico.
 */
export interface ChartDataResponse {
  type: "chart";
  data: Array<{ name: string; value: number; [key: string]: unknown }>;
}

export type ComponentDataResponse<TRow = Record<string, unknown>> =
  | TableDataResponse<TRow>
  | StatDataResponse
  | ChartDataResponse;

/**
 * Resposta sanitizada do UI Schema entregue ao frontend (sem código SQL).
 */
export interface DashboardSchemaResponse {
  id: string;
  name: string;
  description?: string;
  workspace: {
    params: FormFieldDef[];
  };
  actions: Array<{
    id: string;
    label: string;
    icon?: string;
    variant?: "default" | "destructive" | "secondary" | "outline" | "ghost";
    permission?: string;
  }>;
  ui: {
    layout: LayoutDefinition;
    components: UIComponentDef[];
  };
}

/**
 * Requisição de auto-save de edição inline em células.
 */
export interface PersistenceSetRequest {
  target: string;
  target_foreign_key_value: string | number;
  field: string;
  value: unknown;
  workspace_version: number;
}

/**
 * Resposta de auto-save de edição inline em células.
 */
export interface PersistenceSetResponse {
  success: boolean;
  new_version: number;
}
