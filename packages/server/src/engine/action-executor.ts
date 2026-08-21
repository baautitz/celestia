import type {
  RecipeDef,
  ActionContext,
  ActionDef,
  UIEffect,
  ImperativeUIContext,
  PersistenceContext,
  OpenDialogOptions,
  ShowTableOptions,
  SourceDef,
} from "@platform/shared";
import type { PersistenceStore } from "../data/persistence-store.js";
import { PermissionResolver } from "../iam/permission-resolver.js";

export interface ExecuteActionOptions {
  recipe: RecipeDef;
  actionId: string;
  row: Record<string, unknown>;
  formData?: Record<string, unknown>;
  workspaceId: string;
  workspaceVersion: number;
  persistenceStore: PersistenceStore;
  userPermissions?: string[];
  contextDates?: {
    startDate: string;
    endDate: string;
    params?: Record<string, unknown>;
  };
  timeoutMs?: number;
}

export interface ExecuteActionResult {
  success: boolean;
  effects: UIEffect[];
  newWorkspaceVersion: number;
}

export class ActionExecutor {
  /**
   * Executa uma action da recipe dentro de um contexto seguro com timeout e coleta de efeitos.
   */
  static async execute(options: ExecuteActionOptions): Promise<ExecuteActionResult> {
    const {
      recipe,
      actionId,
      row,
      formData,
      workspaceId,
      workspaceVersion,
      persistenceStore,
      userPermissions,
      contextDates,
      timeoutMs = 5000,
    } = options;

    const actionDef = recipe.actions.find((a: ActionDef) => a.id === actionId);
    if (!actionDef) {
      throw new Error(`Ação '${actionId}' não encontrada na recipe '${recipe.id}'.`);
    }

    // Valida permissão do usuário para executar esta action (se fornecida lista de permissões)
    if (userPermissions && userPermissions.length > 0) {
      const allowed = PermissionResolver.canExecuteAction({
        recipeId: recipe.id,
        actionDef,
        userPermissions,
      });
      if (!allowed) {
        throw new Error(
          `Acesso negado: o usuário não possui permissão para executar a ação '${actionDef.label || actionId}'.`
        );
      }
    }

    const effects: UIEffect[] = [];

    // 1. Constrói o contexto imperativo de UI
    const ui: ImperativeUIContext = {
      confirm: async (title: string, message: string) => {
        const isConfirmed = formData?.__confirmed ?? formData?.confirmed;
        if (isConfirmed === undefined) {
          effects.push({ type: "confirm", actionId, title, message });
          return false;
        }
        return Boolean(isConfirmed);
      },
      prompt: async (title: string, label: string, defaultValue?: string) => {
        return (formData?.[label] as string | undefined) || defaultValue || null;
      },
      alert: async (title: string, message: string) => {
        effects.push({ type: "toast", variant: "info", message: `${title}: ${message}` });
      },
      dialog: {
        open: async <TFormData extends Record<string, unknown> = Record<string, unknown>>(
          dialogOptions: OpenDialogOptions
        ) => {
          if (!formData) {
            effects.push({ type: "open_dialog", actionId, options: dialogOptions });
            return null;
          }
          return formData as TFormData;
        },
        showTable: async (tableOptions: ShowTableOptions) => {
          effects.push({ type: "show_table", actionId, options: tableOptions, row });
        },
      },
      toast: {
        success: (message: string) => effects.push({ type: "toast", variant: "success", message }),
        error: (message: string) => effects.push({ type: "toast", variant: "error", message }),
        warning: (message: string) => effects.push({ type: "toast", variant: "warning", message }),
        info: (message: string) => effects.push({ type: "toast", variant: "info", message }),
      },
      refresh: () => {
        effects.push({ type: "refresh_data" });
      },
    };

    // 2. Constrói as operações de persistência
    const sourceDef = Object.values(recipe.sources)[0] as SourceDef | undefined;
    const primaryKeyField = sourceDef?.primaryKey || "id";
    const targetFkValue = String(row[primaryKeyField] ?? "");

    const persistence: PersistenceContext = {
      push: async (targetCollection: string, item: Record<string, unknown>) => {
        return await persistenceStore.pushItem(workspaceId, targetCollection, targetFkValue, item);
      },
      set: async (targetCollection: string, itemId: string | number, payload: Record<string, unknown>) => {
        return await persistenceStore.setScalar(workspaceId, targetCollection, targetFkValue || itemId, payload);
      },
      delete: async (targetCollection: string, itemId: string | number) => {
        return await persistenceStore.deleteItem(workspaceId, targetCollection, itemId);
      },
    };

    // 3. Monta o contexto da Action
    const actionContext: ActionContext = {
      row: Object.freeze({ ...row }),
      form: formData ? Object.freeze({ ...formData }) : undefined,
      persistence,
      ui,
      workspace: {
        id: workspaceId,
        startDate: contextDates?.startDate || "",
        endDate: contextDates?.endDate || "",
        params: contextDates?.params || {},
        version: workspaceVersion,
      },
    };

    // 4. Executa com timeout estrito
    const executionPromise = actionDef.action(actionContext);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Ação '${actionId}' excedeu o tempo limite de execução (${timeoutMs}ms).`));
      }, timeoutMs);
    });

    await Promise.race([executionPromise, timeoutPromise]);

    return {
      success: true,
      effects,
      newWorkspaceVersion: workspaceVersion + 1,
    };
  }
}
