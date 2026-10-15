import { hasPermission } from "./has-permission.js";
import type { ActionDef, QueryOptionDef, SourceDef, SourceQueryDef } from "@platform/shared";

export interface ResolvedQueryOption {
  queryName: string;
  queryDef: SourceQueryDef;
  option: QueryOptionDef;
  matchedPermission: string;
}

export class PermissionResolver {
  static getQueryOptionPermission(
    recipeId: string,
    queryName: string,
    option: QueryOptionDef
  ): string {
    return option.permission || `recipe:${recipeId}:query:${queryName}`;
  }

  static canUsePermission(permission: string, userPermissions?: string[]): boolean {
    return hasPermission(userPermissions, permission);
  }

  static getAuthorizedQueryOptions(options: {
    recipeId: string;
    queryName: string;
    queryDef: SourceQueryDef;
    userPermissions?: string[];
  }): QueryOptionDef[] {
    const { recipeId, queryName, queryDef, userPermissions } = options;
    return queryDef.options.filter((option) =>
      this.canUsePermission(this.getQueryOptionPermission(recipeId, queryName, option), userPermissions)
    );
  }

  static resolveQueryOption(options: {
    recipeId: string;
    sourceName: string;
    queryName: string;
    sourceDef: SourceDef;
    userPermissions?: string[];
    optionId?: string;
  }): ResolvedQueryOption {
    const { recipeId, sourceName, queryName, sourceDef, userPermissions, optionId } = options;
    const queryDef = sourceDef.queries[queryName];

    if (!queryDef) {
      throw new Error(`A query '${queryName}' não existe na fonte '${sourceName}'.`);
    }
    if (queryDef.options.length === 0) {
      throw new Error(`A query '${queryName}' da fonte '${sourceName}' precisa possuir ao menos uma option.`);
    }

    const authorizedOptions = this.getAuthorizedQueryOptions({
      recipeId,
      queryName,
      queryDef,
      userPermissions,
    });

    if (authorizedOptions.length === 0) {
      throw new Error(
        `Acesso negado: o usuário não possui permissão para nenhuma option da query '${queryName}' na fonte '${sourceName}'.`
      );
    }

    const selectedOption = optionId
      ? authorizedOptions.find((option) => option.id === optionId)
      : authorizedOptions[0];

    if (!selectedOption) {
      throw new Error(
        `Acesso negado: a option '${optionId}' da query '${queryName}' não está autorizada para o usuário.`
      );
    }

    return {
      queryName,
      queryDef,
      option: selectedOption,
      matchedPermission: this.getQueryOptionPermission(recipeId, queryName, selectedOption),
    };
  }

  static resolveSourceQuery(options: {
    recipeId: string;
    sourceName: string;
    sourceDef: SourceDef;
    userPermissions: string[];
  }): ResolvedQueryOption {
    const { recipeId, sourceName, sourceDef, userPermissions } = options;
    const queryEntries = Object.entries(sourceDef.queries);

    if (queryEntries.length === 0) {
      throw new Error(`A fonte '${sourceName}' não possui nenhuma query declarada.`);
    }

    for (const [queryName, queryDef] of queryEntries) {
      const authorizedOptions = this.getAuthorizedQueryOptions({
        recipeId,
        queryName,
        queryDef,
        userPermissions,
      });
      if (authorizedOptions.length > 0) {
        return this.resolveQueryOption({
          recipeId,
          sourceName,
          queryName,
          sourceDef,
          userPermissions,
        });
      }
    }

    throw new Error(
      `Acesso negado: o usuário não possui permissão para consultar a fonte '${sourceName}' no dashboard '${recipeId}'.`
    );
  }

  static canExecuteAction(options: {
    recipeId: string;
    actionDef: ActionDef;
    userPermissions: string[];
  }): boolean {
    const { recipeId, actionDef, userPermissions } = options;
    const fullPermKey = actionDef.permission?.startsWith("recipe:")
      ? actionDef.permission
      : `recipe:${recipeId}:action:${actionDef.id}`;

    return (
      hasPermission(userPermissions, fullPermKey) ||
      Boolean(actionDef.permission && hasPermission(userPermissions, actionDef.permission))
    );
  }

  static canViewRecipe(recipeId: string, userPermissions: string[]): boolean {
    return hasPermission(userPermissions, `recipe:${recipeId}:view`);
  }
}
