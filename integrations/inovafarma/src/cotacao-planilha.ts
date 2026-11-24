import ExcelJS from "exceljs";

/** Colunas da planilha de cotação; o ID (oculto) amarra cada linha à cotação, ao fornecedor e ao produto. */
const CABECALHO = ["EAN", "Produto", "Fabricante", "Qtde", "Últ. preço unit.", "Data da última compra", "Preço unitário", "ID"] as const;
const COLUNA_QTDE = 4;
const COLUNA_PRECO = 7;
const COLUNA_ID = 8;
/** Acima do cabeçalho da tabela vão a distribuidora, o Pedido e a instrução; as linhas de produto começam na seguinte. */
const LINHA_CABECALHO = 6;
const PREFIXO_ID = "cot";

export interface LinhaPlanilha {
  produtoId: string;
  codigoBarra: string | null;
  nome: string;
  fabricante: string | null;
  /** O que o Pedido pede a este fornecedor, somadas as Lojas; ele pode corrigir na planilha. */
  quantidade: number;
  /** Último preço pago a este fornecedor no produto e o dia (AAAA-MM-DD): só referência, a coluna de preço cotado vem vazia. */
  precoAnterior?: number | null;
  dataAnterior?: string | null;
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
  /** Qtde que o fornecedor deixou na planilha (pode ser diferente da pedida); null = vazia ou erro. */
  quantidade: number | null;
  erro: string | null;
}

export type PlanilhaLida = { ok: true; linhas: PrecoLido[] } | { ok: false; erro: string };

const idDaLinha = ({ pedidoId, codigoFornecedor }: AlvoPlanilha, produtoId: string) => `${PREFIXO_ID}|${pedidoId}|${codigoFornecedor}|${produtoId}`;

const diaBr = (iso: string) => iso.split("-").reverse().join("/");
const AMARELO = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2B3" } } as const;

