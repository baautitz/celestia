import PDFDocument from "pdfkit";
import type { Pedido } from "./pedidos.js";

export interface ItemDoPdf {
  nome: string;
  quantidade: number;
  preco: number;
}

/** Quantidade total do produto no Pedido, sem divisão por Loja. */
export const quantidadeTotal = (item: Pedido["itens"][number]) => item.quantidades.reduce((soma, q) => soma + q.quantidade, 0);

/** O que o Pedido pede a este fornecedor: as linhas (produto, Loja) com ele; Pedido sem fornecedor nas linhas leva o total. */
function quantidadePedida(pedido: Pick<Pedido, "itens">, item: Pedido["itens"][number], codigoFornecedor: number): number {
  const porLinha = pedido.itens.some((i) => i.quantidades.some((q) => (q.codigosFornecedor ?? []).length > 0));
  return porLinha ? item.quantidades.filter((q) => (q.codigosFornecedor ?? []).includes(codigoFornecedor)).reduce((soma, q) => soma + q.quantidade, 0) : quantidadeTotal(item);
}

/** Só os produtos escolhidos neste fornecedor e com preço dele, na quantidade que ele confirmou (ou, sem isso, na pedida a ele). */
export function itensDoFornecedor(pedido: Pick<Pedido, "itens" | "escolhas">, codigoFornecedor: number, precos: Record<string, number | null>, quantidades: Record<string, number> | null = null): ItemDoPdf[] {
  return pedido.itens.flatMap((i) => {
    const preco = precos[i.produtoId];
    const quantidade = quantidades?.[i.produtoId] ?? quantidadePedida(pedido, i, codigoFornecedor);
    return pedido.escolhas[i.produtoId] === codigoFornecedor && preco !== null && preco !== undefined && quantidade > 0 ? [{ nome: i.nome, quantidade, preco }] : [];
  });
}

/** As Lojas que o Pedido pede a este fornecedor, com os produtos e a quantidade de cada uma (só o que tem quantidade). */
export function linhasPorLoja(pedido: Pick<Pedido, "itens">, codigoFornecedor: number): { codigoLoja: number; produtoId: string; nome: string; codigoBarra: string | null; quantidade: number }[] {
  const porLinha = pedido.itens.some((i) => i.quantidades.some((q) => (q.codigosFornecedor ?? []).length > 0));
  return pedido.itens.flatMap((i) =>
    i.quantidades
      .filter((q) => q.quantidade > 0 && (!porLinha || (q.codigosFornecedor ?? []).includes(codigoFornecedor)))
      .map((q) => ({ codigoLoja: q.codigoLoja, produtoId: i.produtoId, nome: i.nome, codigoBarra: i.codigoBarra, quantidade: q.quantidade })),
  );
}

/** O PDF por Loja: só os produtos escolhidos neste fornecedor e com preço dele, na quantidade que cada Loja pediu. */
export function itensDoFornecedorPorLoja(pedido: Pick<Pedido, "itens" | "escolhas">, codigoFornecedor: number, precos: Record<string, number | null>, nomeLoja: (codigo: number) => string): { loja: string; itens: ItemDoPdf[] }[] {
  const porLoja = new Map<number, ItemDoPdf[]>();
  for (const l of linhasPorLoja(pedido, codigoFornecedor)) {
    const preco = precos[l.produtoId];
    if (pedido.escolhas[l.produtoId] !== codigoFornecedor || preco === null || preco === undefined) continue;
    porLoja.set(l.codigoLoja, [...(porLoja.get(l.codigoLoja) ?? []), { nome: l.nome, quantidade: l.quantidade, preco }]);
  }
  return [...porLoja.entries()].sort(([a], [b]) => a - b).map(([codigo, itens]) => ({ loja: nomeLoja(codigo), itens }));
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PDF do Pedido para um fornecedor: produto, quantidade, preço e total; com `lojas`, uma seção (página) por Loja e o total geral no fim. */
export function gerarPdf({ fornecedor, data, itens, lojas }: { fornecedor: string; data: string; itens: ItemDoPdf[]; lojas?: { loja: string; itens: ItemDoPdf[] }[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    const colunas = [40, 330, 400, 480] as const;
    const linha = (y: number, [nome, qtd, preco, total]: string[]) => {
      doc.text(nome ?? "", colunas[0], y, { width: 280, lineBreak: false });
      doc.text(qtd ?? "", colunas[1], y, { width: 60, align: "right" });
      doc.text(preco ?? "", colunas[2], y, { width: 70, align: "right" });
      doc.text(total ?? "", colunas[3], y, { width: 75, align: "right" });
    };
    const tabela = (lista: ItemDoPdf[], rotuloTotal: string): number => {
      doc.font("Helvetica-Bold");
      linha(doc.y, ["Produto", "Qtd.", "Preço", "Total"]);
      doc.font("Helvetica").moveDown(0.5);
      let soma = 0;
      for (const i of lista) {
        if (doc.y > 780) doc.addPage();
        soma += i.quantidade * i.preco;
        linha(doc.y, [i.nome, String(i.quantidade), moeda(i.preco), moeda(i.quantidade * i.preco)]);
        doc.moveDown(0.3);
      }
      doc.moveDown().font("Helvetica-Bold");
      linha(doc.y, [rotuloTotal, "", "", moeda(soma)]);
      doc.font("Helvetica");
      return soma;
    };
    const cabecalho = (subtitulo?: string) => {
      doc.fontSize(16).text(`Pedido de compra - ${fornecedor}`);
      if (subtitulo) doc.fontSize(12).text(subtitulo);
      doc.fontSize(10).text(data).moveDown();
    };
    if (!lojas) {
      cabecalho();
      tabela(itens, "Total");
    } else {
      let geral = 0;
      lojas.forEach((l, n) => {
        if (n > 0) doc.addPage();
        cabecalho(`Loja: ${l.loja}`);
        geral += tabela(l.itens, `Total da Loja`);
      });
      doc.moveDown(2).font("Helvetica-Bold");
      linha(doc.y, ["Total geral", "", "", moeda(geral)]);
    }
    doc.end();
  });
}
