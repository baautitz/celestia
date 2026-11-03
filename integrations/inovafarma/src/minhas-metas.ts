import { diferenca, type ResultadoParticipante } from "./apuracao.js";
import type { TipoApuracao } from "./apuracao-store.js";
import { formatarValor } from "./indicadores.js";
import { descreverEntrada, indicadorDoTipo, ordenarEntradas, type Exibicao } from "./tipos-meta.js";

/** Uma Meta como o Participante a vê em Minhas Metas: só o que a Exibição e o Tipo de Meta liberam. */
export interface MinhaMeta {
  metaId: string;
  nome: string;
  exibicao: Exibicao;
  /** null no Tipo sem Alvo, que nunca é Atingida nem Não atingida. */
  atingida: boolean | null;
  /** Progresso: Realizado, Alvo (se definido) e quanto falta (se falta), na unidade do Indicador. */
  realizado?: string;
  alvo?: string;
  falta?: string;
  /** Na Lista de Produtos: o que conta, por tipo e depois por nome (ex.: "Grupo Vitaminas", "Laboratório EMS"). */
  lista?: string[];
  /** Só se o Tipo mostra o Prêmio; na Exibição Atingida / Não atingida, só com a Meta atingida. */
  premioCentavos?: number;
}

/** Uma Baixa de Pré-vencido do Colaborador em Minhas Metas. Nunca o código do produto no ERP. */
export interface MinhaBaixa {
  vendaId: number;
  /** Hora do ERP, `AAAA-MM-DD HH:MM:SS`. */
  data: string;
  /** Identificador opaco do produto. */
  produtoId: string;
  nomeProduto: string;
  codigoBarra: string | null;
  quantidadeVendida: number;
  /** Quanto da venda foi Pré-vencido. */
  quantidade: number;
}

/** Corta do resultado do Participante o que o gestor não liberou: o servidor nunca envia o resto. */
export function minhaMeta(metaId: string, tipo: TipoApuracao, r: ResultadoParticipante): MinhaMeta {
  const meta: MinhaMeta = { metaId, nome: tipo.nome, exibicao: tipo.exibicao, atingida: r.atingida };
  const indicador = indicadorDoTipo(tipo);
  // Na Meta de Avaliações o Saldo e o valor inicial são o próprio Prêmio: só aparecem se o Tipo mostra o Prêmio.
  const escondePremio = tipo.indicador === "avaliacoes" && !tipo.mostrarPremio;
  if (tipo.exibicao === "progresso" && !escondePremio) {
    meta.realizado = formatarValor(indicador, r.realizado);
    if (r.alvo !== null) {
      meta.alvo = formatarValor(indicador, r.alvo);
      // Na Meta de Avaliações o Saldo só desce: não há "quanto falta".
      const falta = indicador.direcao === "menor" ? r.realizado - r.alvo : r.alvo - r.realizado;
      if (falta > 0 && tipo.indicador !== "avaliacoes") meta.falta = diferenca(indicador, falta);
    }
  }
  if (tipo.lista) meta.lista = ordenarEntradas(tipo.lista.entradas).map(descreverEntrada);
  if (tipo.mostrarPremio && (tipo.exibicao !== "atingida" || r.atingida === true)) meta.premioCentavos = r.premioCentavos;
  return meta;
}
