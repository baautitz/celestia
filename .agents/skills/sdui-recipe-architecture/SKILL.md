---
name: sdui-recipe-architecture
description: Guia de referência técnica e cheatsheet para desenvolvimento de Recipes em TypeScript, Componentes SDUI (Declarativos e Imperativos) e Integração com Backend na plataforma.
---

# SDUI Recipe Architecture Guide

Este guia é a referência para desenvolvimento de Dashboards, Workspaces, Componentes e Actions na plataforma.

---

## 1. Estrutura de uma Recipe (`.recipe.ts`)

Toda recipe é criada via `defineRecipe` exportada como default:

```typescript
import { defineRecipe } from "@platform/shared";

export default defineRecipe({
  id: "identificador_unico",
  name: "Nome Amigável",
  description: "Descrição da finalidade do dashboard.",

  // 1. Parâmetros solicitados na criação do Workspace
  workspace: {
    params: [
      { name: "start_date", label: "Data Inicial", type: "date", required: true },
      { name: "end_date", label: "Data Final", type: "date", required: true },
      {
        name: "categories_focus",
        label: "Categorias em Foco",
        type: "multi_select",
        required: false,
        lookup: {
          source: "inovafarma",
          query: "SELECT id AS value, name AS label FROM categories ORDER BY name"
        }
      }
    ]
  },

  // 2. Fontes de dados externas com queries permissionadas
  sources: {
    inovafarma: {
      primaryKey: "vendedor_id",
      queries: {
        all: {
          id: "q_vendas_all",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID Vendedor" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" }
          ]
        },
        self: {
          id: "q_vendas_self",
          query: `
            SELECT e.id AS vendedor_id, e.name AS vendedor, SUM(v.total) AS venda_geral
            FROM vendas v
            INNER JOIN employees e ON v.vendedor_id = e.id
            WHERE v.created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              AND e.id = {{user.externals.inovafarma}}
            GROUP BY e.id, e.name
          `,
          columns: [
            { name: "vendedor_id", type: "int", label: "ID Vendedor" },
            { name: "vendedor", type: "string", label: "Vendedor" },
            { name: "venda_geral", type: "money", label: "Venda Geral" }
          ]
        }
      }
    }
  },

  // 3. Coleções de persistência própria da plataforma
  persistence: [
    {
      id: "penalidades_vendedor",
      targetSource: "inovafarma",
      targetForeignKey: "vendedor_id",
      mode: "collection",
      itemSchema: {
        value: { type: "money", label: "Valor (R$)", defaultValue: 0 },
        reason: { type: "string", label: "Motivo", defaultValue: "" }
      },
      computedFields: {
        total_penalidades: {
          type: "money",
          aggregate: { function: "sum", field: "value" }
        }
      }
    }
  ],

  // 4. Actions operacionais (execução com componentes imperativos)
  actions: [
    {
      id: "adicionar_penalidade",
      label: "Adicionar Penalidade",
      icon: "AlertTriangle",
      permission: "recipe:fechamento_mes:action:adicionar_penalidade",
      action: async ({ row, ui, persistence }) => {
        const form = await ui.dialog.open({
          title: "Adicionar Penalidade",
          fields: [
            { name: "vendedor", label: "Vendedor", type: "text", readOnly: true, defaultValue: row.vendedor },
            { name: "valor", label: "Valor (R$)", type: "money", required: true, defaultValue: 5 },
            { name: "reason", label: "Motivo", type: "textarea", required: true }
          ]
        });
        if (!form) return;

        await persistence.push("penalidades_vendedor", {
          value: form.valor,
          reason: form.reason
        });
        ui.toast.success("Penalidade inserida!");
        ui.refresh();
      }
    },
    {
      id: "remover_penalidade",
      label: "Remover",
      icon: "Trash2",
      variant: "destructive",
      permission: "recipe:fechamento_mes:action:remover_penalidade",
      action: async ({ row, ui, persistence }) => {
        const ok = await ui.confirm("Remover?", `Deseja remover a penalidade de R$ ${row.value}?`);
        if (!ok) return;

        await persistence.delete("penalidades_vendedor", row.id);
        ui.toast.success("Penalidade removida!");
        ui.refresh();
      }
    }
  ],

  // 5. Layout declarativo do Dashboard
  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      {
        id: "kpi_total_vendas",
        component: "stat_card",
        layoutProps: { colSpan: 6 },
        props: {
          title: "Total em Vendas",
          source: "inovafarma",
          aggregate: { function: "sum", field: "venda_geral" },
          format: "currency",
          icon: "DollarSign"
        }
      },
      {
        id: "tabela_vendedores",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: {
          title: "Desempenho por Vendedor",
          source: "inovafarma",
          columns: [
            { key: "vendedor_id", label: "ID", sortable: true },
            { key: "vendedor", label: "Vendedor", sortable: true, searchable: true },
            { key: "venda_geral", label: "Venda Geral", format: "currency", sortable: true },
            { key: "penalidades_vendedor.total_penalidades", label: "Total Penalidades", format: "currency", sortable: true },
            // Coluna Calculada em TypeScript nativo (zero parser)
            {
              key: "total_a_receber",
              label: "Total a Receber",
              format: "currency",
              sortable: true,
              compute: (row) => (row.salario_base || 0) + (row.comissao || 0) - (row.penalidades_vendedor?.total_penalidades || 0)
            }
          ],
          rowActions: ["adicionar_penalidade"],
          pagination: { pageSize: 10 }
        }
      }
    ]
  }
});
```

