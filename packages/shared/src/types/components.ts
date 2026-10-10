/**
 * Tipos de formatação suportados nas células e componentes.
 */
export type DataFormat = "currency" | "datetime" | "date" | "number" | "text" | "percent";

export interface QueryOptionMeta {
  id: string;
  label: string;
}

export interface ComponentBindingDef {
  id: string;
  source?: string;
  query?: string;
  persistence?: string;
  joinKey: string;
  primary?: boolean;
}

export interface ComponentProfileDef {
  id: string;
  label: string;
  options: Record<string, string>;
}

export interface ComponentProfileBindingMeta {
  id: string;
  sourceName?: string;
  queryName?: string;
  persistenceName?: string;
  optionId?: string;
  optionLabel?: string;
}

export interface ComponentProfileMeta {
  id: string;
  label: string;
  bindings: ComponentProfileBindingMeta[];
}

/**
 * Definição de layout em grade responsiva CSS Grid (12 colunas).
 */
export interface LayoutDefinition {
  type: "grid";
  /** Número de colunas da grade (geralmente 12). */
  columns: number;
  /** Espaçamento entre células em pixels (ex: 16 → gap-4). */
  gap?: number;
  /** Altura mínima de cada linha em pixels (default: 140). */
  rowHeight?: number;
}

/**
 * Configuração de edição inline de células na tabela.
 */
export type CellEditConfig =
  | { type: "money"; precision?: number; prefix?: string; allowNegative?: boolean }
  | { type: "number"; precision?: number; suffix?: string; min?: number; max?: number }
  | { type: "text"; maxLength?: number }
  | { type: "switch" }
  | { type: "select"; options: Array<{ value: string | number; label: string }> | string[] };

/**
 * Definição de Coluna na Tabela de Dados (data_table).
 */
export interface DataTableColumnDef<TRow = Record<string, unknown>> {
  key: string;
  label: string;
  format?: DataFormat;
  sortable?: boolean;
  searchable?: boolean;
  editable?: boolean;
  editType?: "text" | "money" | "number" | "switch" | "select";
  editConfig?: CellEditConfig;
  permission?: string;
  /** "danger_if_positive": o valor fica em vermelho quando for maior que zero. */
  tone?: "danger_if_positive";
  /** Função TypeScript pura para cálculo dinâmico da coluna (zero parser!) */
  compute?: (row: TRow) => number | string | boolean;
}

/**
 * Propriedades do componente StatCard (KPI).
 */
export interface StatCardProps<TRow = Record<string, unknown>> {
  title: string;
  source?: string;
  query?: string;
  field?: string;
  bindings?: ComponentBindingDef[];
  profiles?: ComponentProfileDef[];
  availableProfiles?: ComponentProfileMeta[];
  aggregate?: {
    function: "sum" | "count" | "avg" | "min" | "max";
    field: string;
  };
  format?: DataFormat;
  icon?: string;
  /** Função de agregação dinâmica em TypeScript puro sobre todas as linhas */
  compute?: (rows: TRow[]) => number | string;
}

/**
 * Propriedades do componente DataTable.
 */
export interface DataTableProps<TRow = Record<string, unknown>> {
  title?: string;
  source: string;
  query?: string;
  bindings?: ComponentBindingDef[];
  profiles?: ComponentProfileDef[];
  availableProfiles?: ComponentProfileMeta[];
  columns: DataTableColumnDef<TRow>[];
  rowActions?: string[];
  pagination?: {
    pageSize?: number;
    type?: "client" | "server";
  };
}

/**
 * Propriedades para componentes de Gráficos (Bar, Line, Pie).
 */
export interface ChartProps {
  title?: string;
  source: string;
  query?: string;
  bindings?: ComponentBindingDef[];
  profiles?: ComponentProfileDef[];
  availableProfiles?: ComponentProfileMeta[];
  nameKey: string;
  valueKey: string;
  limit?: number;
  /**
   * Somente bar_chart. "vertical" (padrão): barras em pé, nomes no eixo X.
   * "horizontal": barras deitadas, nomes no eixo Y (bom para nomes longos).
   */
  orientation?: "vertical" | "horizontal";
  /**
   * Somente line_chart. Coluna que separa as séries: uma linha por valor (ex.: "vendedor").
   * Neste modo `nameKey` é o eixo X (ex.: o dia) e `valueKey` o valor de cada ponto.
   */
  seriesKey?: string;
  /** Máximo de séries (linhas), ficando as de maior total no período. Padrão: 10. */
  seriesLimit?: number;
  /** Somente com seriesKey: cada série mostra o acumulado (soma corrida) ao longo do eixo X, em vez do valor de cada ponto. */
  cumulative?: boolean;
  /**
   * Somente com seriesKey: mostra um seletor "Acumulado / Por dia" no gráfico.
   * `cumulative` passa a ser só o modo inicial.
   */
  cumulativeToggle?: boolean;
  [key: string]: unknown;
}

/**
 * Props de layout de um componente na grade SDUI.
 */
interface LayoutProps {
  /** Número de colunas que o componente ocupa (1-12). Mobile: sempre col-span-12. */
  colSpan?: number;
  /** Número de linhas que o componente ocupa (1-12). Mobile: sempre row-span-1. */
  rowSpan?: number;
}

/**
 * Componentes visuais do layout SDUI suportados na árvore declarativa.
 */
export type UIComponentDef<TRow = Record<string, unknown>> =
  | {
      id: string;
      component: "stat_card";
      layoutProps?: LayoutProps;
      props: StatCardProps<TRow>;
    }
  | {
      id: string;
      component: "data_table";
      layoutProps?: LayoutProps;
      props: DataTableProps<TRow>;
    }
  | {
      id: string;
      component: "bar_chart" | "line_chart" | "pie_chart";
      layoutProps?: LayoutProps;
      props: ChartProps;
    };
