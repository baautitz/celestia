import { definePermissions } from "@platform/core/permissions";

/** Permissions do Plugin de exemplo (chaves `example:note:<acao>`). */
export const EXAMPLE_PERMISSIONS = definePermissions("example", {
  "note:read": {
    label: "Visualizar o Plugin de exemplo",
    description: "Permite abrir a tela e chamar a rota do Plugin de exemplo.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar o Plugin de exemplo.",
  },
});
