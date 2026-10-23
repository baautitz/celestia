import { definePermissions } from "@platform/core/permissions";

/** Permissions do Plugin InovaFarma (chaves `inovafarma:<recurso>:<acao>`). */
export const INOVAFARMA_PERMISSIONS = definePermissions("inovafarma", {
  "integration:view": {
    label: "Visualizar módulo InovaFarma",
    description: "Permite abrir a tela e consultar dados integrados do InovaFarma.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar o InovaFarma.",
  },
});
