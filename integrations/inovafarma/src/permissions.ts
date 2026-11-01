import { definePermissions } from "@platform/core/permissions";

/** Permissions do Plugin InovaFarma (chaves `inovafarma:<recurso>:<acao>`). */
export const INOVAFARMA_PERMISSIONS = definePermissions("inovafarma", {
  "integration:view": {
    label: "Visualizar módulo InovaFarma",
    description: "Permite abrir a tela e consultar dados integrados do InovaFarma.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar o InovaFarma.",
  },
  "colaboradores:view": {
    label: "Visualizar Colaboradores",
    description: "Permite abrir a página Colaboradores e consultar os Colaboradores do InovaFarma.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar os Colaboradores do InovaFarma.",
  },
  "colaboradores:update": {
    label: "Alterar vínculos de Colaboradores",
    description: "Permite vincular, alterar e desfazer o vínculo de um Colaborador do InovaFarma.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para alterar os vínculos dos Colaboradores do InovaFarma.",
  },
});
