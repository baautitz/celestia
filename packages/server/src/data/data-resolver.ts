import type {
  ComponentBindingDef,
  ComponentProfileDef,
  ComponentProfileMeta,
  DataTableColumnDef,
  DataTableProps,
  PersistenceDef,
  PersistenceFieldDef,
  RecipeDef,
  StatCardProps,
  UIComponentDef,
} from "@platform/shared";
import type { PersistenceStore } from "./persistence-store.js";
import type { SourceConnector, SourceConnectorRegistry } from "./source-connector.js";
import { resolveSourceConnector } from "./source-connector.js";
import { TemplateEngine } from "../engine/template-engine.js";
import { PermissionResolver, type ResolvedQueryOption } from "../iam/permission-resolver.js";
import { WorkspaceValidator } from "../engine/workspace-validator.js";
import { isBatchable } from "../engine/recipe-sandbox.js";

export interface ResolveDataOptions {
  recipe: RecipeDef;
  workspaceId: string;
  componentId: string;
  sourceConnector?: SourceConnector;
  sourceConnectors?: SourceConnectorRegistry;
  persistenceStore: PersistenceStore;
  profileId?: string;
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
      series?: Array<{ key: string; label: string }>;
    };

interface ResolvedBinding {
  binding: ComponentBindingDef;
  query?: ResolvedQueryOption;
  persistence?: PersistenceDef;
}

export class DataResolver {
  static getComponentProfileMetadata(
    recipe: RecipeDef,
    component: UIComponentDef,
    userPermissions?: string[]
  ): ComponentProfileMeta[] {
    const bindings = this.getBindings(component, recipe);
    const profiles = this.getProfiles(component, bindings, recipe);
    this.validateProfiles(component, bindings, profiles);
    const metadata: ComponentProfileMeta[] = [];

    for (const profile of profiles) {
      const bindingMetadata: ComponentProfileMeta["bindings"] = [];
      let valid = true;

      for (const binding of bindings) {
        if (binding.persistence) {
          const persistence = recipe.persistence.find((item) => item.id === binding.persistence);
          if (!persistence || persistence.targetForeignKey !== binding.joinKey) valid = false;
          bindingMetadata.push({ id: binding.id, persistenceName: binding.persistence });
          continue;
        }

        if (!binding.source || !binding.query) {
          valid = false;
          continue;
        }

        const sourceDef = recipe.sources[binding.source];
        const optionId = profile.options[binding.id];
        if (!sourceDef || !optionId) {
          valid = false;
          continue;
        }

        try {
          const resolved = PermissionResolver.resolveQueryOption({
            recipeId: recipe.id,
            sourceName: binding.source,
            queryName: binding.query,
            sourceDef,
            userPermissions,
            optionId,
          });
          this.validateSourceBindingKey(binding, resolved.queryDef);
          bindingMetadata.push({
            id: binding.id,
            sourceName: binding.source,
            queryName: binding.query,
            optionId: resolved.option.id,
            optionLabel: resolved.option.label,
          });
        } catch {
          valid = false;
        }
      }

      if (valid) {
        metadata.push({ id: profile.id, label: profile.label, bindings: bindingMetadata });
      }
    }

    return metadata;
  }

