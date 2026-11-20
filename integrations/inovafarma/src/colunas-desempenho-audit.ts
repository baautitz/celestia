import { z } from "zod";
import type { AuditService } from "./vinculo-audit.js";

export const COLUNAS_DESEMPENHO_PLUGIN = "inovafarma";
export const COLUNA_DESEMPENHO_TARGET = "coluna_desempenho";
export const COLUNAS_DESEMPENHO_ACTIONS = {
  criar: "coluna_desempenho_create",
  editar: "coluna_desempenho_update",
  remover: "coluna_desempenho_delete",
} as const;

/** Nome e conteúdo já em texto: a entrada continua legível se a coluna ou o cadastro do ERP mudar. */
const Valores = z.object({ nome: z.string(), conteudo: z.string() });
const Atributos = Valores.extend({ anterior: Valores.nullable() });
export type ValoresColuna = z.infer<typeof Valores>;

const nome = (a: ValoresColuna) => `"${a.nome}"`;

export function declareColunasDesempenhoAudit(audit: AuditService): void {
  const base = { plugin: COLUNAS_DESEMPENHO_PLUGIN, schemaVersion: 1, schema: Atributos };
  audit.declareAction({ ...base, action: COLUNAS_DESEMPENHO_ACTIONS.criar, summary: (a) => `Criou a coluna ${nome(a)} do Desempenho de Vendas: ${a.conteudo}.` });
  audit.declareAction({
    ...base,
    action: COLUNAS_DESEMPENHO_ACTIONS.editar,
    summary: (a) => {
      const partes = [a.anterior && a.anterior.nome !== a.nome ? `nome de "${a.anterior.nome}" para "${a.nome}"` : null, a.anterior?.conteudo !== a.conteudo ? `conteúdo de ${a.anterior?.conteudo} para ${a.conteudo}` : null];
      return `Alterou a coluna ${nome(a)} do Desempenho de Vendas: ${partes.filter(Boolean).join("; ") || "sem mudanças"}.`;
    },
  });
  audit.declareAction({ ...base, action: COLUNAS_DESEMPENHO_ACTIONS.remover, summary: (a) => `Removeu a coluna ${nome(a)} do Desempenho de Vendas (${a.conteudo}).` });
}
