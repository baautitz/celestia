import ExcelJS from "exceljs";

/** Colunas da planilha de cotação; o ID (oculto) amarra cada linha à cotação, ao fornecedor e ao produto. */
const CABECALHO = ["EAN", "Produto", "Fabricante", "Fração", "Quantidade", "Preço", "ID"] as const;
const COLUNA_PRECO = 6;
const COLUNA_ID = 7;
const PREFIXO_ID = "cot";

export interface LinhaPlanilha {
  produtoId: string;
  codigoBarra: string | null;
  nome: string;
  fabricante: string | null;
  fracao: string | null;
  /** Total do produto no Pedido, somadas as Lojas. */
  quantidade: number;
}

export interface AlvoPlanilha {
  pedidoId: string;
  codigoFornecedor: number;
}

export interface PrecoLido {
  /** Número da linha na planilha, para apontar o erro ao usuário. */
  linha: number;
  produtoId: string;
  /** null = sem oferta (célula vazia) ou erro. */
  preco: number | null;
  erro: string | null;
}

export type PlanilhaLida = { ok: true; linhas: PrecoLido[] } | { ok: false; erro: string };

const idDaLinha = ({ pedidoId, codigoFornecedor }: AlvoPlanilha, produtoId: string) => `${PREFIXO_ID}|${pedidoId}|${codigoFornecedor}|${produtoId}`;

export async function gerarPlanilha({ linhas, ...alvo }: AlvoPlanilha & { linhas: LinhaPlanilha[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cotação");
  ws.addRow([...CABECALHO]);
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) ws.addRow([l.codigoBarra ?? "", l.nome, l.fabricante ?? "", l.fracao ?? "", l.quantidade, null, idDaLinha(alvo, l.produtoId)]);
  ws.getColumn(2).width = 40;
  for (const c of [1, 3, 4, 5, COLUNA_PRECO]) ws.getColumn(c).width = 16;
  ws.getColumn(COLUNA_PRECO).numFmt = "#,##0.00";
  ws.getColumn(COLUNA_ID).hidden = true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const textoDaCelula = (v: ExcelJS.CellValue): string => (v === null || v === undefined ? "" : typeof v === "object" && "text" in v ? String(v.text) : String(v)).trim();

/** Preço digitado: número ou texto no formato brasileiro ("1.234,50"); vazio é sem oferta. */
function lerPreco(v: ExcelJS.CellValue): { preco: number | null; erro: string | null } {
  const texto = textoDaCelula(v);
  if (texto === "") return { preco: null, erro: null };
  const preco = typeof v === "number" ? v : Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(preco) && preco >= 0 ? { preco, erro: null } : { preco: null, erro: "Preço inválido." };
}

export async function lerPlanilha(arquivo: Buffer, alvo: AlvoPlanilha): Promise<PlanilhaLida> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(arquivo as never);
  } catch {
    return { ok: false, erro: "O arquivo não é uma planilha Excel válida." };
  }
  const ws = wb.worksheets[0];
  if (!ws || textoDaCelula(ws.getRow(1).getCell(COLUNA_ID).value) !== CABECALHO[COLUNA_ID - 1]) return { ok: false, erro: "O arquivo não é uma planilha de cotação do Celestia." };
  const prefixo = `${PREFIXO_ID}|${alvo.pedidoId}|${alvo.codigoFornecedor}|`;
  const linhas: PrecoLido[] = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const id = textoDaCelula(row.getCell(COLUNA_ID).value);
    if (id === "") continue;
    if (!id.startsWith(prefixo)) return { ok: false, erro: "Esta planilha é de outro fornecedor ou de outra cotação." };
    linhas.push({ linha: n, produtoId: id.slice(prefixo.length), ...lerPreco(row.getCell(COLUNA_PRECO).value) });
  }
  return { ok: true, linhas };
}
