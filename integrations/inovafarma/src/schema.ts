import { integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/** Um schema Postgres por Module. */
export const inovafarmaSchema = pgSchema("inovafarma");

export const vinculosColaborador = inovafarmaSchema.table("vinculos_colaborador", {
  codigoColaborador: integer("codigo_colaborador").primaryKey(),
  /** Referência lógica a `iam.users`, sem FK entre Modules. Um Usuário fica em no máximo um vínculo. */
  usuarioId: text("usuario_id").unique("vinculos_colaborador_usuario_id_unique"),
  version: integer("version").notNull().default(1),
  atualizadoPor: text("atualizado_por").notNull(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
});
