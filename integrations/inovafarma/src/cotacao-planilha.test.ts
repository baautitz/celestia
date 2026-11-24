import ExcelJS from "exceljs";
import { defined } from "./test/defined";
import { describe, expect, it } from "vitest";
import { gerarPlanilha, lerPlanilha } from "./cotacao-planilha";

const linhas = [
  { produtoId: "p-1", codigoBarra: "789", nome: "DIPIRONA", fabricante: "EMS", quantidade: 13 },
  { produtoId: "p-2", codigoBarra: null, nome: "AAS", fabricante: null, quantidade: 3 },
];
const alvo = { pedidoId: "ped_1", codigoFornecedor: 7 };
const contexto = { fornecedor: "ALFA", pedidoEm: "2026-11-23" };

/** Abre a planilha gerada, preenche a coluna Preço e devolve o arquivo de volta. */
async function preencher(buffer: Buffer, precos: Record<number, ExcelJS.CellValue>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = defined(wb.worksheets[0], "a planilha");
  for (const [linha, valor] of Object.entries(precos)) ws.getRow(Number(linha) + 5).getCell(7).value = valor;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("planilha de cotação", () => {
  it("traz distribuidora, Pedido e instrução no topo, o último preço só como referência e o preço cotado vazio", async () => {
    const wb = new ExcelJS.Workbook();
    const comAnterior = [{ ...linhas[0], precoAnterior: 12.82, dataAnterior: "2025-06-27" }, ...linhas.slice(1)];
    await wb.xlsx.load((await gerarPlanilha({ ...alvo, ...contexto, linhas: comAnterior })) as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    expect(ws.getCell("A2").value).toBe("Distribuidora: ALFA (código 7)");
    expect(ws.getCell("A3").value).toBe("Pedido de 23/11/2026");
    expect(ws.getRow(6).values).toEqual([undefined, "EAN", "Produto", "Fabricante", "Qtde", "Últ. preço unit.", "Data da última compra", "Preço unitário", "ID"]);
    expect(ws.getRow(7).getCell(1).value).toBe("789");
    expect(ws.getRow(7).getCell(4).value).toBe(13);
    expect(ws.getRow(7).getCell(5).value).toBe(12.82);
    expect(ws.getRow(7).getCell(6).value).toBe("27/06/2025");
    expect(ws.getRow(7).getCell(7).value).toBeNull();
    expect(ws.getColumn(8).hidden).toBe(true);
    // Travada: só o preço é editável, e só número.
    expect(ws.getRow(7).getCell(7).protection).toMatchObject({ locked: false });
    expect(ws.getRow(7).getCell(4).protection).toMatchObject({ locked: false });
    expect(ws.getRow(7).getCell(7).dataValidation).toMatchObject({ type: "decimal" });
    expect(ws.getRow(7).getCell(1).protection?.locked).not.toBe(false);
  });

  it("lê de volta os preços preenchidos; linha sem preço é sem oferta", async () => {
    const preenchida = await preencher(await gerarPlanilha({ ...alvo, ...contexto, linhas }), { 2: 12.5 });
    const lida = await lerPlanilha(preenchida, alvo);
    expect(lida).toEqual({
      ok: true,
      linhas: [
        { linha: 7, produtoId: "p-1", preco: 12.5, quantidade: 13, erro: null },
        { linha: 8, produtoId: "p-2", preco: null, quantidade: 3, erro: null },
      ],
    });
  });

  it("aceita preço em texto com vírgula e aponta preço inválido ou negativo por linha", async () => {
    const preenchida = await preencher(await gerarPlanilha({ ...alvo, ...contexto, linhas }), { 2: "12,50", 3: "abc" });
    const lida = await lerPlanilha(preenchida, alvo);
    expect(lida).toMatchObject({ ok: true });
    if (lida.ok) {
      expect(lida.linhas[0]).toMatchObject({ preco: 12.5, erro: null });
      expect(lida.linhas[1]).toMatchObject({ preco: null, erro: "Preço inválido." });
    }
    const negativa = await lerPlanilha(await preencher(await gerarPlanilha({ ...alvo, ...contexto, linhas }), { 2: -1 }), alvo);
    expect(negativa.ok && negativa.linhas[0]?.erro).toBe("Preço inválido.");
  });

  it("lê a quantidade corrigida pelo fornecedor e recusa quantidade inválida", async () => {
    const buffer = await gerarPlanilha({ ...alvo, ...contexto, linhas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    ws.getRow(7).getCell(4).value = 10;
    ws.getRow(8).getCell(4).value = "x";
    const lida = await lerPlanilha(Buffer.from(await wb.xlsx.writeBuffer()), alvo);
    expect(lida.ok && lida.linhas.map((l) => [l.quantidade, l.erro])).toEqual([[10, null], [null, "Quantidade inválida."]]);
  });

  it("rejeita planilha de outro fornecedor ou de outra cotação", async () => {
    const buffer = await gerarPlanilha({ ...alvo, ...contexto, linhas });
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
