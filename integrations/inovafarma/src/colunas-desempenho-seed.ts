// TEMPORÁRIO: só existe para criar, uma vez, as colunas que o cliente atual tinha fixas no código. Depois de aplicar no
// cliente, APAGUE este arquivo, o teste "Seed das colunas" e a chamada `semearColunas` em `desempenho-routes.ts`.
import { conferirSql } from "./lista-produtos.js";
import type { ColunaDesempenhoStore } from "./colunas-desempenho-store.js";
import { NomeDuplicadoError } from "./erros-de-store.js";
import type { ErpQuery } from "./metas-comum.js";
import type { EntradaLista } from "./tipos-meta.js";

/**
 * As colunas que o Desempenho de Vendas tinha fixas, com os ids da base do cliente atual (Vitaminas por Grupo; as demais
 * por Seção). Cada cliente tem os próprios ids: o seed só cria o que existe no ERP.
 */
const SEED: { nome: string; entrada: EntradaLista }[] = [
  { nome: "Vitaminas", entrada: { tipo: "grupo", id: "44", nome: "VITAMINAS" } },
  { nome: "Genéricos", entrada: { tipo: "secao", id: "261", nome: "GENERICOS" } },
  { nome: "Similares", entrada: { tipo: "secao", id: "271", nome: "SIMILARES" } },
  { nome: "Incentivos", entrada: { tipo: "secao", id: "281", nome: "INCENTIVOS" } },
];
export const NOME_TOTAL_FOCO = "Total Foco";

/**
 * Primeira abertura do Desempenho de Vendas com a tabela vazia: confere no ERP os ids do seed e cria só as colunas cujos
 * ids existem; o Total Foco (união delas, sem contar um produto duas vezes) só se as quatro existirem. Sem ERP, não cria
 * nada e tenta de novo na próxima abertura. Devolve se criou alguma coluna.
 */
export async function semearColunas(store: ColunaDesempenhoStore, erp: ErpQuery | undefined): Promise<boolean> {
  if (!erp || (await store.listar()).length > 0) return false;
  const consulta = conferirSql(SEED.map((s) => s.entrada));
  if (!consulta) return false;
  let existem: Set<string>;
  try {
    existem = new Set((await erp.query<{ tipo: string; id: string | number }>(consulta.sql, consulta.params)).map((r) => `${r.tipo}:${String(r.id)}`));
  } catch {
    return false;
  }
  const criadas = [];
  try {
    for (const { nome, entrada } of SEED) {
      if (existem.has(`${entrada.tipo}:${entrada.id}`)) criadas.push(await store.criar({ nome, entradas: [entrada], uniao: [], medidas: ["quantidade", "valor"] }));
    }
    if (criadas.length === SEED.length) await store.criar({ nome: NOME_TOTAL_FOCO, entradas: [], uniao: criadas.map((c) => c.id), medidas: ["quantidade", "valor"] });
  } catch (err: unknown) {
    // Outra abertura semeou ao mesmo tempo: o índice único do nome garante que não duplica.
    if (!(err instanceof NomeDuplicadoError)) throw err;
  }
  return criadas.length > 0;
}
