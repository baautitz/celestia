import { diferenca } from "./apuracao";
import { formatarValor, type Indicador } from "./indicadores";

export interface PeriodoDaProjecao {
  startDate: string;
  endDate: string;
  status: "open" | "closed";
}

export interface Projecao {
  /** Onde o Indicador termina o Período no ritmo atual, na unidade do Indicador. */
  valor: number;
  /** Se a projeção atinge o Alvo; null sem Alvo. */
  atinge: boolean | null;
  /** O que fazer para atingir (ou manter) o Alvo, em palavras. */
  dica: string;
}

const DIA_MS = 86_400_000;
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);

/** Hoje no fuso do navegador, como os Períodos (aaaa-mm-dd). */
export function hojeLocal(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/**
 * Projeção do Participante até o fim do Período. Indicadores que acumulam (R$ e quantidades) seguem o ritmo diário
 * dos dias decorridos; os de média ou proporção (%, Ticket Médio) ficam no valor de hoje. A Meta de Avaliações não
 * projeta: o Saldo só muda com novas Avaliações.
 */
export function projetar(indicador: Indicador, realizado: number, alvo: number | null, periodo: PeriodoDaProjecao, hoje: string): Projecao | null {
  if (indicador.id === "avaliacoes") return null;
  const total = dias(periodo.startDate, periodo.endDate) + 1;
  const decorridos = Math.min(total, dias(periodo.startDate, hoje < periodo.endDate ? hoje : periodo.endDate) + 1);
  if (decorridos <= 0 || total <= 0) return null;
  const v = (n: number) => formatarValor(indicador, n);
  const atinge = (x: number) => (alvo === null ? null : indicador.direcao === "maior" ? x >= alvo : x <= alvo);
  if (periodo.status === "closed" || decorridos >= total) return { valor: realizado, atinge: atinge(realizado), dica: "Período encerrado: este é o resultado final." };

  const restantes = total - decorridos;
  const acumula = indicador.unidade !== "percentual" && indicador.id !== "ticket-medio";
  const valor = acumula ? (realizado / decorridos) * total : realizado;
  const plural = `${restantes} dia${restantes === 1 ? "" : "s"} restante${restantes === 1 ? "" : "s"}`;
  if (alvo === null) return { valor, atinge: null, dica: `No ritmo atual, termina o Período em ${v(valor)}.` };

  let dica: string;
  if (acumula && indicador.direcao === "maior") {
    const falta = alvo - realizado;
    dica =
      falta <= 0
        ? `Alvo de ${v(alvo)} já alcançado.`
        : `No ritmo atual termina em ${v(valor)}. Para atingir ${v(alvo)}, precisa de ${v(falta / restantes)} por dia nos ${plural} (hoje faz ${v(realizado / decorridos)} por dia).`;
  } else if (acumula) {
    const sobra = alvo - realizado;
    dica =
      sobra < 0
        ? `Já passou do Alvo de ${v(alvo)} em ${v(-sobra)}.`
        : `No ritmo atual termina em ${v(valor)}. Para ficar no Alvo de ${v(alvo)}, pode chegar a ${v(sobra / restantes)} por dia nos ${plural} (hoje faz ${v(realizado / decorridos)} por dia).`;
  } else if (indicador.direcao === "menor") {
    dica =
      realizado <= alvo
        ? `Dentro do Alvo: mantenha em até ${v(alvo)} nos ${plural}.`
        : `Precisa baixar ${diferenca(indicador, realizado - alvo)} para chegar ao Alvo de ${v(alvo)}.`;
  } else {
    dica =
      realizado >= alvo
        ? `Dentro do Alvo: mantenha em ${v(alvo)} ou mais nos ${plural}.`
        : `Precisa subir ${diferenca(indicador, alvo - realizado)} para chegar ao Alvo de ${v(alvo)}.`;
  }
  return { valor, atinge: atinge(valor), dica };
}
