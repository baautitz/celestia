import type { SourceDef, SourceQueryDef, ActionDef } from "@platform/shared";

export class PermissionResolver {
  /**
   * Resolve a query SQL a ser executada com base nas permissões do usuário,
   * respeitando a ordem de declaração na Recipe (a primeira compatível é selecionada).
   */
  static resolveSourceQuery(options: {
    recipeId: string;
    sourceName: string;
    sourceDef: SourceDef;
    userPermissions: string[];
  }): { queryDef: SourceQueryDef; matchedPermission: string } {
    const { recipeId, sourceName, sourceDef, userPermissions } = options;

    if (!sourceDef.queries || Object.keys(sourceDef.queries).length === 0) {
      throw new Error(`A fonte '${sourceName}' não possui nenhuma query declarada.`);
    }

    const permsSet = new Set(userPermissions);

    // Itera na ordem de declaração das chaves do objeto queries
    for (const [queryKey, queryDef] of Object.entries(sourceDef.queries)) {
      const fullPermKey = queryKey.startsWith("recipe:")
        ? queryKey
        : `recipe:${recipeId}:query:${queryKey}`;

      // Aceita se o usuário tiver a chave completa ou a chave legada direta
      if (permsSet.has(fullPermKey) || permsSet.has(queryKey)) {
        return {
          queryDef,
          matchedPermission: fullPermKey,
        };
      }
    }

    throw new Error(
      `Acesso negado: o usuário não possui permissão para consultar os dados da fonte '${sourceName}' no dashboard '${recipeId}'.`
    );
  }

  /**
   * Valida se o usuário tem permissão para executar uma ação operacional.
   */
  static canExecuteAction(options: {
    recipeId: string;
    actionDef: ActionDef;
    userPermissions: string[];
  }): boolean {
    const { recipeId, actionDef, userPermissions } = options;
    const permsSet = new Set(userPermissions);

    const fullPermKey = actionDef.permission?.startsWith("recipe:")
      ? actionDef.permission
      : `recipe:${recipeId}:action:${actionDef.id}`;

    if (permsSet.has(fullPermKey)) return true;
    if (actionDef.permission && permsSet.has(actionDef.permission)) return true;

    return false;
  }

  /**
   * Valida se o usuário tem permissão para visualizar o dashboard.
   */
  static canViewRecipe(recipeId: string, userPermissions: string[]): boolean {
    const permsSet = new Set(userPermissions);
    const viewKey = `recipe:${recipeId}:view`;
    return permsSet.has(viewKey);
  }
}
