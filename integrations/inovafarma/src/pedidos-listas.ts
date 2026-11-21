import { z } from "zod";
import { EntradaLista, descreverEntrada, idValido, ordenarEntradas } from "./tipos-meta.js";

/**
 * Lista de Produtos nomeada de Pedidos: global, com tabela própria (não compartilha dados com as Listas das Metas, só o
 * formato das entradas). Uma Lista sem entradas está em montagem; com pelo menos uma, está pronta para o Lançamento.
 */
export const DadosListaPedidos = z.object({
  nome: z.string().trim().min(1, "Informe o nome da lista.").max(60, "O nome deve ter no máximo 60 caracteres."),
  entradas: z.array(EntradaLista).max(500, "A lista deve ter no máximo 500 entradas."),
});
export type DadosListaPedidos = z.infer<typeof DadosListaPedidos>;

export interface ListaPedidos extends DadosListaPedidos {
  id: string;
  version: number;
  criadoEm: string;
  atualizadoEm: string;
}

/** Pronta para o Lançamento: tem pelo menos uma entrada. */
export const listaPronta = (l: Pick<ListaPedidos, "entradas">): boolean => l.entradas.length > 0;

/** Regras que dependem de mais de um campo; null se a lista é válida. */
export function problemaDaLista(dados: DadosListaPedidos): string | null {
  if (!dados.entradas.every(idValido)) return "Uma entrada da lista tem um identificador inválido.";
  if (new Set(dados.entradas.map((e) => `${e.tipo}:${e.id}`)).size !== dados.entradas.length) return "Uma entrada aparece duas vezes na lista.";
  return null;
}

/** A lista em texto, como o Audit Log a vê (ex.: "Grupo VITAMINAS, Laboratório EMS"). */
export const descreverLista = (l: Pick<ListaPedidos, "entradas">): string => (l.entradas.length ? ordenarEntradas(l.entradas).map(descreverEntrada).join(", ") : "sem entradas");
