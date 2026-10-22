import { definePermissions } from "@platform/core/permissions";

/** Permissões do Plugin Closing Period (chaves `closing_period:period:<acao>`). */
export const CLOSING_PERIOD_PERMISSIONS = definePermissions("closing_period", {
  "period:read": {
    label: "Visualizar Períodos de Fechamento",
    description: "Permite listar e abrir Períodos de Fechamento.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar Períodos de Fechamento.",
  },
  "period:create": {
    label: "Criar Períodos de Fechamento",
    description: "Permite criar um Período de Fechamento com data inicial e final.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para criar Períodos de Fechamento.",
  },
  "period:close": {
    label: "Fechar Períodos de Fechamento",
    description: "Permite fechar um Período de Fechamento aberto.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para fechar Períodos de Fechamento.",
  },
  "period:reopen": {
    label: "Reabrir Períodos de Fechamento",
    description: "Permite reabrir um Período de Fechamento fechado.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para reabrir Períodos de Fechamento.",
  },
  "period:cancel": {
    label: "Cancelar Períodos de Fechamento",
    description: "Permite cancelar um Período de Fechamento aberto, removendo-o e liberando as datas.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para cancelar Períodos de Fechamento.",
  },
});
