import type { Pedido, PedidoStatus } from "./pedidos.js";

export type EstadoDaLinha = "pendente" | "parcial" | "recebido" | "excedente";

export interface LinhaConferida {
  produtoId: string;
  nome: string;
  codigoLoja: number;
  pedida: number;
  recebida: number;
  estado: EstadoDaLinha;
}

/** Chave de `produtoId|codigoLoja` do que entrou por NF. */
export const chaveDaLinha = (produtoId: string, codigoLoja: number) => `${produtoId}|${codigoLoja}`;

export function estadoDaLinha(pedida: number, recebida: number): EstadoDaLinha {
  if (recebida <= 0) return "pendente";
  if (recebida < pedida) return "parcial";
  return recebida === pedida ? "recebido" : "excedente";
}

/** Só os produtos com fornecedor escolhido entram na conferência, e só as Lojas com quantidade pedida. */
export function conferir(pedido: Pick<Pedido, "itens" | "escolhas">, recebidas: Map<string, number>): LinhaConferida[] {
  return pedido.itens
    .filter((i) => pedido.escolhas[i.produtoId] !== undefined)
    .flatMap((i) =>
      i.quantidades
        .filter((q) => q.quantidade > 0)
        .map((q) => {
          const recebida = recebidas.get(chaveDaLinha(i.produtoId, q.codigoLoja)) ?? 0;
          return { produtoId: i.produtoId, nome: i.nome, codigoLoja: q.codigoLoja, pedida: q.quantidade, recebida, estado: estadoDaLinha(q.quantidade, recebida) };
        }),
    );
}

/** Recebido quando nenhuma linha está pendente ou parcial; parcialmente recebido quando algo já entrou; senão segue confirmado. */
export function statusDoPedido(linhas: LinhaConferida[]): Extract<PedidoStatus, "confirmado" | "parcialmente_recebido" | "recebido"> {
  if (linhas.length > 0 && linhas.every((l) => l.estado === "recebido" || l.estado === "excedente")) return "recebido";
  return linhas.some((l) => l.recebida > 0) ? "parcialmente_recebido" : "confirmado";
}

/** Quanto ainda falta chegar por linha (`produtoId|codigoLoja`); linhas completas ou excedentes ficam de fora. */
export function aChegarPorLinha(linhas: LinhaConferida[]): Map<string, number> {
  return new Map(linhas.filter((l) => l.pedida > l.recebida).map((l) => [chaveDaLinha(l.produtoId, l.codigoLoja), l.pedida - l.recebida] as const));
}