export async function gerarPlanilha({ linhas, fornecedor, pedidoEm, ...alvo }: AlvoPlanilha & { linhas: LinhaPlanilha[]; fornecedor: string; pedidoEm: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cotação");
  ws.getCell("A1").value = "Cotação de preços";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `Distribuidora: ${fornecedor} (código ${alvo.codigoFornecedor})`;
  ws.getCell("A3").value = `Pedido de ${diaBr(pedidoEm)}`;
  ws.getCell("A4").value = 'Preencha as colunas amarelas (só números): "Preço unitário" e, se a quantidade que você atende for outra, corrija a "Qtde". Deixe o preço em branco se não tiver o produto. "Últ. preço unit." é só referência.';
  ws.getRow(LINHA_CABECALHO).values = [...CABECALHO];
  ws.getRow(LINHA_CABECALHO).font = { bold: true };
  for (const l of linhas) {
    const row = ws.addRow([l.codigoBarra ?? "", l.nome, l.fabricante ?? "", l.quantidade, l.precoAnterior ?? null, l.dataAnterior ? diaBr(l.dataAnterior) : "", null, idDaLinha(alvo, l.produtoId)]);
    // Só a quantidade e o preço são editáveis, e só aceitam número a partir de zero.
    for (const coluna of [COLUNA_QTDE, COLUNA_PRECO]) {
      const celula = row.getCell(coluna);
      celula.fill = AMARELO;
      celula.protection = { locked: false };
      celula.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", formulae: [0], allowBlank: true, showErrorMessage: true, errorStyle: "stop", errorTitle: "Valor inválido", error: "Digite apenas números, a partir de zero." };
    }
    row.getCell(5).font = { color: { argb: "FF6B7280" } };
    row.getCell(6).font = { color: { argb: "FF6B7280" } };
  }
  ws.getColumn(2).width = 44;
  for (const c of [1, 3, 4, 5, COLUNA_PRECO]) ws.getColumn(c).width = 16;
  ws.getColumn(6).width = 22;
  ws.getColumn(5).numFmt = "#,##0.00";
  ws.getColumn(COLUNA_PRECO).numFmt = "#,##0.00";
  ws.getColumn(COLUNA_ID).hidden = true;
  ws.views = [{ state: "frozen", ySplit: LINHA_CABECALHO }];
  // Planilha travada, sem senha: só as células de preço mudam; o ID oculto e a quantidade ficam protegidos.
  await ws.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const textoDaCelula = (v: ExcelJS.CellValue): string => (v === null || v === undefined ? "" : typeof v === "object" && "text" in v ? String(v.text) : String(v)).trim();

/** Preço digitado: número ou texto no formato brasileiro ("1.234,50"); vazio é sem oferta. */
function lerNumero(v: ExcelJS.CellValue): { valor: number | null; invalido: boolean } {
  const texto = textoDaCelula(v);
  if (texto === "") return { valor: null, invalido: false };
  const valor = typeof v === "number" ? v : Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valor) && valor >= 0 ? { valor, invalido: false } : { valor: null, invalido: true };
}

function lerLinha(row: ExcelJS.Row): { preco: number | null; quantidade: number | null; erro: string | null } {
  const preco = lerNumero(row.getCell(COLUNA_PRECO).value);
  const quantidade = lerNumero(row.getCell(COLUNA_QTDE).value);
  const erro = preco.invalido ? "Preço inválido." : quantidade.invalido ? "Quantidade inválida." : null;
  return { preco: preco.valor, quantidade: quantidade.valor, erro };
}

/** Qual fornecedor é esta planilha: o código vem do ID de cada linha, então um envio só serve a todos. */
export async function identificarPlanilha(arquivo: Buffer, pedidoId: string): Promise<{ ok: true; codigoFornecedor: number } | { ok: false; erro: string }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(arquivo as never);
  } catch {
    return { ok: false, erro: "O arquivo não é uma planilha Excel válida." };
  }
  const ws = wb.worksheets[0];
  if (!ws || textoDaCelula(ws.getRow(LINHA_CABECALHO).getCell(COLUNA_ID).value) !== CABECALHO[COLUNA_ID - 1]) return { ok: false, erro: "O arquivo não é uma planilha de cotação do Celestia." };
  for (let n = LINHA_CABECALHO + 1; n <= ws.rowCount; n++) {
    const [prefixo, pedido, codigo] = textoDaCelula(ws.getRow(n).getCell(COLUNA_ID).value).split("|");
    if (prefixo !== PREFIXO_ID || !codigo) continue;
    if (pedido !== pedidoId) return { ok: false, erro: "Esta planilha é de outro Pedido." };
    const codigoFornecedor = Number(codigo);
    if (Number.isInteger(codigoFornecedor)) return { ok: true, codigoFornecedor };
  }
  return { ok: false, erro: "A planilha não tem nenhum produto." };
}

export async function lerPlanilha(arquivo: Buffer, alvo: AlvoPlanilha): Promise<PlanilhaLida> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(arquivo as never);
  } catch {
    return { ok: false, erro: "O arquivo não é uma planilha Excel válida." };
  }
  const ws = wb.worksheets[0];
  if (!ws || textoDaCelula(ws.getRow(LINHA_CABECALHO).getCell(COLUNA_ID).value) !== CABECALHO[COLUNA_ID - 1]) return { ok: false, erro: "O arquivo não é uma planilha de cotação do Celestia." };
  const prefixo = `${PREFIXO_ID}|${alvo.pedidoId}|${alvo.codigoFornecedor}|`;
  const linhas: PrecoLido[] = [];
  for (let n = LINHA_CABECALHO + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const id = textoDaCelula(row.getCell(COLUNA_ID).value);
    if (id === "") continue;
    if (!id.startsWith(prefixo)) return { ok: false, erro: "Esta planilha é de outro fornecedor ou de outra cotação." };
    linhas.push({ linha: n, produtoId: id.slice(prefixo.length), ...lerLinha(row) });
  }
  return { ok: true, linhas };
}