  static async resolveComponentData(options: ResolveDataOptions): Promise<ResolveDataResult> {
    const {
      recipe,
      workspaceId,
      componentId,
      sourceConnector,
      sourceConnectors = {},
      persistenceStore,
      profileId,
      context,
      pagination,
    } = options;

    WorkspaceValidator.validateDates(context.workspace.startDate, context.workspace.endDate);

    const component = recipe.ui.components.find((item: UIComponentDef) => item.id === componentId);
    if (!component) {
      throw new Error(`Componente '${componentId}' não encontrado na recipe '${recipe.id}'.`);
    }

    const props = component.props;
    if (component.component === "stat_card" && props.source && recipe.persistence.some((p) => p.id === props.source)) {
      return this.resolvePersistenceStat(component.props, workspaceId, persistenceStore, recipe);
    }

    const rows = await this.fetchAndMergeComponentData({
      recipe,
      component,
      workspaceId,
      sourceConnector,
      sourceConnectors,
      persistenceStore,
      profileId,
      context,
    });

    if (component.component === "stat_card") {
      const statProps = component.props as StatCardProps;
      if (typeof statProps.compute === "function") {
        return { type: "stat", value: await statProps.compute(rows), title: statProps.title };
      }
      if (statProps.field) {
        return { type: "stat", value: Number(rows[0]?.[statProps.field] || 0), title: statProps.title };
      }
      if (statProps.aggregate) {
        const values = rows.map((row) => Number(row[statProps.aggregate!.field] || 0));
        const aggregate = statProps.aggregate.function;
        const value = aggregate === "count"
          ? values.length
          : aggregate === "avg"
            ? values.reduce((sum, item) => sum + item, 0) / (values.length || 1)
            : aggregate === "min"
              ? Math.min(...values, 0)
              : aggregate === "max"
                ? Math.max(...values, 0)
                : values.reduce((sum, item) => sum + item, 0);
        return { type: "stat", value, title: statProps.title };
      }
      return { type: "stat", value: 0, title: statProps.title };
    }

    if (
      component.component === "bar_chart" ||
      component.component === "pie_chart" ||
      component.component === "line_chart"
    ) {
      const nameKey = component.props.nameKey || "name";
      const valueKey = component.props.valueKey || "value";
      const seriesKey = component.props.seriesKey;
      if (seriesKey && component.component === "line_chart") {
        return this.buildSeriesChart(rows, nameKey, valueKey, seriesKey, Number(component.props.seriesLimit) || 10, component.props.cumulative === true);
      }
      const limit = Number(component.props.limit) || rows.length;
      const chartRows = rows.slice().sort((a, b) =>
        component.component === "bar_chart"
          ? Number(b[valueKey] || 0) - Number(a[valueKey] || 0)
          : 0
      );

      return {
        type: "chart",
        data: chartRows.slice(0, limit).map((row) => ({
          name: String(row[nameKey] ?? ""),
          value: Number(row[valueKey] ?? 0),
          ...row,
        })),
      };
    }

    const tableProps = component.props as DataTableProps;
    let tableRows = rows;
    const columns = tableProps.columns as DataTableColumnDef[];

    // Uma coluna por vez (as seguintes enxergam o valor das anteriores). Colunas de Modelos rodam no isolate:
    // em lote, numa única ida, quando possível.
    for (const column of columns) {
      const compute = column.compute;
      if (typeof compute !== "function") continue;
      const values = isBatchable<Record<string, unknown>, unknown>(compute)
        ? await compute.batch(tableRows)
        : await Promise.all(tableRows.map((row) => compute(row)));
      tableRows.forEach((row, index) => {
        row[column.key] = values[index];
      });
    }

    if (pagination?.search) {
      const term = pagination.search.toLowerCase();
      tableRows = tableRows.filter((row) =>
        Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term))
      );
    }

    const sortBy = pagination?.sortBy;
    const order = pagination?.order || "asc";
    if (sortBy) {
      tableRows.sort((left, right) => {
        const valueLeft = left[sortBy];
        const valueRight = right[sortBy];
        if (valueLeft === valueRight) return 0;
        if (valueLeft === null || valueLeft === undefined) return 1;
        if (valueRight === null || valueRight === undefined) return -1;
        const comparison = typeof valueLeft === "number" && typeof valueRight === "number"
          ? valueLeft - valueRight
          : String(valueLeft).localeCompare(String(valueRight));
        return order === "desc" ? -comparison : comparison;
      });
    }

    const page = pagination?.page || 1;
    const pageSize = pagination?.pageSize || tableProps.pagination?.pageSize || 10;
    const totalRecords = tableRows.length;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;
    const startIndex = (page - 1) * pageSize;

    return {
      type: "table",
      data: tableRows.slice(startIndex, startIndex + pageSize),
      meta: { page, pageSize, totalRecords, totalPages, sortBy, order },
    };
  }

  /**
   * Pivota linhas (x, série, valor) em pontos { name: x, s0: valor, s1: valor, ... }.
   * Fica com as `seriesLimit` séries de maior total; x sem valor numa série entra como 0.
   * Com `cumulative`, cada série vira a soma corrida em ordem de x (dias sem valor repetem o acumulado anterior).
   */
  private static buildSeriesChart(
    rows: Array<Record<string, unknown>>,
    nameKey: string,
    valueKey: string,
    seriesKey: string,
    seriesLimit: number,
    cumulative: boolean
  ): { type: "chart"; data: Array<{ name: string; value: number; [key: string]: unknown }>; series: Array<{ key: string; label: string }> } {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const label = String(row[seriesKey] ?? "");
      totals.set(label, (totals.get(label) ?? 0) + Number(row[valueKey] ?? 0));
    }

    // Chaves seguras (s0, s1...): nomes de vendedores podem ter ponto ou espaço, que o gráfico trataria como caminho.
    const series = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, seriesLimit)
      .map(([label], index) => ({ key: `s${index}`, label }));
    const keyByLabel = new Map(series.map((item) => [item.label, item.key]));

    const points = new Map<string, { name: string; value: number; [key: string]: unknown }>();
    for (const row of rows) {
      const key = keyByLabel.get(String(row[seriesKey] ?? ""));
      if (!key) continue;
      const name = String(row[nameKey] ?? "");
      const point = points.get(name) ?? { name, value: 0, ...Object.fromEntries(series.map((item) => [item.key, 0])) };
      const amount = Number(row[valueKey] ?? 0);
      point[key] = Number(point[key]) + amount;
      point.value += amount;
      points.set(name, point);
    }

    const data = Array.from(points.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (cumulative) {
      const running = new Map<string, number>(series.map((item) => [item.key, 0]));
      for (const point of data) {
        point.value = 0;
        for (const item of series) {
          const total = (running.get(item.key) ?? 0) + Number(point[item.key]);
          running.set(item.key, total);
          point[item.key] = total;
          point.value += total;
        }
      }
    }

    return { type: "chart", data, series };
  }

  private static getBindings(component: UIComponentDef, recipe: RecipeDef): ComponentBindingDef[] {
    const props = component.props;
    if (props.bindings && props.bindings.length > 0) return props.bindings;

    if (props.source && props.query) {
      const primaryKey = recipe.sources[props.source]?.queries[props.query]?.primaryKey || "id";
      return [{ id: "main", source: props.source, query: props.query, joinKey: primaryKey, primary: true }];
    }

    return [];
  }

  private static getProfiles(
    component: UIComponentDef,
    bindings: ComponentBindingDef[],
    recipe: RecipeDef
  ): ComponentProfileDef[] {
    if (component.props.profiles && component.props.profiles.length > 0) return component.props.profiles;

    const sourceBindings = bindings.filter((binding) => binding.source && binding.query);
    if (sourceBindings.length !== 1) {
      if (sourceBindings.length > 1) {
        throw new Error(`O componente '${component.id}' precisa declarar profiles para combinar múltiplas queries.`);
      }
      return [];
    }

    const binding = sourceBindings[0];
    const sourceDef = recipe.sources[binding.source!];
    const queryDef = sourceDef?.queries[binding.query!];
    if (!queryDef) return [];

    return queryDef.options.map((option) => ({
      id: option.id,
      label: option.label,
      options: { [binding.id]: option.id },
    }));
  }

  private static async fetchAndMergeComponentData(options: {
    recipe: RecipeDef;
    component: UIComponentDef;
    workspaceId: string;
    sourceConnector?: SourceConnector;
    sourceConnectors: SourceConnectorRegistry;
    persistenceStore: PersistenceStore;
    profileId?: string;
    context: ResolveDataOptions["context"];
  }): Promise<Record<string, unknown>[]> {
    const { recipe, component, workspaceId, sourceConnector, sourceConnectors, persistenceStore, profileId, context } = options;
    const bindings = this.getBindings(component, recipe);
    const profiles = this.getProfiles(component, bindings, recipe);
    if (bindings.length === 0) return [];
    if (profiles.length === 0) throw new Error(`O componente '${component.id}' não possui um profile de dados válido.`);
    this.validateComponentBindings(component, bindings, recipe);
    this.validateProfiles(component, bindings, profiles);

    const availableProfiles = this.getComponentProfileMetadata(recipe, component, context.user?.permissions);
    const selectedProfile = profileId
      ? availableProfiles.find((profile) => profile.id === profileId)
      : availableProfiles[0];
    if (!selectedProfile) {
      throw new Error(`Acesso negado: o profile solicitado não está autorizado para o componente '${component.id}'.`);
    }

    const profileDef = profiles.find((profile) => profile.id === selectedProfile.id);
    if (!profileDef) throw new Error(`Profile '${selectedProfile.id}' não está definido na recipe.`);

    const resolvedBindings: ResolvedBinding[] = [];
    for (const binding of bindings) {
      if (binding.persistence) {
        const persistence = recipe.persistence.find((item) => item.id === binding.persistence);
        if (!persistence) throw new Error(`Persistência '${binding.persistence}' não encontrada.`);
        resolvedBindings.push({ binding, persistence });
        continue;
      }

      if (!binding.source || !binding.query) {
        throw new Error(`Binding '${binding.id}' do componente '${component.id}' está incompleto.`);
      }
      const sourceDef = recipe.sources[binding.source];
      if (!sourceDef) throw new Error(`Fonte '${binding.source}' não definida na recipe.`);
      const queryOption = PermissionResolver.resolveQueryOption({
        recipeId: recipe.id,
        sourceName: binding.source,
        queryName: binding.query,
        sourceDef,
        userPermissions: context.user?.permissions,
        optionId: profileDef.options[binding.id],
      });
      this.validateSourceBindingKey(binding, queryOption.queryDef);
      resolvedBindings.push({ binding, query: queryOption });
    }

    const primaryBinding = resolvedBindings.find((item) => item.binding.primary) ||
      resolvedBindings.find((item) => item.query);
    if (!primaryBinding?.query) {
      throw new Error(`O componente '${component.id}' precisa de um binding externo principal.`);
    }

    const primaryRows = await this.fetchSourceRows(
      primaryBinding.binding,
      primaryBinding.query,
      sourceConnectors,
      sourceConnector,
      context
    );
    const primaryKey = primaryBinding.binding.joinKey;
    const rows = primaryRows.map((row) => ({ ...row }));

    for (const resolved of resolvedBindings) {
      if (resolved === primaryBinding) continue;

      if (resolved.query) {
        const secondaryRows = await this.fetchSourceRows(
          resolved.binding,
          resolved.query,
          sourceConnectors,
          sourceConnector,
          context
        );
        const secondaryKey = resolved.binding.joinKey;
        const secondaryByKey = new Map(secondaryRows.map((row) => [String(row[secondaryKey] ?? ""), row]));

        for (const row of rows) {
          const joined = secondaryByKey.get(String(row[primaryKey] ?? ""));
          if (!joined) continue;
          row[resolved.binding.id] = joined;
          for (const [key, value] of Object.entries(joined)) row[`${resolved.binding.id}.${key}`] = value;
        }
      }

      if (resolved.persistence) {
        for (const row of rows) {
          await this.mergePersistence(
            row,
            resolved.persistence,
            workspaceId,
            String(row[resolved.binding.joinKey] ?? row[primaryKey] ?? ""),
            persistenceStore
          );
        }
      }
    }

    if (!bindings.some((binding) => binding.persistence)) {
      for (const persistence of recipe.persistence.filter((item) => item.targetSource === primaryBinding.binding.source)) {
        for (const row of rows) {
          await this.mergePersistence(
            row,
            persistence,
            workspaceId,
            String(row[primaryKey] ?? ""),
            persistenceStore
          );
        }
      }
    }

    return rows;
  }

  private static async fetchSourceRows(
    binding: ComponentBindingDef,
    query: ResolvedQueryOption,
    sourceConnectors: SourceConnectorRegistry,
    fallbackConnector: SourceConnector | undefined,
    context: ResolveDataOptions["context"]
  ): Promise<Record<string, unknown>[]> {
    const connector = resolveSourceConnector(binding.source!, sourceConnectors, fallbackConnector);
    const parameterized = TemplateEngine.parse(query.option.sql, context);
    return connector.query(parameterized.sql, parameterized.params);
  }

  private static validateComponentBindings(
    component: UIComponentDef,
    bindings: ComponentBindingDef[],
    recipe: RecipeDef
  ): void {
    const bindingIds = new Set<string>();
    let primaryCount = 0;

    for (const binding of bindings) {
      if (bindingIds.has(binding.id)) {
        throw new Error(`O componente '${component.id}' possui bindings duplicados: '${binding.id}'.`);
      }
      bindingIds.add(binding.id);

      if (!binding.joinKey) {
        throw new Error(`O binding '${binding.id}' do componente '${component.id}' precisa declarar joinKey.`);
      }
      if (binding.primary) primaryCount += 1;

      if (binding.persistence) {
        const persistence = recipe.persistence.find((item) => item.id === binding.persistence);
        if (!persistence) {
          throw new Error(`Persistência '${binding.persistence}' não encontrada.`);
        }
        if (persistence.targetForeignKey !== binding.joinKey) {
          throw new Error(
            `A persistência '${binding.persistence}' precisa usar a foreign key '${binding.joinKey}' no componente '${component.id}'.`
          );
        }
      }
    }

    if (primaryCount > 1) {
      throw new Error(`O componente '${component.id}' possui mais de um binding primary.`);
    }
  }

  private static validateProfiles(
    component: UIComponentDef,
    bindings: ComponentBindingDef[],
    profiles: ComponentProfileDef[]
  ): void {
    const profileIds = new Set<string>();
    const bindingIds = new Set(bindings.map((binding) => binding.id));

    for (const profile of profiles) {
      if (profileIds.has(profile.id)) {
        throw new Error(`O componente '${component.id}' possui profiles duplicados: '${profile.id}'.`);
      }
      profileIds.add(profile.id);

      for (const binding of bindings) {
        if (!binding.persistence && !profile.options[binding.id]) {
          throw new Error(`O profile '${profile.id}' não seleciona uma option para o binding '${binding.id}'.`);
        }
      }

      for (const bindingId of Object.keys(profile.options)) {
        if (!bindingIds.has(bindingId)) {
          throw new Error(`O profile '${profile.id}' referencia o binding inexistente '${bindingId}'.`);
        }
      }
    }
  }

  private static validateSourceBindingKey(
    binding: ComponentBindingDef,
    queryDef: ResolvedQueryOption["queryDef"]
  ): void {
    if (queryDef.columns && !queryDef.columns.some((column) => column.name === binding.joinKey)) {
      throw new Error(`A query não declara a joinKey '${binding.joinKey}' do binding '${binding.id}'.`);
    }
  }

  private static async mergePersistence(
    row: Record<string, unknown>,
    persistence: PersistenceDef,
    workspaceId: string,
    foreignKey: string,
    persistenceStore: PersistenceStore
  ): Promise<void> {
    if (persistence.mode === "scalar") {
      const scalarData = await persistenceStore.getScalar(workspaceId, persistence.id, foreignKey);
      const scalarResolved: Record<string, unknown> = {};
      const itemSchema = persistence.itemSchema as Record<string, PersistenceFieldDef>;

      for (const [fieldKey, fieldDef] of Object.entries(itemSchema)) {
        scalarResolved[fieldKey] = scalarData?.[fieldKey] !== undefined
          ? scalarData[fieldKey]
          : fieldDef.defaultValue;
        row[`${persistence.id}.${fieldKey}`] = scalarResolved[fieldKey];
      }
      row[persistence.id] = scalarResolved;
      return;
    }

    const items = await persistenceStore.getItems(workspaceId, persistence.id, foreignKey);
    const collectionResolved: Record<string, unknown> = {
      items: items.map((item) => ({ id: item.id, ...item.data })),
    };

    for (const [computedKey, computedDef] of Object.entries(persistence.computedFields || {})) {
      const values = items.map((item) => Number(item.data?.[computedDef.aggregate.field] || 0));
      const aggregate = computedDef.aggregate.function;
      const value = aggregate === "count"
        ? values.length
        : aggregate === "avg"
          ? values.reduce((sum, item) => sum + item, 0) / (values.length || 1)
          : aggregate === "min"
            ? Math.min(...values, 0)
            : aggregate === "max"
              ? Math.max(...values, 0)
              : values.reduce((sum, item) => sum + item, 0);
      collectionResolved[computedKey] = value;
      row[`${persistence.id}.${computedKey}`] = value;
    }

    row[persistence.id] = collectionResolved;
  }

  private static async resolvePersistenceStat(
    props: StatCardProps,
    workspaceId: string,
    persistenceStore: PersistenceStore,
    recipe: RecipeDef
  ): Promise<ResolveDataResult> {
    const persistence = recipe.persistence.find((item) => item.id === props.source);
    if (!persistence) return { type: "stat", value: 0, title: props.title };
    const items = await persistenceStore.getItems(workspaceId, persistence.id);
    const field = props.aggregate?.field || "value";
    const computedField = persistence.computedFields?.[field];
    const values = items.map((item) => Number(item.data?.[computedField?.aggregate.field || field] || 0));
    const value = props.aggregate?.function === "count"
      ? values.length
      : values.reduce((sum, item) => sum + item, 0);
    return { type: "stat", value, title: props.title };
  }
}
