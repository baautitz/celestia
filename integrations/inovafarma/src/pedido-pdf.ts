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
const MARGEM = 40;
const LARGURA = 515;
const FIM_DA_PAGINA = 770;
const ALTURA_LINHA = 18;

interface Coluna {
  titulo: string;
  largura: number;
  direita?: boolean;
}

const CODIGO: Coluna = { titulo: "Código de barras", largura: 90 };
const QUANTIDADE: Coluna = { titulo: "Qtd.", largura: 50, direita: true };
const COLUNAS_DE_COMPRA: Coluna[] = [CODIGO, { titulo: "Produto", largura: 240 }, QUANTIDADE, { titulo: "Preço", largura: 60, direita: true }, { titulo: "Total", largura: 75, direita: true }];
const COLUNAS_DE_TRANSFERENCIA: Coluna[] = [CODIGO, { titulo: "Produto", largura: 375 }, QUANTIDADE];

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
      doc.font("Helvetica").fontSize(8).text(`Página ${n + 1} de ${count}`, MARGEM, 810, { width: LARGURA, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

/** Uma linha da grade: os textos e o contorno de cada célula. */
function linhaDaGrade(doc: Documento, y: number, colunas: Coluna[], textos: string[], altura: number) {
  let x = MARGEM;
  colunas.forEach((coluna, n) => {
    doc.rect(x, y, coluna.largura, altura).stroke();
    doc.text(textos[n] ?? "", x + 4, y + 5, { width: coluna.largura - 8, align: coluna.direita ? "right" : "left" });
    x += coluna.largura;
  });
}

/** Título, data e os dados do pedido; devolve o y onde a tabela começa. */
function cabecalho(doc: Documento, titulo: string, data: string, dados: [string, string][]): number {
  doc.font("Helvetica-Bold").fontSize(14).text(titulo, MARGEM, MARGEM, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).text(`Data: ${data}`, MARGEM, MARGEM + 3, { width: LARGURA, align: "right", lineBreak: false });
  doc.moveTo(MARGEM, MARGEM + 22).lineTo(MARGEM + LARGURA, MARGEM + 22).lineWidth(1).stroke();
  let y = MARGEM + 32;
  for (const [rotulo, valor] of dados) {
    doc.font("Helvetica-Bold").text(`${rotulo}:`, MARGEM, y, { lineBreak: false });
    doc.font("Helvetica").text(valor, MARGEM + 100, y, { width: LARGURA - 100 });
    y = doc.y + 3;
  }
  return y + 10;
}

/** Tabela em grade que repete o cabeçalho a cada página; devolve o y depois da última linha. */
function tabela(doc: Documento, inicio: number, colunas: Coluna[], linhas: string[][], novaPagina: () => number): number {
  const titulos = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(9).lineWidth(0.5);
    linhaDaGrade(doc, y, colunas, colunas.map((c) => c.titulo), ALTURA_LINHA);
    return y + ALTURA_LINHA;
  };
  let y = titulos(inicio);
  for (const textos of linhas) {
    // O nome longo quebra linha em vez de ser cortado: o fim costuma trazer a apresentação.
    doc.font("Helvetica").fontSize(9);
    const altura = Math.max(ALTURA_LINHA, ...colunas.map((c, i) => doc.heightOfString(textos[i] ?? "", { width: c.largura - 8 }) + 8));
    if (y + altura > FIM_DA_PAGINA) y = titulos(novaPagina());
    doc.font("Helvetica").fontSize(9);
    linhaDaGrade(doc, y, colunas, textos, altura);
    y += altura;
  }
  return y;
}

/** A linha de total, fechando a grade: o rótulo à esquerda do valor, na última coluna. */
function total(doc: Documento, y: number, colunas: Coluna[], rotulo: string, valor: string) {
  const ultima = colunas.at(-1)?.largura ?? 0;
  doc.font("Helvetica-Bold").fontSize(9).lineWidth(0.5);
  linhaDaGrade(doc, y, [{ titulo: "", largura: LARGURA - ultima, direita: true }, { titulo: "", largura: ultima, direita: true }], [rotulo, valor], ALTURA_LINHA);
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
      total(doc, y, COLUNAS_DE_TRANSFERENCIA, "Total de unidades", numero(destino.itens.reduce((soma, i) => soma + i.quantidade, 0)));
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
      total(doc, y, COLUNAS_DE_COMPRA, secao.loja ? "Total da Loja" : "Total", `R$ ${moeda(valor(secao.itens))}`);
      fim = y + 30;
    });
    // Com uma Loja só, o total dela já é o geral.
    if (lojas && lojas.length > 1) {
      if (fim + 30 > FIM_DA_PAGINA) fim = novaPagina();
      total(doc, fim, COLUNAS_DE_COMPRA, "Total geral", `R$ ${moeda(valor(lojas.flatMap((l) => l.itens)))}`);
    }
  });
}
