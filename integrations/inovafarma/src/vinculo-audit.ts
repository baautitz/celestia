import { z } from "zod";

export const VINCULO_ACTION = "vinculo_update";
export const VINCULO_TARGET = "colaborador";

/** O nome no momento da gravação: a entrada continua legível depois que o Usuário sai do sistema. */
const Usuario = z.object({ id: z.string(), fullname: z.string().nullable() }).nullable();
const Valores = z.object({ usuario: Usuario });
const Atributos = z.object({
  codigoColaborador: z.number().int(),
  nomeColaborador: z.string().nullable(),
  anterior: Valores,
  novo: Valores,
});
type Atributos = z.infer<typeof Atributos>;

function resumo({ codigoColaborador, nomeColaborador, anterior, novo }: Atributos): string {
  const colaborador = `Colaborador "${nomeColaborador ?? "não encontrado no ERP"}" (cód. ${codigoColaborador})`;
  const nome = (u: NonNullable<Atributos["novo"]["usuario"]>) => u.fullname ?? u.id;
  if (anterior.usuario && novo.usuario) return `Alterou o Usuário do ${colaborador} de "${nome(anterior.usuario)}" para "${nome(novo.usuario)}".`;
  if (novo.usuario) return `Vinculou o ${colaborador} ao Usuário "${nome(novo.usuario)}".`;
  return `Desfez o vínculo do ${colaborador} com o Usuário "${anterior.usuario ? nome(anterior.usuario) : ""}".`;
}

/** Forma do serviço `log` do Module `audit`; o Plugin não importa `@platform/server` (ADR 0002). */
export interface AuditService {
  declareAction<S extends z.ZodTypeAny>(def: { plugin: string; action: string; schemaVersion: number; schema: S; summary(attributes: z.infer<S>): string }): void;
  record(input: { plugin: string; action: string; actor: { id: string; name: string }; target: { type: string; id: string }; attributes: unknown }): Promise<unknown>;
}

/** Declara no Audit Log o schema da ação de alteração do vínculo (ADR 0001). */
export function declareVinculoAudit(audit: AuditService, plugin: string): void {
  audit.declareAction({ plugin, action: VINCULO_ACTION, schemaVersion: 1, schema: Atributos, summary: resumo });
}
