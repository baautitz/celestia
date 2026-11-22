import ExcelJS from "exceljs";
import { defined } from "./test/defined";
import { describe, expect, it } from "vitest";
import { gerarPlanilha, lerPlanilha } from "./cotacao-planilha";

const linhas = [
  { produtoId: "p-1", codigoBarra: "789", nome: "DIPIRONA", fabricante: "EMS", fracao: "1", quantidade: 13 },
  { produtoId: "p-2", codigoBarra: null, nome: "AAS", fabricante: null, fracao: null, quantidade: 3 },
];
const alvo = { pedidoId: "ped_1", codigoFornecedor: 7 };

/** Abre a planilha gerada, preenche a coluna Preço e devolve o arquivo de volta. */
async function preencher(buffer: Buffer, precos: Record<number, ExcelJS.CellValue>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = defined(wb.worksheets[0], "a planilha");
  for (const [linha, valor] of Object.entries(precos)) ws.getRow(Number(linha)).getCell(6).value = valor;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("planilha de cotação", () => {
  it("gera uma linha por produto com a quantidade total, Preço vazio e o ID oculto", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarPlanilha({ ...alvo, linhas })) as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    expect(ws.getRow(1).values).toEqual([undefined, "EAN", "Produto", "Fabricante", "Fração", "Quantidade", "Preço", "ID"]);
    expect(ws.getRow(2).getCell(1).value).toBe("789");
    expect(ws.getRow(2).getCell(5).value).toBe(13);
    expect(ws.getRow(2).getCell(6).value).toBeNull();
    expect(ws.getColumn(7).hidden).toBe(true);
  });

  it("lê de volta os preços preenchidos; linha sem preço é sem oferta", async () => {
    const preenchida = await preencher(await gerarPlanilha({ ...alvo, linhas }), { 2: 12.5 });
    const lida = await lerPlanilha(preenchida, alvo);
    expect(lida).toEqual({
      ok: true,
      linhas: [
        { linha: 2, produtoId: "p-1", preco: 12.5, erro: null },
        { linha: 3, produtoId: "p-2", preco: null, erro: null },
      ],
    });
  });

  it("aceita preço em texto com vírgula e aponta preço inválido ou negativo por linha", async () => {
    const preenchida = await preencher(await gerarPlanilha({ ...alvo, linhas }), { 2: "12,50", 3: "abc" });
    const lida = await lerPlanilha(preenchida, alvo);
    expect(lida).toMatchObject({ ok: true });
    if (lida.ok) {
      expect(lida.linhas[0]).toMatchObject({ preco: 12.5, erro: null });
      expect(lida.linhas[1]).toMatchObject({ preco: null, erro: "Preço inválido." });
    }
    const negativa = await lerPlanilha(await preencher(await gerarPlanilha({ ...alvo, linhas }), { 2: -1 }), alvo);
    expect(negativa.ok && negativa.linhas[0]?.erro).toBe("Preço inválido.");
  });

  it("rejeita planilha de outro fornecedor ou de outra cotação", async () => {
    const buffer = await gerarPlanilha({ ...alvo, linhas });
    expect(await lerPlanilha(buffer, { ...alvo, codigoFornecedor: 8 })).toEqual({ ok: false, erro: "Esta planilha é de outro fornecedor ou de outra cotação." });
    expect(await lerPlanilha(buffer, { ...alvo, pedidoId: "ped_2" })).toMatchObject({ ok: false });
  });

  it("rejeita arquivo que não é uma planilha do Celestia", async () => {
    expect(await lerPlanilha(Buffer.from("não é excel"), alvo)).toEqual({ ok: false, erro: "O arquivo não é uma planilha Excel válida." });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["a"]);
    expect(await lerPlanilha(Buffer.from(await wb.xlsx.writeBuffer()), alvo)).toMatchObject({ ok: false });
  });
});
