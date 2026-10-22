import { definePermissions } from "@platform/core/permissions";

/** Permissões do Plugin `erp` (chaves `system:<recurso>:<acao>`). */
export const ERP_PERMISSIONS = definePermissions("system", {
  "erps:manage": {
    label: "Gerenciar ERPs",
    description: "Permite cadastrar, editar, testar e remover ERPs (SQL Server) e seus dados de acesso.",
  },
});
