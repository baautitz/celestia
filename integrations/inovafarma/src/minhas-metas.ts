import { diferenca, type ResultadoParticipante } from "./apuracao.js";
import type { TipoApuracao } from "./apuracao-store.js";
import { formatarValor, indicadorPorId } from "./indicadores.js";
import type { Exibicao } from "./tipos-meta.js";

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
  /** Contagem: produtos batidos da Lista, como "19/20 produtos". */
  contagem?: string;
  /** Só se o Tipo mostra o Prêmio; na Exibição Atingida / Não atingida, só com a Meta atingida. */
  premioCentavos?: number;
}

/** Corta do resultado do Participante o que o gestor não liberou: o servidor nunca envia o resto. */
export function minhaMeta(metaId: string, tipo: TipoApuracao, r: ResultadoParticipante): MinhaMeta {
  const meta: MinhaMeta = { metaId, nome: tipo.nome, exibicao: tipo.exibicao, atingida: r.atingida };
  const indicador = indicadorPorId(tipo.indicador);
  if (tipo.exibicao === "progresso") {
    meta.realizado = formatarValor(indicador, r.realizado);
    if (r.alvo !== null) {
      meta.alvo = formatarValor(indicador, r.alvo);
      // Na Meta de Avaliações o Saldo só desce: não há "quanto falta".
      const falta = indicador.direcao === "menor" ? r.realizado - r.alvo : r.alvo - r.realizado;
      if (falta > 0 && tipo.indicador !== "avaliacoes") meta.falta = diferenca(indicador, falta);
    }
  }
  if (tipo.exibicao === "contagem") meta.contagem = `${r.realizado}/${r.totalProdutos ?? 0} produtos`;
  if (tipo.mostrarPremio && (tipo.exibicao !== "atingida" || r.atingida === true)) meta.premioCentavos = r.premioCentavos;
  return meta;
}
