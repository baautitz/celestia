import PDFDocument from "pdfkit";
import type { Pedido } from "./pedidos.js";

export interface ItemDoPdf {
  nome: string;
  quantidade: number;
  preco: number;
}

/** Quantidade total do produto no Pedido, sem divisão por Loja. */
export const quantidadeTotal = (item: Pedido["itens"][number]) => item.quantidades.reduce((soma, q) => soma + q.quantidade, 0);

/** Só os produtos escolhidos neste fornecedor e com preço dele. */
export function itensDoFornecedor(pedido: Pick<Pedido, "itens" | "escolhas">, codigoFornecedor: number, precos: Record<string, number | null>): ItemDoPdf[] {
  return pedido.itens.flatMap((i) => {
    const preco = precos[i.produtoId];
    return pedido.escolhas[i.produtoId] === codigoFornecedor && preco !== null && preco !== undefined ? [{ nome: i.nome, quantidade: quantidadeTotal(i), preco }] : [];
  });
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** PDF do Pedido para um fornecedor: produto, quantidade, preço e total. */
export function gerarPdf({ fornecedor, data, itens }: { fornecedor: string; data: string; itens: ItemDoPdf[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    doc.fontSize(16).text(`Pedido de compra - ${fornecedor}`);
    doc.fontSize(10).text(data).moveDown();
    const colunas = [40, 330, 400, 480] as const;
    const linha = (y: number, [nome, qtd, preco, total]: string[]) => {
      doc.text(nome ?? "", colunas[0], y, { width: 280, lineBreak: false });
      doc.text(qtd ?? "", colunas[1], y, { width: 60, align: "right" });
      doc.text(preco ?? "", colunas[2], y, { width: 70, align: "right" });
      doc.text(total ?? "", colunas[3], y, { width: 75, align: "right" });
    };
    doc.font("Helvetica-Bold");
    linha(doc.y, ["Produto", "Qtd.", "Preço", "Total"]);
    doc.font("Helvetica").moveDown(0.5);
    let soma = 0;
    for (const i of itens) {
      if (doc.y > 780) doc.addPage();
      soma += i.quantidade * i.preco;
      linha(doc.y, [i.nome, String(i.quantidade), moeda(i.preco), moeda(i.quantidade * i.preco)]);
      doc.moveDown(0.3);
    }
    doc.moveDown().font("Helvetica-Bold");
    linha(doc.y, ["Total", "", "", moeda(soma)]);
    doc.end();
  });
}
