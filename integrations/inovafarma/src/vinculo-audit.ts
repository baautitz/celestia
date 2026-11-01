import { z } from "zod";

export const VINCULO_ACTION = "vinculo_update";
export const VINCULO_TARGET = "colaborador";

/** O nome no momento da gravação: a entrada continua legível depois que o Usuário sai do sistema. */
const Usuario = z.object({ id: z.string(), fullname: z.string().nullable() }).nullable();
const Loja = z.object({ codigo: z.number().int(), nome: z.string().nullable() });
const Valores = z.object({ usuario: Usuario, lojas: z.array(Loja) });
const Atributos = z.object({
  codigoColaborador: z.number().int(),
  nomeColaborador: z.string().nullable(),
  anterior: Valores,
  novo: Valores,
});
type Atributos = z.infer<typeof Atributos>;

type Valores = z.infer<typeof Valores>;

const nomeUsuario = ({ usuario }: Valores) => (usuario ? `"${usuario.fullname ?? usuario.id}"` : "nenhum");
const nomesLojas = ({ lojas }: Valores) => (lojas.length ? lojas.map((l) => `"${l.nome ?? `cód. ${l.codigo}`}"`).join(", ") : "nenhuma");
const semVinculo = ({ usuario, lojas }: Valores) => !usuario && lojas.length === 0;

function resumo({ codigoColaborador, nomeColaborador, anterior, novo }: Atributos): string {
  const colaborador = `Colaborador "${nomeColaborador ?? "não encontrado no ERP"}" (cód. ${codigoColaborador})`;

  if (semVinculo(anterior) || semVinculo(novo)) {
    const valores = semVinculo(novo) ? anterior : novo;
    const [aoUsuario, asLojas, inicio] = semVinculo(novo)
      ? ["o Usuário", "as Lojas", `Desfez o vínculo do ${colaborador} com`]
      : ["ao Usuário", "às Lojas", `Vinculou o ${colaborador}`];
    const partes = [valores.usuario && `${aoUsuario} ${nomeUsuario(valores)}`, valores.lojas.length > 0 && `${asLojas} ${nomesLojas(valores)}`].filter(Boolean);
    return `${inicio} ${partes.join(" e ")}.`;
  }

  const mudouUsuario = anterior.usuario?.id !== novo.usuario?.id;
  const mudouLojas = anterior.lojas.map((l) => l.codigo).join() !== novo.lojas.map((l) => l.codigo).join();
  const deUsuario = `de ${nomeUsuario(anterior)} para ${nomeUsuario(novo)}`;
  const deLojas = `de ${nomesLojas(anterior)} para ${nomesLojas(novo)}`;
  if (mudouUsuario && mudouLojas) return `Alterou o Usuário do ${colaborador} ${deUsuario} e as Lojas ${deLojas}.`;
  if (mudouUsuario) return `Alterou o Usuário do ${colaborador} ${deUsuario}.`;
  return `Alterou as Lojas do ${colaborador} ${deLojas}.`;
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
