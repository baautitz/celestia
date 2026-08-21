import { defineRecipe, type ActionContext } from "@platform/shared";

/**
 * Interface tipada da linha consolidada para fechamento de mês.
 */
export interface FechamentoVendedorRow {
  vendedor_id: number;
  vendedor: string;
  venda_geral: number;
  remuneracao_vendedor?: {
    salario_base: number;
    comissao_ajustada: number;
  };
  penalidades_vendedor?: {
    total_penalidades: number;
  };
  total_a_receber?: number;
}

/**
 * Interface tipada da linha da sub-tabela de penalidades.
 */
export interface PenalidadeItemRow {
  id: string;
  value: number;
  reason: string;
  created_at?: string;
}

export default defineRecipe<FechamentoVendedorRow>({
  id: "fechamento_mes",
  name: "Fechamento de Mês",
  description:
    "Dashboard para conferência de vendas por vendedor, ajustes de salário/comissão, penalidades, gráficos comparativos e cálculo do total a receber.",

  workspace: {
    params: [
      {
        name: "start_date",
        label: "Data Inicial",
        type: "date",
        required: true,
      },
      {
        name: "end_date",
        label: "Data Final",
        type: "date",
        required: true,
      },
      {
        name: "categories_focus",
        label: "Categorias em Foco",
        type: "multi_select",
        required: false,
        lookup: {
          source: "inovafarma",
          query:
            "SELECT id AS value, name AS label FROM categories ORDER BY name",
        },
      },
    ],
  },

  sources: {
    inovafarma: {
      primaryKey: "vendedor_id",
      queries: {
        "recipe:fechamento_mes:query:all": {
          id: "q_vendas_all",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            INNER JOIN products p ON v.product_id = p.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND ({{workspace.categories_focus}} IS NULL
                   OR p.category_id IN ({{workspace.categories_focus}}))
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "number", label: "ID Vendedor" },
            { name: "vendedor", type: "text", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" },
          ],
        },
        "recipe:fechamento_mes:query:self": {
          id: "q_vendas_self",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            INNER JOIN products p ON v.product_id = p.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND e.id = {{user.externals.inovafarma}}
              AND ({{workspace.categories_focus}} IS NULL
                   OR p.category_id IN ({{workspace.categories_focus}}))
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "number", label: "ID Vendedor" },
            { name: "vendedor", type: "text", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" },
          ],
        },
      },
    },
  },

  persistence: [
    {
      id: "penalidades_vendedor",
      targetSource: "inovafarma",
      targetForeignKey: "vendedor_id",
      mode: "collection",
      itemSchema: {
        value: { type: "money", label: "Valor (R$)", defaultValue: 0 },
        reason: { type: "text", label: "Motivo", defaultValue: "" },
      },
      computedFields: {
        total_penalidades: {
          type: "money",
          aggregate: { function: "sum", field: "value" },
        },
      },
    },

    {
      id: "remuneracao_vendedor",
      targetSource: "inovafarma",
      targetForeignKey: "vendedor_id",
      mode: "scalar",
      itemSchema: {
        salario_base: {
          type: "money",
          label: "Salário Base",
          defaultValue: 1500.0,
        },
        comissao_ajustada: {
          type: "money",
          label: "Comissão (R$)",
          defaultValue: 0.0,
        },
      },
    },
  ],

  actions: [
    {
      id: "adicionar_penalidade",
      label: "Adicionar Penalidade",
      icon: "AlertTriangle",
      nature: "mutation",
      permission: "recipe:fechamento_mes:action:adicionar_penalidade",
      action: async ({
        row,
        ui,
        persistence,
      }: ActionContext<FechamentoVendedorRow>) => {
        const form = await ui.dialog.open({
          title: "Adicionar Penalidade",
          description:
            "Informe o valor da penalidade a ser registrada para o vendedor.",
          fields: [
            {
              name: "vendedor",
              label: "Vendedor",
              type: "text",
              readOnly: true,
              defaultValue: row.vendedor,
            },
            {
              name: "valor",
              label: "Valor da Penalidade (R$)",
              type: "money",
              required: true,
              defaultValue: 5,
            },
            {
              name: "reason",
              label: "Motivo / Observação",
              type: "textarea",
              required: true,
            },
          ],
        });
        if (!form) return;

        await persistence.push("penalidades_vendedor", {
          value: form.valor,
          reason: form.reason,
        });
        ui.toast.success("Penalidade inserida com sucesso!");
        ui.refresh();
      },
    },

    {
      id: "visualizar_penalidades",
      label: "Ver Penalidades",
      icon: "Eye",
      nature: "read",
      permission: "recipe:fechamento_mes:action:visualizar_penalidades",
      action: async ({ row, ui }: ActionContext<FechamentoVendedorRow>) => {
        await ui.dialog.showTable({
          title: `Penalidades de ${row.vendedor}`,
          size: "lg",
          source: "penalidades_vendedor",
          columns: [
            { key: "value", label: "Valor (R$)", format: "currency" },
            { key: "reason", label: "Motivo" },
            { key: "created_at", label: "Data/Hora", format: "datetime" },
          ],
          rowActions: ["remover_penalidade"],
        });
      },
    },

    {
      id: "remover_penalidade",
      label: "Remover",
      icon: "Trash2",
      nature: "mutation",
      variant: "destructive",
      permission: "recipe:fechamento_mes:action:remover_penalidade",
      action: async ({
        row,
        ui,
        persistence,
      }: ActionContext<PenalidadeItemRow>) => {
        const ok = await ui.confirm(
          "Remover Penalidade?",
          `Tem certeza que deseja remover esta penalidade de R$ ${row.value}?`,
        );
        if (!ok) return;

        await persistence.delete("penalidades_vendedor", row.id);
        ui.toast.success("Penalidade removida com sucesso!");
        ui.refresh();
      },
    },
  ],

  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      // ─── LINHA 1: 3 CARDS DE KPI (Valores Totais Consolidados) ───
      {
        id: "kpi_total_vendas",
        component: "stat_card",
        layoutProps: { colSpan: 4 },
        props: {
          title: "Total em Vendas",
          source: "inovafarma",
          aggregate: { function: "sum", field: "venda_geral" },
          format: "currency",
          icon: "DollarSign",
        },
      },
      {
        id: "kpi_total_penalidades",
        component: "stat_card",
        layoutProps: { colSpan: 4 },
        props: {
          title: "Total em Penalidades",
          source: "penalidades_vendedor",
          aggregate: { function: "sum", field: "total_penalidades" },
          format: "currency",
          icon: "AlertCircle",
        },
      },
      {
        id: "kpi_total_folha",
        component: "stat_card",
        layoutProps: { colSpan: 4 },
        props: {
          title: "Total Líquido a Pagar",
          format: "currency",
          icon: "Wallet",
          compute: (rows: FechamentoVendedorRow[]) =>
            rows.reduce((acc, row) => {
              const salario = row.remuneracao_vendedor?.salario_base || 0;
              const comissao = row.remuneracao_vendedor?.comissao_ajustada || 0;
              const penalidades =
                row.penalidades_vendedor?.total_penalidades || 0;
              return acc + (salario + comissao - penalidades);
            }, 0),
        },
      },

      // ─── LINHA 2: GRÁFICOS SEM PAGINAÇÃO (Séries Agrupadas) ──────
      {
        id: "grafico_ranking_vendas",
        component: "bar_chart",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Ranking de Vendas por Vendedor",
          source: "inovafarma",
          nameKey: "vendedor",
          valueKey: "venda_geral",
          limit: 10,
        },
      },
      {
        id: "grafico_pizza_vendas",
        component: "pie_chart",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Distribuição das Vendas na Equipe",
          source: "inovafarma",
          nameKey: "vendedor",
          valueKey: "venda_geral",
        },
      },

      // ─── LINHA 3: TABELA OPERACIONAL COMPLETA (Paginada) ─────────
      {
        id: "tabela_vendedores",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: {
          title: "Fechamento da Folha por Vendedor",
          source: "inovafarma",
          columns: [
            { key: "vendedor_id", label: "ID", sortable: true },
            {
              key: "vendedor",
              label: "Vendedor",
              sortable: true,
              searchable: true,
            },
            {
              key: "venda_geral",
              label: "Venda Geral",
              format: "currency",
              sortable: true,
            },
            {
              key: "remuneracao_vendedor.salario_base",
              label: "Salário Base",
              format: "currency",
              sortable: true,
              editable: true,
              editType: "money",
              permission: "recipe:fechamento_mes:edit",
            },
            {
              key: "remuneracao_vendedor.comissao_ajustada",
              label: "Comissão (R$)",
              format: "currency",
              sortable: true,
              editable: true,
              editType: "money",
              permission: "recipe:fechamento_mes:edit",
            },
            {
              key: "penalidades_vendedor.total_penalidades",
              label: "Penalidades (-)",
              format: "currency",
              sortable: true,
            },
            {
              key: "total_a_receber",
              label: "Total a Receber (=)",
              format: "currency",
              sortable: true,
              compute: (row: FechamentoVendedorRow) => {
                const salario = row.remuneracao_vendedor?.salario_base || 0;
                const comissao =
                  row.remuneracao_vendedor?.comissao_ajustada || 0;
                const penalidades =
                  row.penalidades_vendedor?.total_penalidades || 0;
                return salario + comissao - penalidades;
              },
            },
          ],
          rowActions: ["visualizar_penalidades", "adicionar_penalidade"],
          pagination: { pageSize: 10 },
        },
      },
    ],
  },
});
