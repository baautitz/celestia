import type {
  RecipeDef,
  PermissionCatalog,
  RecipePermissionGroup,
  PermissionItem,
  Role,
} from "@platform/shared";
import { SYSTEM_PERMISSIONS, getSystemPermissionsByModule } from "./system-permissions.js";

export class PermissionCatalogEngine {
  /**
   * Constrói o catálogo unificado de permissões inspecionando o sistema e as Recipes registradas.
   */
  static buildCatalog(recipes: Record<string, RecipeDef>): PermissionCatalog {
    const system = getSystemPermissionsByModule();
    const recipeGroups: RecipePermissionGroup[] = [];

    for (const [recipeId, recipe] of Object.entries(recipes)) {
      const group = this.extractRecipePermissions(recipeId, recipe);
      recipeGroups.push(group);
    }

    return {
      system,
      recipes: recipeGroups,
    };
  }

  /**
   * Extrai todas as permissões declaradas em uma Recipe específica.
   */
  static extractRecipePermissions(
    recipeId: string,
    recipe: RecipeDef
  ): RecipePermissionGroup {
    // 1. Permissão de Acesso Geral (View)
    const viewPermission: PermissionItem = {
      key: `recipe:${recipeId}:view`,
      label: `Acessar Modelo (${recipe.name})`,
      description: `Permite visualizar e abrir áreas de trabalho do modelo '${recipe.name}'.`,
    };

    // 2. Permissões de Consulta (Queries por Source)
    const queryPermissions: PermissionItem[] = [];
    if (recipe.sources) {
      for (const [sourceName, sourceDef] of Object.entries(recipe.sources)) {
        if (sourceDef.queries) {
          for (const [queryKey, queryObj] of Object.entries(sourceDef.queries)) {
            // Se a chave da query já estiver formatada com recipe:..., usa ela, senão gera o padrão
            const permKey = queryKey.startsWith("recipe:")
              ? queryKey
              : `recipe:${recipeId}:query:${queryKey}`;

            queryPermissions.push({
              key: permKey,
              label: `Consulta ${sourceName.toUpperCase()}: ${queryKey}`,
              description: `Permite carregar dados da fonte '${sourceName}' sob a regra '${queryKey}'.`,
            });
          }
        }
      }
    }

    // 3. Permissões de Ações Operacionais (Actions)
    const actionPermissions: PermissionItem[] = [];
    if (recipe.actions) {
      for (const action of recipe.actions) {
        const permKey = action.permission?.startsWith("recipe:")
          ? action.permission
          : `recipe:${recipeId}:action:${action.id}`;

        actionPermissions.push({
          key: permKey,
          label: `Ação: ${action.label || action.id}`,
          description: `Permite executar o botão/ação operacional '${action.label || action.id}'.`,
        });
      }
    }

    return {
      recipeId,
      recipeName: recipe.name || recipeId,
      viewPermission,
      queryPermissions,
      actionPermissions,
    };
  }

  /**
   * Retorna um Set com todas as chaves de permissão válidas ativas (Sistema + Recipes).
   */
  static getAllValidPermissionKeys(recipes: Record<string, RecipeDef>): Set<string> {
    const validKeys = new Set<string>();

    // Adiciona todas as permissões de sistema
    for (const sysPerm of SYSTEM_PERMISSIONS) {
      validKeys.add(sysPerm.key);
    }

    // Adiciona todas as permissões das recipes
    const catalog = this.buildCatalog(recipes);
    for (const group of catalog.recipes) {
      validKeys.add(group.viewPermission.key);
      for (const q of group.queryPermissions) validKeys.add(q.key);
      for (const a of group.actionPermissions) validKeys.add(a.key);
    }

    return validKeys;
  }

  /**
   * Limpa automaticamente permissões órfãs das Roles.
   * Remove permissões que foram atribuídas no passado mas cuja Action/Query/Recipe não existe mais.
   */
  static pruneOrphanPermissions(
    roles: Role[],
    recipes: Record<string, RecipeDef>
  ): { updatedRoles: Role[]; removedCount: number } {
    const validKeys = this.getAllValidPermissionKeys(recipes);
    let removedCount = 0;

    const updatedRoles = roles.map((role) => {
      const originalLength = role.permissions.length;
      const filteredPermissions = role.permissions.filter((p) => validKeys.has(p));
      removedCount += originalLength - filteredPermissions.length;

      return {
        ...role,
        permissions: filteredPermissions,
      };
    });

    return { updatedRoles, removedCount };
  }
}
