import PDFDocument from "pdfkit";
import { fornecedoresDa, pedidaAoFornecedor, semLinhasDeLoja, type Pedido } from "./pedidos.js";

export interface ItemDeTransferencia {
  nome: string;
  codigoBarra: string | null;
  quantidade: number;
}

export interface ItemDoPdf extends ItemDeTransferencia {
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
    return fornecedoresDa(escolha).includes(codigoFornecedor) && preco !== null && preco !== undefined && quantidade > 0 ? [{ nome: i.nome, codigoBarra: i.codigoBarra, quantidade, preco }] : [];
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
    return Array.isArray(escolha) ? escolha.filter((p) => p.codigoFornecedor === codigoFornecedor).map((p) => ({ codigoLoja: p.codigoLoja, produtoId: i.produtoId, nome: i.nome, codigoBarra: i.codigoBarra, quantidade: p.quantidade })) : [];
  });
  const inteiras = linhasPorLoja(pedido, codigoFornecedor).filter((l) => pedido.escolhas[l.produtoId] === codigoFornecedor);
  for (const l of [...inteiras, ...divididas]) {
    const preco = precos[l.produtoId];
    if (preco === null || preco === undefined) continue;
    porLoja.set(l.codigoLoja, [...(porLoja.get(l.codigoLoja) ?? []), { nome: l.nome, codigoBarra: l.codigoBarra, quantidade: l.quantidade, preco }]);
  }
  return [...porLoja.entries()].sort(([a], [b]) => a - b).map(([codigo, itens]) => ({ loja: nomeLoja(codigo), itens }));
}

/** O que se pede à Loja `lojaFornecedora`, por Loja de destino. Sem preço: é transferência, não compra. */
export function itensDaLojaFornecedora(pedido: Pick<Pedido, "itens">, lojaFornecedora: number, nomeLoja: (codigo: number) => string): { loja: string; itens: ItemDeTransferencia[] }[] {
  const porDestino = new Map<number, ItemDeTransferencia[]>();
  for (const i of pedido.itens) {
    for (const q of i.quantidades) {
      const parte = q.lojasFornecedoras?.find((l) => l.codigoLoja === lojaFornecedora);
      if (parte) porDestino.set(q.codigoLoja, [...(porDestino.get(q.codigoLoja) ?? []), { nome: i.nome, codigoBarra: i.codigoBarra, quantidade: parte.quantidade }]);
    }
  }
  return [...porDestino.entries()].sort(([a], [b]) => a - b).map(([codigo, itens]) => ({ loja: nomeLoja(codigo), itens }));
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const resumo = (itens: ItemDeTransferencia[]) => {
  const produtos = new Set(itens.map((i) => `${i.codigoBarra}|${i.nome}`)).size;
  return `${produtos} ${produtos === 1 ? "produto" : "produtos"} · ${numero(itens.reduce((soma, i) => soma + i.quantidade, 0))} un.`;
};

const MARGEM = 40;
const LARGURA = 515;
const FIM_DA_PAGINA = 770;
const ALTURA_LINHA = 18;
const COR = { destaque: "#1f2937", suave: "#6b7280", zebra: "#f3f4f6", borda: "#d1d5db" };

interface Coluna {
  titulo: string;
  largura: number;
  direita?: boolean;
}

const CODIGO: Coluna = { titulo: "Código de barras", largura: 95 };
const QUANTIDADE: Coluna = { titulo: "Qtd.", largura: 50, direita: true };
const COLUNAS_DE_COMPRA: Coluna[] = [CODIGO, { titulo: "Produto", largura: 235 }, QUANTIDADE, { titulo: "Preço", largura: 60, direita: true }, { titulo: "Total", largura: 75, direita: true }];
const COLUNAS_DE_TRANSFERENCIA: Coluna[] = [CODIGO, { titulo: "Produto", largura: 370 }, QUANTIDADE];

type Documento = InstanceType<typeof PDFDocument>;

/** Monta o PDF em A4 e numera as páginas no fim, quando o total já é conhecido. */
function emitir(montar: (doc: Documento) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGEM, bufferPages: true });
    const partes: Buffer[] = [];
    doc.on("data", (p: Buffer) => partes.push(p));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    montar(doc);
    const { start, count } = doc.bufferedPageRange();
    for (let n = 0; n < count; n++) {
      doc.switchToPage(start + n);
      // Sem margem inferior, para o rodapé não abrir uma página nova.
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor(COR.suave).text(`Página ${n + 1} de ${count}`, MARGEM, 810, { width: LARGURA, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

function celulas(doc: Documento, y: number, colunas: Coluna[], textos: string[]) {
  let x = MARGEM;
  colunas.forEach((coluna, n) => {
    doc.text(textos[n] ?? "", x + 4, y + 5, { width: coluna.largura - 8, align: coluna.direita ? "right" : "left" });
    x += coluna.largura;
  });
}

/** Faixa do título e os dados do pedido; devolve o y onde a tabela começa. */
function cabecalho(doc: Documento, titulo: string, data: string, dados: [string, string][]): number {
  doc.rect(MARGEM, MARGEM, LARGURA, 36).fill(COR.destaque);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(titulo.toUpperCase(), MARGEM + 12, MARGEM + 12, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).text(data, MARGEM, MARGEM + 14, { width: LARGURA - 12, align: "right", lineBreak: false });
  const largura = LARGURA / dados.length;
  dados.forEach(([rotulo, valor], n) => {
    const x = MARGEM + n * largura;
    doc.font("Helvetica").fontSize(8).fillColor(COR.suave).text(rotulo.toUpperCase(), x, MARGEM + 48, { lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COR.destaque).text(valor, x, MARGEM + 60, { width: largura - 10, height: 13, ellipsis: true });
  });
  return MARGEM + 88;
}

/** Tabela zebrada que repete o cabeçalho a cada página; devolve o y depois da última linha. */
function tabela(doc: Documento, inicio: number, colunas: Coluna[], linhas: string[][], novaPagina: () => number): number {
  const titulos = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COR.destaque);
    celulas(doc, y, colunas, colunas.map((c) => c.titulo));
    doc.moveTo(MARGEM, y + ALTURA_LINHA).lineTo(MARGEM + LARGURA, y + ALTURA_LINHA).lineWidth(1).stroke(COR.destaque);
    return y + ALTURA_LINHA;
  };
  let y = titulos(inicio);
  linhas.forEach((textos, n) => {
    // O nome longo quebra linha em vez de ser cortado: o fim costuma trazer a apresentação.
    doc.font("Helvetica").fontSize(9);
    const altura = Math.max(ALTURA_LINHA, ...colunas.map((c, i) => doc.heightOfString(textos[i] ?? "", { width: c.largura - 8 }) + 8));
    if (y + altura > FIM_DA_PAGINA) y = titulos(novaPagina());
    if (n % 2 === 1) doc.rect(MARGEM, y, LARGURA, altura).fill(COR.zebra);
    doc.font("Helvetica").fontSize(9).fillColor(COR.destaque);
    celulas(doc, y, colunas, textos);
    y += altura;
  });
  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA, y).lineWidth(0.5).stroke(COR.borda);
  return y;
}

function totais(doc: Documento, y: number, esquerda: string, direita: string) {
  doc.rect(MARGEM, y + 6, LARGURA, 24).fill(COR.zebra);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COR.destaque).text(esquerda, MARGEM + 8, y + 14, { lineBreak: false });
  doc.text(direita, MARGEM, y + 14, { width: LARGURA - 8, align: "right", lineBreak: false });
}

