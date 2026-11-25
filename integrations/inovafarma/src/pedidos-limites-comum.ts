import { API } from "./inovafarma-api";
import type { LojaOpcao } from "./loja-opcao";
import type { RegraLimite, ValorLimite } from "./pedidos-limites";
import type { SaldoLimite } from "./pedidos-limites-consumo";

export const LIMITES_BASE = `${API}/pedidos/limites`;

export type { SaldoLimite };

/** O que `GET /pedidos/limites` devolve. */
export interface CadastroLimites {
  hoje: string;
  podeGerir: boolean;
  lojas: LojaOpcao[];
  regras: RegraLimite[];
  valores: ValorLimite[];
}

export interface Fornecedor {
  codigo: number;
  nome: string;
}

export const nomeDaLoja = (lojas: LojaOpcao[], codigo: number) => lojas.find((l) => l.codigo === codigo)?.nome ?? `Loja ${codigo}`;
export const nomeDoFornecedor = (lista: Fornecedor[], codigo: number) => lista.find((f) => f.codigo === codigo)?.nome ?? `Distribuidora ${codigo}`;