---

## 2. Contexto das Actions & Componentes Imperativos (`ui.*`)

As funções `action` rodam assincronamente com o contexto injetado:

| Objeto | Métodos / Propriedades |
| :--- | :--- |
| **`row`** | Dados da linha selecionada (ex: `row.vendedor_id`, `row.venda_geral`). Permite cálculos aritméticos diretos (`row.venda_geral * 0.05`). |
| **`form`** | Dados submetidos via formulário (se aplicável). |
| **`persistence`** | `await persistence.push(colecao, payload)`<br>`await persistence.delete(colecao, id)`<br>`await persistence.set(colecao, id, payload)` |
| **`ui.confirm`** | `await ui.confirm(title, message)` ➔ Retorna `Promise<boolean>` |
| **`ui.prompt`** | `await ui.prompt(title, label, defaultValue?)` ➔ Retorna `Promise<string \| null>` |
| **`ui.alert`** | `await ui.alert(title, message)` ➔ Retorna `Promise<void>` |
| **`ui.dialog.open`** | `await ui.dialog.open({ title, fields })` ➔ Retorna `Promise<FormData \| null>` |
| **`ui.dialog.showTable`** | `await ui.dialog.showTable({ title, source, columns, rowActions })` |
| **`ui.toast`** | `ui.toast.success(msg)`, `ui.toast.error(msg)`, `ui.toast.warning(msg)` |
| **`ui.refresh`** | `ui.refresh()` ➔ Dispara recarregamento e recálculo da tela |
| **`workspace`** | Metadados do Workspace ativo (`workspace.id`, `workspace.start_date`, etc.) |

---

## 3. Padrões de Lookup e Componentes Especiais

- **`lookup_select`**: Quando um campo em `workspace.params` ou em `fields` de um dialog possui `lookup: { source, query }`, o frontend automaticamente renderiza um **Combobox com busca assíncrona** que consulta o ERP sem acoplamento rígido.
- **Gráficos e KPIs**: Nunca usam paginação. Sempre executam queries globais de agregação (`sum`, `count`, `avg`, `top N`).
- **Tabelas (`data_table`)**: Suportam paginação e ordenação server-side (`sort_by`, `order`, `page`, `page_size`).

---

## 4. Segurança, Permissões e Resolução Permission-First

- **Nomenclatura na Interface (PT-BR)**:
  - **Recipe** ➔ **Modelo**
  - **Workspace** ➔ **Área de Trabalho**
- **Padrão de Strings de Permissão**:
  - Sistema: `system:<modulo>:<acao>` (ex: `system:users:create`, `system:workspaces:create`)
  - Acesso ao Modelo: `recipe:<recipe_id>:view`
  - Queries: `recipe:<recipe_id>:query:<nome>` (ex: `recipe:fechamento_mes:query:all`)
  - Ações: `recipe:<recipe_id>:action:<id>` (ex: `recipe:fechamento_mes:action:adicionar_penalidade`)
- **Resolução de Queries por Ordem de Declaração**:
  - As queries de uma fonte de dados são avaliadas sequencialmente na ordem em que foram declaradas no código da Recipe. A primeira query permitida para o usuário logado é a executada.
- **Higienização Automática de Órfãs (`Pruning`)**:
  - Actions ou queries deletadas de uma Recipe têm suas permissões removidas automaticamente de todos os grupos de acesso pelo backend.

---

## 5. Validação Obrigatória de Datas da Área de Trabalho

- Toda Área de Trabalho exige obrigatoriamente `start_date` e `end_date`.
- Proteção contra inconsistência temporal: **`end_date >= start_date`** (datas invertidas são rejeitadas com HTTP 400).

