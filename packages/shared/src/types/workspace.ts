/**
 * Intervalo de datas obrigatório de uma Área de Trabalho.
 */
export interface WorkspaceDateRange {
  startDate: string; // Formato AAAA-MM-DD
  endDate: string;   // Formato AAAA-MM-DD
}

/**
 * Status operacional da Área de Trabalho.
 */
export type WorkspaceStatus = "open" | "closed" | "archived";

/**
 * Modelo de Área de Trabalho (Workspace) da plataforma.
 */
export interface Workspace {
  id: string;                                   // Ex: "ws_fechamento_jan_2026"
  recipeId: string;                             // Ex: "fechamento_mes"
  name?: string;                                // Nome amigável (ex: "Fechamento Janeiro/2026")
  params: Record<string, unknown> & WorkspaceDateRange;
  version: number;                              // Controle de concorrência otimista
  status: WorkspaceStatus;
  createdBy?: string;                           // ID do usuário que criou
  createdAt: string;
  updatedAt: string;
}

/**
 * Resumo de uma Área de Trabalho para listagens.
 */
export interface WorkspaceSummary {
  id: string;
  recipeId: string;
  recipeName?: string;
  startDate: string;
  endDate: string;
  status: WorkspaceStatus;
  version: number;
  createdAt: string;
}

/**
 * Contrato canônico de uma Área de Trabalho exposta pela API.
 * As datas são universais e obrigatórias; os demais parâmetros
 * do Modelo são carregados em `params`.
 */
export interface WorkspaceRecord {
  id: string;
  recipeId: string;
  name: string;
  startDate: string; // Formato AAAA-MM-DD
  endDate: string; // Formato AAAA-MM-DD
  status: WorkspaceStatus;
  params?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
