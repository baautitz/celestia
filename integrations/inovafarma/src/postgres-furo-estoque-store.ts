import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { justificativasAjuste, motivosAjuste } from "./schema.js";
import {
  novoIdJustificativa,
  novoIdMotivo,
  type EdicaoJustificativa,
  type EdicaoMotivo,
  type FuroEstoqueStore,
  type JustificativaAjuste,
  type MotivoAjuste,
  type NovaJustificativa,
} from "./furo-estoque-store.js";

type MotivoRow = typeof motivosAjuste.$inferSelect;
type JustificativaRow = typeof justificativasAjuste.$inferSelect;

const motivo = (row: MotivoRow): MotivoAjuste => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });
const justificativa = (row: JustificativaRow): JustificativaAjuste => ({ ...row, criadoEm: row.criadoEm.toISOString(), atualizadoEm: row.atualizadoEm.toISOString() });

export class PostgresFuroEstoqueStore implements FuroEstoqueStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listarMotivos(): Promise<MotivoAjuste[]> {
    return (await this.db.select().from(motivosAjuste).orderBy(asc(motivosAjuste.nome))).map(motivo);
  }

  async criarMotivo(nome: string): Promise<MotivoAjuste> {
    const [row] = await this.db.insert(motivosAjuste).values({ id: novoIdMotivo(), nome }).returning();
    return motivo(row!);
  }

  async atualizarMotivo(id: string, valores: EdicaoMotivo, expectedVersion: number): Promise<MotivoAjuste | null> {
    const t = motivosAjuste;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? motivo(row) : null;
  }

  async listarJustificativas(periodoId: string): Promise<JustificativaAjuste[]> {
    return (await this.db.select().from(justificativasAjuste).where(eq(justificativasAjuste.periodoId, periodoId))).map(justificativa);
  }

  async justificativa(id: string): Promise<JustificativaAjuste | null> {
    const [row] = await this.db.select().from(justificativasAjuste).where(eq(justificativasAjuste.id, id));
    return row ? justificativa(row) : null;
  }

  async justificar(nova: NovaJustificativa): Promise<JustificativaAjuste | null> {
    const [row] = await this.db
      .insert(justificativasAjuste)
      .values({ ...nova, id: novoIdJustificativa() })
      .onConflictDoNothing({ target: justificativasAjuste.codigoMovimento })
      .returning();
    return row ? justificativa(row) : null;
  }

  async atualizarJustificativa(id: string, valores: EdicaoJustificativa, expectedVersion: number): Promise<JustificativaAjuste | null> {
    const t = justificativasAjuste;
    const [row] = await this.db
      .update(t)
      .set({ ...valores, version: expectedVersion + 1, atualizadoEm: new Date() })
      .where(and(eq(t.id, id), eq(t.version, expectedVersion)))
      .returning();
    return row ? justificativa(row) : null;
  }

  async excluirJustificativa(id: string, expectedVersion: number): Promise<boolean> {
    const t = justificativasAjuste;
    const rows = await this.db.delete(t).where(and(eq(t.id, id), eq(t.version, expectedVersion))).returning({ id: t.id });
    return rows.length > 0;
  }
}
