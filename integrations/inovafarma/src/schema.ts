import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { IndicadorId } from "./indicadores.js";
import type { MetaApurada } from "./apuracao-store.js";
import type { ListaProdutos } from "./metas-store.js";
import type { Exibicao, RegraPremio } from "./tipos-meta.js";

/** Um schema Postgres por Module. */
export const inovafarmaSchema = pgSchema("inovafarma");

export const vinculosColaborador = inovafarmaSchema.table("vinculos_colaborador", {
  codigoColaborador: integer("codigo_colaborador").primaryKey(),
  /** Referência lógica a `iam.users`, sem FK entre Modules. Um Usuário fica em no máximo um vínculo. */
  usuarioId: text("usuario_id").unique("vinculos_colaborador_usuario_id_unique"),
  /** Códigos das Lojas no ERP, sem FK: uma Loja que some do ERP continua no vínculo. */
  lojas: integer("lojas").array().notNull().default(sql`'{}'::integer[]`),
  version: integer("version").notNull().default(1),
  atualizadoPor: text("atualizado_por").notNull(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
});

export const preVencidosLancamentos = inovafarmaSchema.table(
  "pre_vencidos_lancamentos",
  {
    id: text("id").primaryKey(),
    /** Referência lógica a `closing_period.periods`, sem FK entre Modules. */
    periodoId: text("periodo_id").notNull(),
    codigoColaborador: integer("codigo_colaborador").notNull(),
    nomeColaborador: text("nome_colaborador").notNull(),
    usuarioId: text("usuario_id").notNull(),
    codigoLoja: integer("codigo_loja").notNull(),
    /** Identificador opaco do produto (`Produto.rowguid`): é o que a API expõe. */
    produtoId: text("produto_id").notNull(),
    /** Código do produto no ERP: o ERP bloqueia a exibição dele, então fica só no servidor. */
    codigoProduto: integer("codigo_produto").notNull(),
    nomeProduto: text("nome_produto").notNull(),
    codigoBarra: text("codigo_barra"),
    quantidade: integer("quantidade").notNull(),
    /** Mês e ano da validade, `AAAA-MM`. */
    validade: text("validade").notNull(),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [index("pre_vencidos_lancamentos_periodo_idx").on(t.periodoId, t.codigoColaborador)],
);

export const avaliacoes = inovafarmaSchema.table(
  "avaliacoes",
  {
    id: text("id").primaryKey(),
    /** Referência lógica a `closing_period.periods`, sem FK entre Modules. */
    periodoId: text("periodo_id").notNull(),
    codigoColaborador: integer("codigo_colaborador").notNull(),
    nomeColaborador: text("nome_colaborador").notNull(),
    /** Loja do lançamento: a Avaliação não muda de Loja quando o Colaborador muda. */
    codigoLoja: integer("codigo_loja").notNull(),
    descricao: text("descricao").notNull(),
    /** Valor descontado em centavos, zero ou mais. */
    valorCentavos: integer("valor_centavos").notNull(),
    /** Referência lógica a `iam.users`: quem lançou. */
    criadoPor: text("criado_por").notNull(),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [index("avaliacoes_periodo_idx").on(t.periodoId, t.codigoLoja)],
);

export const motivosAjuste = inovafarmaSchema.table(
  "motivos_ajuste",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("motivos_ajuste_nome_unique").on(sql`lower(${t.nome})`)],
);

export const justificativasAjuste = inovafarmaSchema.table(
  "justificativas_ajuste",
  {
    id: text("id").primaryKey(),
    /** Referência lógica a `closing_period.periods`, sem FK entre Modules. */
    periodoId: text("periodo_id").notNull(),
    /** `Estoque_Movimentacao.CodigoMovimento` no ERP: um Ajuste de Estoque tem no máximo uma Justificativa. */
    codigoMovimento: integer("codigo_movimento").notNull().unique("justificativas_ajuste_codigo_movimento_unique"),
    codigoLoja: integer("codigo_loja").notNull(),
    motivoId: text("motivo_id")
      .notNull()
      .references(() => motivosAjuste.id),
    observacao: text("observacao"),
    /** Referência lógica a `iam.users`: quem justificou. */
    criadoPor: text("criado_por").notNull(),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [index("justificativas_ajuste_periodo_idx").on(t.periodoId)],
);

export const tiposMeta = inovafarmaSchema.table(
  "tipos_meta",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    /** Id do Indicador fixo no código do Plugin (`indicadores.ts`). */
    indicador: text("indicador").$type<IndicadorId>().notNull(),
    exibicao: text("exibicao").$type<Exibicao>().notNull(),
    mostrarPremio: boolean("mostrar_premio").notNull(),
    semAlvo: boolean("sem_alvo").notNull(),
    /** Regra do Prêmio validada por `RegraPremio` (R$ em centavos). */
    regra: jsonb("regra").$type<RegraPremio>().notNull(),
    /** Na unidade do Indicador (R$ em centavos). */
    alvoPadrao: doublePrecision("alvo_padrao"),
    ativo: boolean("ativo").notNull().default(true),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tipos_meta_nome_unique").on(sql`lower(${t.nome})`)],
);

export const metas = inovafarmaSchema.table(
  "metas",
  {
    id: text("id").primaryKey(),
    /** Referência lógica a `closing_period.periods`, sem FK entre Modules. */
    periodoId: text("periodo_id").notNull(),
    tipoId: text("tipo_id")
      .notNull()
      .references(() => tiposMeta.id),
    /** Colaboradores desmarcados da Meta, para a cópia automática não os incluir de novo. */
    excluidos: jsonb("excluidos").$type<number[]>().notNull().default([]),
    /** Lista de Produtos (só no Indicador Lista de Produtos). */
    lista: jsonb("lista").$type<ListaProdutos>(),
    version: integer("version").notNull().default(1),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("metas_periodo_tipo_unique").on(t.periodoId, t.tipoId)],
);

export const metasParticipantes = inovafarmaSchema.table(
  "metas_participantes",
  {
    metaId: text("meta_id")
      .notNull()
      .references(() => metas.id, { onDelete: "cascade" }),
    codigoColaborador: integer("codigo_colaborador").notNull(),
    nome: text("nome").notNull(),
    /** Na unidade do Indicador do Tipo de Meta (R$ em centavos); null: pendente. */
    alvo: doublePrecision("alvo"),
  },
  (t) => [primaryKey({ columns: [t.metaId, t.codigoColaborador] })],
);

/** Apuração das Metas gravada no fechamento do Closing Period (ADR 0007); a reabertura a apaga. */
export const apuracoesMetas = inovafarmaSchema.table("apuracoes_metas", {
  /** Referência lógica a `closing_period.periods`, sem FK entre Modules. */
  periodoId: text("periodo_id").primaryKey(),
  /** Metas com o Tipo de Meta e o resultado de cada Participante, como estavam no fechamento. */
  metas: jsonb("metas").$type<MetaApurada[]>().notNull(),
  apuradoEm: timestamp("apurado_em").notNull(),
});
