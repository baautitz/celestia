import PDFDocument from "pdfkit";
import { fornecedoresDa, pedidaAoFornecedor, semLinhasDeLoja, type Pedido } from "./pedidos.js";

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
  return porLinha ? item.quantidades.filter((q) => (q.codigosFornecedor ?? []).includes(codigoFornecedor)).reduce((soma, q) => soma + pedidaAoFornecedor(q, codigoFornecedor), 0) : quantidadeTotal(item);
}

/** Só os produtos escolhidos neste fornecedor e com preço dele, na quantidade que ele confirmou (ou, sem isso, na pedida a ele). */
export function itensDoFornecedor(pedido: Pick<Pedido, "itens" | "escolhas">, codigoFornecedor: number, precos: Record<string, number | null>, quantidades: Record<string, number> | null = null): ItemDoPdf[] {
  return semLinhasDeLoja(pedido).itens.flatMap((i) => {
    const preco = precos[i.produtoId];
    const escolha = pedido.escolhas[i.produtoId];
    const quantidade = Array.isArray(escolha) ? escolha.filter((p) => p.codigoFornecedor === codigoFornecedor).reduce((soma, p) => soma + p.quantidade, 0) : (quantidades?.[i.produtoId] ?? quantidadePedida(pedido, i, codigoFornecedor));
    return fornecedoresDa(escolha).includes(codigoFornecedor) && preco !== null && preco !== undefined && quantidade > 0 ? [{ nome: i.nome, quantidade, preco }] : [];
  });
}

/** As Lojas que o Pedido pede a este fornecedor, com os produtos e a quantidade de cada uma (só o que tem quantidade). */
export function linhasPorLoja(completo: Pick<Pedido, "itens">, codigoFornecedor: number): { codigoLoja: number; produtoId: string; nome: string; codigoBarra: string | null; quantidade: number }[] {
  const pedido = semLinhasDeLoja(completo);
  const porLinha = pedido.itens.some((i) => i.quantidades.some((q) => (q.codigosFornecedor ?? []).length > 0));
  return pedido.itens.flatMap((i) =>
    i.quantidades
      .filter((q) => !porLinha || (q.codigosFornecedor ?? []).includes(codigoFornecedor))
      .map((q) => ({ codigoLoja: q.codigoLoja, produtoId: i.produtoId, nome: i.nome, codigoBarra: i.codigoBarra, quantidade: porLinha ? pedidaAoFornecedor(q, codigoFornecedor) : q.quantidade }))
      .filter((l) => l.quantidade > 0),
  );
}

/** O PDF por Loja: só os produtos escolhidos neste fornecedor e com preço dele, na quantidade que cada Loja pediu. */
export function itensDoFornecedorPorLoja(pedido: Pick<Pedido, "itens" | "escolhas">, codigoFornecedor: number, precos: Record<string, number | null>, nomeLoja: (codigo: number) => string): { loja: string; itens: ItemDoPdf[] }[] {
  const porLoja = new Map<number, ItemDoPdf[]>();
  // Produto dividido: a escolha já diz quanto vai para cada Loja; inteiro: o que cada Loja pediu a este fornecedor.
  const divididas = pedido.itens.flatMap((i) => {
    const escolha = pedido.escolhas[i.produtoId];
    return Array.isArray(escolha) ? escolha.filter((p) => p.codigoFornecedor === codigoFornecedor).map((p) => ({ codigoLoja: p.codigoLoja, produtoId: i.produtoId, nome: i.nome, quantidade: p.quantidade })) : [];
  });
  const inteiras = linhasPorLoja(pedido, codigoFornecedor).filter((l) => pedido.escolhas[l.produtoId] === codigoFornecedor);
  for (const l of [...inteiras, ...divididas]) {
    const preco = precos[l.produtoId];
    if (preco === null || preco === undefined) continue;
    porLoja.set(l.codigoLoja, [...(porLoja.get(l.codigoLoja) ?? []), { nome: l.nome, quantidade: l.quantidade, preco }]);
  }
  return [...porLoja.entries()].sort(([a], [b]) => a - b).map(([codigo, itens]) => ({ loja: nomeLoja(codigo), itens }));
}

/** O que se pede à Loja `lojaFornecedora`, por Loja de destino. Sem preço: é transferência, não compra. */
export function itensDaLojaFornecedora(pedido: Pick<Pedido, "itens">, lojaFornecedora: number, nomeLoja: (codigo: number) => string): { loja: string; itens: { nome: string; quantidade: number }[] }[] {
  const porDestino = new Map<number, { nome: string; quantidade: number }[]>();
  for (const i of pedido.itens) {
    for (const q of i.quantidades) {
      const parte = q.lojasFornecedoras?.find((l) => l.codigoLoja === lojaFornecedora);
      if (parte) porDestino.set(q.codigoLoja, [...(porDestino.get(q.codigoLoja) ?? []), { nome: i.nome, quantidade: parte.quantidade }]);
    }
  }
  return [...porDestino.entries()].sort(([a], [b]) => a - b).map(([codigo, itens]) => ({ loja: nomeLoja(codigo), itens }));
}

/** PDF do pedido a uma Loja: uma página por Loja de destino, só produto e quantidade. */
export function gerarPdfDeLoja({ fornecedora, data, destinos }: { fornecedora: string; data: string; destinos: { loja: string; itens: { nome: string; quantidade: number }[] }[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    const linha = (y: number, nome: string, quantidade: string) => {
      doc.text(nome, 40, y, { width: 420, lineBreak: false });
      doc.text(quantidade, 480, y, { width: 75, align: "right" });
    };
    destinos.forEach((destino, n) => {
      if (n > 0) doc.addPage();
      doc.font("Helvetica").fontSize(16).text(`Pedido de transferência - ${fornecedora}`, 40);
      doc.fontSize(12).text(`Para: ${destino.loja}`);
      doc.fontSize(10).text(data).moveDown();
      doc.font("Helvetica-Bold");
      linha(doc.y, "Produto", "Qtd.");
      doc.font("Helvetica").moveDown(0.5);
      for (const i of destino.itens) {
        if (doc.y > 780) doc.addPage();
        linha(doc.y, i.nome, String(i.quantidade));
        doc.moveDown(0.3);
      }
    });
    doc.end();
  });
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
