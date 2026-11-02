import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const METAS_PLUGIN = "inovafarma";
export { META_TARGET } from "./tipos-meta-audit.js";
export const METAS_ACTIONS = {
  criar: "meta_create",
  copiar: "meta_copy",
  participante: "meta_participante_update",
  definirAlvo: "meta_alvo_define",
  lista: "meta_lista_update",
} as const;

/** Tudo em texto (Tipo, Período, Alvos): a entrada continua legível se o Tipo de Meta ou o Colaborador mudar. */
const Base = z.object({ tipo: z.string(), periodo: z.string() });
const AtributosCriacao = Base.extend({ participantes: z.number().int() });
const AtributosCopia = Base.extend({ origem: z.string(), participantes: z.number().int(), novos: z.array(z.string()), sairam: z.array(z.string()), pendentes: z.number().int() });
const AtributosParticipante = Base.extend({
  colaborador: z.string(),
  /** O que mudou: entrou ou saiu da Meta, ou só o Alvo. */
  mudanca: z.enum(["incluido", "excluido", "alvo"]),
  rotulo: z.string(),
  alvo: z.string(),
  anterior: z.string().nullable(),
});
const AtributosDefinicao = Base.extend({ rotulo: z.string(), alvo: z.string(), participantes: z.array(z.string()) });
const AtributosLista = Base.extend({ produtos: z.array(z.string()), minimo: z.string(), ajustes: z.number().int() });

export type AtributosCriacao = z.infer<typeof AtributosCriacao>;
export type AtributosCopia = z.infer<typeof AtributosCopia>;
export type AtributosParticipante = z.infer<typeof AtributosParticipante>;
export type AtributosDefinicao = z.infer<typeof AtributosDefinicao>;
export type AtributosLista = z.infer<typeof AtributosLista>;

const plural = (n: number, palavra: string) => `${n} ${palavra}${n === 1 ? "" : "s"}`;
const daMeta = (a: z.infer<typeof Base>) => `da Meta "${a.tipo}" no período "${a.periodo}"`;

function resumoParticipante(a: AtributosParticipante): string {
  if (a.mudanca === "excluido") return `Desmarcou ${a.colaborador} ${daMeta(a)}.`;
  if (a.mudanca === "incluido") return `Incluiu ${a.colaborador} como Participante ${daMeta(a)}, com ${a.rotulo} ${a.alvo}.`;
  return `Alterou ${a.rotulo} de ${a.colaborador} ${daMeta(a)} de ${a.anterior ?? "pendente"} para ${a.alvo}.`;
}

export function declareMetasAudit(audit: AuditService): void {
  const base = { plugin: METAS_PLUGIN, schemaVersion: 1 };
  audit.declareAction({
    ...base,
    schema: AtributosCriacao,
    action: METAS_ACTIONS.criar,
    summary: (a) => `Adicionou a Meta "${a.tipo}" ao período "${a.periodo}" com ${plural(a.participantes, "Participante")}.`,
  });
  audit.declareAction({
    ...base,
    schema: AtributosCopia,
    action: METAS_ACTIONS.copiar,
    summary: (a) =>
      [
        `Copiou a Meta "${a.tipo}" do período "${a.origem}" para "${a.periodo}" com ${plural(a.participantes, "Participante")}`,
        a.novos.length ? `entraram ${a.novos.join(", ")}` : "",
        a.sairam.length ? `saíram ${a.sairam.join(", ")}` : "",
        a.pendentes ? `${plural(a.pendentes, "pendente")}` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
  });
  audit.declareAction({ ...base, schema: AtributosParticipante, action: METAS_ACTIONS.participante, summary: resumoParticipante });
  audit.declareAction({
    ...base,
    schema: AtributosDefinicao,
    action: METAS_ACTIONS.definirAlvo,
    summary: (a) => `Definiu ${a.rotulo} ${a.alvo} ${daMeta(a)} para ${plural(a.participantes.length, "Participante")}: ${a.participantes.join(", ")}.`,
  });
  audit.declareAction({
    ...base,
    schema: AtributosLista,
    action: METAS_ACTIONS.lista,
    summary: (a) =>
      `Alterou a Lista de Produtos ${daMeta(a)}: ${a.produtos.length ? a.produtos.join(", ") : "nenhum produto"}; mínimo: ${a.minimo}${a.ajustes ? `; ${plural(a.ajustes, "ajuste")} por Colaborador` : ""}.`,
  });
}
