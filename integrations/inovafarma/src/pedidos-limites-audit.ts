import { z } from "zod";
import { PEDIDOS_PLUGIN } from "./pedidos-audit.js";
import type { AuditService } from "./vinculo-audit.js";

export const LIMITE_REGRA_TARGET = "limite_regra";
export const LIMITE_VALOR_TARGET = "limite_valor";
export const LIMITES_ACTIONS = {
  criarRegra: "limite_regra_create",
  editarRegra: "limite_regra_update",
  removerRegra: "limite_regra_delete",
  criarValor: "limite_valor_create",
  editarValor: "limite_valor_update",
  removerValor: "limite_valor_delete",
} as const;

const Regra = z.object({ nome: z.string(), entradas: z.number().int(), fornecedores: z.array(z.number().int()) });
const Valor = z.object({ regra: z.string(), inicio: z.string(), fim: z.string(), totalCentavos: z.number().int(), lojas: z.array(z.number().int()) });

const dia = (d: string) => d.split("-").reverse().join("/");
const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const doValor = (a: z.infer<typeof Valor>) =>
  `da Regra "${a.regra}", de ${dia(a.inicio)} a ${dia(a.fim)}: ${reais(a.totalCentavos)} ${a.lojas.length ? `divididos entre as Lojas ${a.lojas.join(", ")}` : "para todas as Lojas"}`;

export function declareLimitesAudit(audit: AuditService): void {
  const base = { plugin: PEDIDOS_PLUGIN, schemaVersion: 1 };
  const regra = { ...base, schema: Regra };
  const valor = { ...base, schema: Valor };
  audit.declareAction({ ...regra, action: LIMITES_ACTIONS.criarRegra, summary: (a) => `Criou a Regra de Limite "${a.nome}".` });
  audit.declareAction({ ...regra, action: LIMITES_ACTIONS.editarRegra, summary: (a) => `Alterou a Regra de Limite "${a.nome}".` });
  audit.declareAction({ ...regra, action: LIMITES_ACTIONS.removerRegra, summary: (a) => `Excluiu a Regra de Limite "${a.nome}".` });
  audit.declareAction({ ...valor, action: LIMITES_ACTIONS.criarValor, summary: (a) => `Lançou o Valor do Limite ${doValor(a)}.` });
  audit.declareAction({ ...valor, action: LIMITES_ACTIONS.editarValor, summary: (a) => `Alterou o Valor do Limite ${doValor(a)}.` });
  audit.declareAction({ ...valor, action: LIMITES_ACTIONS.removerValor, summary: (a) => `Excluiu o Valor do Limite ${doValor(a)}.` });
}