/** PDF do pedido a uma Loja: uma página por Loja de destino, só produto e quantidade. */
export function gerarPdfDeLoja({ fornecedora, data, destinos }: { fornecedora: string; data: string; destinos: { loja: string; itens: ItemDeTransferencia[] }[] }): Promise<Buffer> {
  return emitir((doc) => {
    destinos.forEach((destino, n) => {
      if (n > 0) doc.addPage();
      const topo = () => cabecalho(doc, "Pedido de transferência", data, [["Loja fornecedora", fornecedora], ["Loja de destino", destino.loja]]);
      const novaPagina = () => {
        doc.addPage();
        return topo();
      };
      let y = tabela(doc, topo(), COLUNAS_DE_TRANSFERENCIA, destino.itens.map((i) => [i.codigoBarra ?? "-", i.nome, numero(i.quantidade)]), novaPagina);
      if (y + 30 > FIM_DA_PAGINA) y = novaPagina();
      totais(doc, y, resumo(destino.itens), "");
    });
  });
}

/** PDF do Pedido para um fornecedor: produto, quantidade, preço e total; com `lojas`, uma seção (página) por Loja e o total geral no fim. */
export function gerarPdf({ fornecedor, data, itens, lojas }: { fornecedor: string; data: string; itens: ItemDoPdf[]; lojas?: { loja: string; itens: ItemDoPdf[] }[] }): Promise<Buffer> {
  const valor = (lista: ItemDoPdf[]) => lista.reduce((soma, i) => soma + i.quantidade * i.preco, 0);
  return emitir((doc) => {
    const secoes: { loja?: string; itens: ItemDoPdf[] }[] = lojas ?? [{ itens }];
    let fim = 0;
    let topo = () => 0;
    const novaPagina = () => {
      doc.addPage();
      return topo();
    };
    secoes.forEach((secao, n) => {
      if (n > 0) doc.addPage();
      topo = () => cabecalho(doc, "Pedido de compra", data, secao.loja ? [["Fornecedor", fornecedor], ["Loja", secao.loja]] : [["Fornecedor", fornecedor]]);
      let y = tabela(doc, topo(), COLUNAS_DE_COMPRA, secao.itens.map((i) => [i.codigoBarra ?? "-", i.nome, numero(i.quantidade), moeda(i.preco), moeda(i.quantidade * i.preco)]), novaPagina);
      if (y + 30 > FIM_DA_PAGINA) y = novaPagina();
      totais(doc, y, resumo(secao.itens), `${secao.loja ? "Total da Loja" : "Total"}  R$ ${moeda(valor(secao.itens))}`);
      fim = y + 30;
    });
    if (lojas) {
      if (fim + 30 > FIM_DA_PAGINA) fim = novaPagina();
      const todos = lojas.flatMap((l) => l.itens);
      totais(doc, fim, `${lojas.length} ${lojas.length === 1 ? "Loja" : "Lojas"} · ${resumo(todos)}`, `Total geral  R$ ${moeda(valor(todos))}`);
    }
  });
}
