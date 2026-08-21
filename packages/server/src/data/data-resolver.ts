import type {
  RecipeDef,
  PersistenceDef,
  DataTableColumnDef,
  UIComponentDef,
  PersistenceFieldDef,
  ComputedFieldDef,
  StatCardProps,
  SourceQueryDef,
} from "@platform/shared";
import type { PersistenceStore } from "./persistence-store.js";
import type { SourceConnector } from "./source-connector.js";
import { TemplateEngine } from "../engine/template-engine.js";
import { PermissionResolver } from "../iam/permission-resolver.js";
import { WorkspaceValidator } from "../engine/workspace-validator.js";

export interface ResolveDataOptions {
  recipe: RecipeDef;
  workspaceId: string;
  componentId: string;
  sourceConnector: SourceConnector;
  persistenceStore: PersistenceStore;
  context: {
    workspace: {
      startDate: string;
      endDate: string;
      params?: Record<string, unknown>;
    };
    user?: {
      id?: string;
      role?: string;
      permissions?: string[];
      externals?: Record<string, string | number>;
    };
  };
  pagination?: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    order?: "asc" | "desc";
    search?: string;
  };
}

export type ResolveDataResult<TRow = Record<string, unknown>> =
  | {
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
  | {
      type: "stat";
      value: number | string;
      title?: string;
    }
  | {
      type: "chart";
      data: Array<{ name: string; value: number; [key: string]: unknown }>;
    };

export class DataResolver {
  /**
   * Resolve e entrega os dados específicos para o tipo de componente:
   * - stat_card: Valor único consolidado (agregado/compute)
   * - bar_chart / pie_chart: Séries de dados completas sem paginação
   * - data_table: Linhas ordenadas, filtradas e paginadas + metadados
   */
  static async resolveComponentData(options: ResolveDataOptions): Promise<ResolveDataResult> {
    const { recipe, workspaceId, componentId, sourceConnector, persistenceStore, context, pagination } = options;

    // Validação estrita de Datas Obrigatórias da Área de Trabalho (impede data final < data inicial)
    WorkspaceValidator.validateDates(
      context?.workspace?.startDate,
      context?.workspace?.endDate
    );

    const component = recipe.ui.components.find((c: UIComponentDef) => c.id === componentId);
    if (!component) {
      throw new Error(`Componente '${componentId}' não encontrado na recipe '${recipe.id}'.`);
    }

    // ─── 1. RESOLUÇÃO DE STAT_CARD (KPI) ───────────────────────────
    if (component.component === "stat_card") {
      const props = component.props as StatCardProps;

      if (props.source && recipe.sources[props.source]) {
        const mergedRows = await this.fetchAndMergeSourceData({
          recipe,
          sourceName: props.source,
          workspaceId,
          sourceConnector,
          persistenceStore,
          context,
        });

        if (typeof props.compute === "function") {
          const computedVal = props.compute(mergedRows);
          return { type: "stat", value: computedVal, title: props.title };
        }

        if (props.aggregate) {
          const field = props.aggregate.field;
          const sum = mergedRows.reduce((acc, r) => acc + Number(r[field] || 0), 0);
          const val = props.aggregate.function === "avg" ? sum / (mergedRows.length || 1) : sum;
          return { type: "stat", value: val, title: props.title };
        }
      }

      if (props.source) {
        const pDef = recipe.persistence.find((p) => p.id === props.source);
        if (pDef) {
          const items = await persistenceStore.getItems(workspaceId, pDef.id);
          const aggregateField =
            pDef.computedFields?.[props.aggregate?.field || ""]?.aggregate.field ||
            props.aggregate?.field ||
            "value";

          const sum = items.reduce((acc, curr) => acc + Number(curr.data?.[aggregateField] || 0), 0);
          const val = props.aggregate?.function === "avg" ? sum / (items.length || 1) : sum;
          return { type: "stat", value: val, title: props.title };
        }
      }

      if (typeof props.compute === "function") {
        const firstSourceName = Object.keys(recipe.sources)[0] || "";
        const mergedRows = firstSourceName
          ? await this.fetchAndMergeSourceData({
              recipe,
              sourceName: firstSourceName,
              workspaceId,
              sourceConnector,
              persistenceStore,
              context,
            })
          : [];

        return { type: "stat", value: props.compute(mergedRows), title: props.title };
      }

      return { type: "stat", value: 0, title: props.title };
    }

    // ─── 2. RESOLUÇÃO DE CHARTS (Bar / Pie / Line) ─────────────────
    if (
      component.component === "bar_chart" ||
      component.component === "pie_chart" ||
      component.component === "line_chart"
    ) {
      const sourceName = component.props.source as string;
      const mergedRows = await this.fetchAndMergeSourceData({
        recipe,
        sourceName,
        workspaceId,
        sourceConnector,
        persistenceStore,
        context,
      });

      const nameKey = (component.props.nameKey as string) || "name";
      const valueKey = (component.props.valueKey as string) || "value";
      const limit = Number(component.props.limit) || mergedRows.length;

      // Ordena decrescente por valor no gráfico se for bar_chart (Ranking)
      if (component.component === "bar_chart") {
        mergedRows.sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));
      }

      const chartData = mergedRows.slice(0, limit).map((r) => ({
        name: String(r[nameKey] ?? ""),
        value: Number(r[valueKey] ?? 0),
        ...r,
      }));

      return { type: "chart", data: chartData };
    }

    // ─── 3. RESOLUÇÃO DE DATA_TABLE ────────────────────────────────
    if (component.component === "data_table") {
      const sourceName = component.props.source;
      let mergedRows = await this.fetchAndMergeSourceData({
        recipe,
        sourceName,
        workspaceId,
        sourceConnector,
        persistenceStore,
        context,
      });

      // 3.1 Executa funções compute de colunas calculadas primeiro
      const columns = component.props.columns as DataTableColumnDef[];
      for (const rawRow of mergedRows) {
        for (const col of columns) {
          if (typeof col.compute === "function") {
            rawRow[col.key] = col.compute(rawRow);
          }
        }
      }

      // 3.2 Busca textual global (se informada)
      if (pagination?.search) {
        const term = pagination.search.toLowerCase();
        mergedRows = mergedRows.filter((row) =>
          Object.values(row).some((val) => String(val ?? "").toLowerCase().includes(term))
        );
      }

      // 3.3 Ordenação em memória da lista completa
      const sortBy = pagination?.sortBy;
      const order = pagination?.order || "asc";
      if (sortBy) {
        mergedRows.sort((a, b) => {
          const valA = a[sortBy];
          const valB = b[sortBy];

          if (valA === valB) return 0;
          if (valA === null || valA === undefined) return 1;
          if (valB === null || valB === undefined) return -1;

          if (typeof valA === "number" && typeof valB === "number") {
            return order === "desc" ? valB - valA : valA - valB;
          }

          const strA = String(valA).toLowerCase();
          const strB = String(valB).toLowerCase();
          return order === "desc" ? (strB > strA ? 1 : -1) : (strA > strB ? 1 : -1);
        });
      }

      // 3.4 Paginação da lista já ordenada e calculada
      const page = pagination?.page || 1;
      const pageSize = pagination?.pageSize || component.props.pagination?.pageSize || 10;
      const totalRecords = mergedRows.length;
      const totalPages = Math.ceil(totalRecords / pageSize) || 1;

      const startIndex = (page - 1) * pageSize;
      const paginatedRows = mergedRows.slice(startIndex, startIndex + pageSize);

      return {
        type: "table",
        data: paginatedRows,
        meta: {
          page,
          pageSize,
          totalRecords,
          totalPages,
          sortBy,
          order,
        },
      };
    }

    throw new Error(`Tipo de componente '${(component as UIComponentDef).component}' não suportado.`);
  }

  /**
   * Helper que busca e funde os dados do ERP com as persistências da plataforma.
   */
  private static async fetchAndMergeSourceData(opts: {
    recipe: RecipeDef;
    sourceName: string;
    workspaceId: string;
    sourceConnector: SourceConnector;
    persistenceStore: PersistenceStore;
    context: ResolveDataOptions["context"];
  }): Promise<Record<string, unknown>[]> {
    const { recipe, sourceName, workspaceId, sourceConnector, persistenceStore, context } = opts;
    const sourceDef = recipe.sources[sourceName];
    if (!sourceDef) {
      throw new Error(`Fonte '${sourceName}' não definida na recipe.`);
    }

    const userPermissions = context.user?.permissions;
    let selectedQueryDef: SourceQueryDef | undefined;

    if (userPermissions && userPermissions.length > 0) {
      const resolved = PermissionResolver.resolveSourceQuery({
        recipeId: recipe.id,
        sourceName,
        sourceDef,
        userPermissions,
      });
      selectedQueryDef = resolved.queryDef;
    } else {
      selectedQueryDef = sourceDef.queries["default"] || Object.values(sourceDef.queries)[0];
    }

    if (!selectedQueryDef) {
      throw new Error(`Nenhuma query encontrada para '${sourceName}'.`);
    }

    const parameterized = TemplateEngine.parse(selectedQueryDef.query, context);
    const rawRows = await sourceConnector.query(parameterized.sql, parameterized.params);

    const relevantPersistences = recipe.persistence.filter(
      (p: PersistenceDef) => p.targetSource === sourceName
    );

    const primaryKey = sourceDef.primaryKey;
    const mergedRows: Record<string, unknown>[] = [];

    for (const rawRow of rawRows) {
      const fkValue = String(rawRow[primaryKey] ?? "");
      const mergedRow: Record<string, unknown> = { ...rawRow };

      for (const pDef of relevantPersistences) {
        if (pDef.mode === "scalar") {
          const scalarData = await persistenceStore.getScalar(workspaceId, pDef.id, fkValue);
          const scalarResolved: Record<string, unknown> = {};
          const itemSchema = pDef.itemSchema as Record<string, PersistenceFieldDef>;

          for (const [fieldKey, fieldDef] of Object.entries(itemSchema)) {
            scalarResolved[fieldKey] =
              scalarData?.[fieldKey] !== undefined ? scalarData[fieldKey] : fieldDef.defaultValue;
            mergedRow[`${pDef.id}.${fieldKey}`] = scalarResolved[fieldKey];
          }

          mergedRow[pDef.id] = scalarResolved;
        } else if (pDef.mode === "collection") {
          const items = await persistenceStore.getItems(workspaceId, pDef.id, fkValue);
          const collectionResolved: Record<string, unknown> = {
            items: items.map((i) => ({ id: i.id, ...i.data })),
          };

          if (pDef.computedFields) {
            const computedFields = pDef.computedFields as Record<string, ComputedFieldDef>;
            for (const [compKey, compDef] of Object.entries(computedFields)) {
              if (compDef.aggregate.function === "sum") {
                const sum = items.reduce((acc, curr) => {
                  const val = Number(curr.data?.[compDef.aggregate.field] || 0);
                  return acc + val;
                }, 0);

                collectionResolved[compKey] = sum;
                mergedRow[`${pDef.id}.${compKey}`] = sum;
              } else if (compDef.aggregate.function === "count") {
                collectionResolved[compKey] = items.length;
                mergedRow[`${pDef.id}.${compKey}`] = items.length;
              }
            }
          }

          mergedRow[pDef.id] = collectionResolved;
        }
      }

      mergedRows.push(mergedRow);
    }

    return mergedRows;
  }
}
