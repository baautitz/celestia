import { sql } from "drizzle-orm";
import { index, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

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
