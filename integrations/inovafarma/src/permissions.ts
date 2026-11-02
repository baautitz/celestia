import { definePermissions } from "@platform/core/permissions";

/** Permissions do Plugin InovaFarma (chaves `inovafarma:<recurso>:<acao>`). */
export const INOVAFARMA_PERMISSIONS = definePermissions("inovafarma", {
  "integration:view": {
    label: "Visualizar módulo InovaFarma",
    description: "Permite abrir a tela e consultar dados integrados do InovaFarma.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para visualizar o InovaFarma.",
  },
  "vendas-geral:view": {
    label: "Desempenho de Vendas: Visualização Geral",
    description: "Permite ver o Desempenho de Vendas de todas as Lojas e de todos os Colaboradores.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para a Visualização Geral do Desempenho de Vendas.",
  },
  "vendas-loja:view": {
    label: "Desempenho de Vendas: Visualização Loja",
    description: "Permite ver o Desempenho de Vendas das Lojas do Colaborador vinculado ao Usuário.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para a Visualização Loja do Desempenho de Vendas.",
  },
  "vendas-individual:view": {
    label: "Desempenho de Vendas: Visualização Individual",
    description: "Permite ver o Desempenho de Vendas do Colaborador vinculado ao Usuário.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para a Visualização Individual do Desempenho de Vendas.",
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
  "pre-vencidos-lancamento:manage": {
    label: "Lançar Pré-vencidos",
    description: "Permite lançar, editar e excluir os próprios Lançamentos de Pré-vencidos no Closing Period aberto.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para lançar Pré-vencidos.",
  },
  "pre-vencidos-conferencia:view": {
    label: "Conferir Pré-vencidos",
    description: "Permite ver a Conferência dos Lançamentos de Pré-vencidos de todos os Colaboradores com as vendas do ERP.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para conferir os Pré-vencidos.",
  },
  "avaliacoes-individual:view": {
    label: "Avaliações: Visualização Individual",
    description: "Permite ver as Avaliações recebidas pelo Colaborador vinculado ao Usuário.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para ver as próprias Avaliações.",
  },
  "avaliacoes-loja:manage": {
    label: "Avaliações: Gerenciar por Loja",
    description: "Permite lançar, editar, excluir e ver as Avaliações dos Colaboradores das Lojas do Colaborador vinculado ao Usuário.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para gerenciar as Avaliações da Loja.",
  },
  "avaliacoes-geral:manage": {
    label: "Avaliações: Gerenciar todas",
    description: "Permite lançar, editar, excluir e ver as Avaliações dos Colaboradores de todas as Lojas.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para gerenciar as Avaliações de todas as Lojas.",
  },
  "furo-estoque-loja:manage": {
    label: "Furo de Estoque: Justificar por Loja",
    description: "Permite ver e justificar os Ajustes de Estoque das Lojas do Colaborador vinculado ao Usuário.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para justificar os Ajustes de Estoque da Loja.",
  },
  "furo-estoque-geral:manage": {
    label: "Furo de Estoque: Justificar todas e gerenciar Motivos",
    description: "Permite ver e justificar os Ajustes de Estoque de todas as Lojas e cadastrar os Motivos do Ajuste.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para justificar os Ajustes de Estoque de todas as Lojas.",
  },
  "tipos-meta:manage": {
    label: "Metas: Gerenciar Tipos de Meta",
    description: "Permite cadastrar, alterar, ativar e desativar os Tipos de Meta e aplicar o Alvo padrão às Metas dos Períodos abertos.",
    deniedMessage: "Acesso negado: o usuário não possui permissão para gerenciar os Tipos de Meta.",
  },
});
