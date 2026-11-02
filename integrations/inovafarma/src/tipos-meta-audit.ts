import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const TIPOS_META_PLUGIN = "inovafarma";
export const TIPO_META_TARGET = "tipo_meta";
export const META_TARGET = "meta";
export const TIPOS_META_ACTIONS = {
  criar: "tipo_meta_create",
  editar: "tipo_meta_update",
  aplicarAlvoPadrao: "meta_alvo_padrao_apply",
} as const;

/** Os valores já em texto (Indicador, Exibição, Prêmio, Alvo padrão): a entrada continua legível se o catálogo mudar. */
const Valores = z.object({
  nome: z.string(),
  indicador: z.string(),
  exibicao: z.string(),
  mostrarPremio: z.boolean(),
  premio: z.string(),
  alvoPadrao: z.string().nullable(),
  ativo: z.boolean(),
});
const AtributosTipo = Valores.extend({ anterior: Valores.nullable() });
export type AtributosTipo = z.infer<typeof AtributosTipo>;
export type ValoresTipo = z.infer<typeof Valores>;

const AtributosAplicacao = z.object({ tipo: z.string(), periodo: z.string(), alvo: z.string(), participantes: z.array(z.string()) });
export type AtributosAplicacao = z.infer<typeof AtributosAplicacao>;

const nomeTipo = (a: ValoresTipo) => `"${a.nome}" (${a.indicador})`;

/** O que mudou entre duas versões do Tipo de Meta, em texto. */
function mudancas(a: AtributosTipo): string {
  const antes = a.anterior;
  if (!antes) return "";
  const partes: string[] = [];
  if (antes.nome !== a.nome) partes.push(`nome de "${antes.nome}" para "${a.nome}"`);
  if (antes.exibicao !== a.exibicao) partes.push(`Exibição de ${antes.exibicao} para ${a.exibicao}`);
  if (antes.mostrarPremio !== a.mostrarPremio) partes.push(a.mostrarPremio ? "passou a mostrar o Prêmio ao Colaborador" : "deixou de mostrar o Prêmio ao Colaborador");
  if (antes.premio !== a.premio) partes.push(`Prêmio de "${antes.premio}" para "${a.premio}"`);
  if (antes.alvoPadrao !== a.alvoPadrao) partes.push(`Alvo padrão de ${antes.alvoPadrao ?? "nenhum"} para ${a.alvoPadrao ?? "nenhum"}`);
  if (antes.ativo !== a.ativo) partes.push(a.ativo ? "reativou" : "desativou");
  return partes.length ? partes.join("; ") : "sem mudanças";
}

export function declareTiposMetaAudit(audit: AuditService): void {
  const tipo = { plugin: TIPOS_META_PLUGIN, schemaVersion: 1, schema: AtributosTipo };
  audit.declareAction({ ...tipo, action: TIPOS_META_ACTIONS.criar, summary: (a) => `Cadastrou o Tipo de Meta ${nomeTipo(a)}: ${a.premio}.` });
  audit.declareAction({ ...tipo, action: TIPOS_META_ACTIONS.editar, summary: (a) => `Alterou o Tipo de Meta ${nomeTipo(a)}: ${mudancas(a)}.` });
  audit.declareAction({
    plugin: TIPOS_META_PLUGIN,
    schemaVersion: 1,
    schema: AtributosAplicacao,
    action: TIPOS_META_ACTIONS.aplicarAlvoPadrao,
    summary: (a) =>
      `Aplicou o Alvo padrão ${a.alvo} do Tipo de Meta "${a.tipo}" a ${a.participantes.length} Participante${a.participantes.length === 1 ? "" : "s"} no período "${a.periodo}": ${a.participantes.join(", ")}.`,
  });
}
