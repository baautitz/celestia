import ExcelJS from "exceljs";
import { defined } from "./test/defined";
import { describe, expect, it } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { registerCotacaoRoutes } from "./cotacao-routes";
import { MemoryCotacaoStore } from "./cotacao-store";
import { declareCotacaoAudit } from "./cotacao-audit";
import { declarePedidosAudit } from "./pedidos-audit";
import { MemoryPedidoStore } from "./pedidos-store";
import type { Pedido } from "./pedidos";
import type { AuditService } from "./vinculo-audit";

const GERIR = "inovafarma:pedidos-pedidos:gerir";
const dipirona = { produtoId: "p-1", nome: "DIPIRONA", codigoBarra: "789", quantidades: [{ codigoLoja: 1, quantidade: 10 }, { codigoLoja: 2, quantidade: 3 }] };
const aas = { produtoId: "p-2", nome: "AAS", codigoBarra: null, quantidades: [{ codigoLoja: 1, quantidade: 3 }] };
const FORNECEDORES = [{ codigo: 7, nome: "ALFA DISTRIBUIDORA" }, { codigo: 9, nome: "BETA" }, { codigo: 3, nome: "CARLOS ATACADO" }];

async function boot({ erpFalha = false }: { erpFalha?: boolean } = {}) {
  const app = new Hono();
  const pedidos = new MemoryPedidoStore();
  const resumos = new Map<string, (a: never) => string>();
  const log: string[] = [];
  const audit: AuditService = {
    declareAction: (def) => void resumos.set(def.action, def.summary as (a: never) => string),
    record: async (input) => void log.push(resumos.get(input.action)?.(input.attributes as never) ?? "?"),
  };
  declarePedidosAudit(audit);
  declareCotacaoAudit(audit);
  const auth: MiddlewareHandler = async (c, next) => {
    const sub = c.req.header("x-user") ?? "";
    c.set("user" as never, { sub, fullname: sub, permissions: sub === "gil" ? [GERIR] : [] } as never);
    await next();
  };
  registerCotacaoRoutes({
    routes: app,
    permissions: { has: (p, k) => Boolean(p?.includes(k)) },
    auth,
    audit,
    pedidos,
    cotacoes: new MemoryCotacaoStore(),
    erpClient: () => ({
      query: async <T,>(sql: string, params?: Record<string, unknown>) => {
        if (erpFalha) throw new Error("boom");
        if (sql.includes("FROM Fornecedor")) return FORNECEDORES.filter((f) => !params?.busca || f.nome.includes(String(params.busca).toUpperCase())) as T[];
        return [{ produtoId: "p-1", fabricante: "EMS" }] as T[];
      },
    }),
  });
  const req = (who: string, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "x-user": who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const rascunho = await pedidos.criar({ itens: [dipirona, aas] }, { id: "gil", nome: "gil" });
  return { req, app, log, pedido: rascunho, pedidos };
}

const BASE = (id: string) => `/pedidos/pedidos/${id}/cotacao`;
type Boot = Awaited<ReturnType<typeof boot>>;

async function iniciar(b: Boot, fornecedores = [7, 9]) {
  return b.req("gil", "POST", BASE(b.pedido.id), { fornecedores, version: 1 });
}

async function baixarPlanilha(b: Boot, codigo: number): Promise<Buffer> {
  const res = await b.req("gil", "GET", `${BASE(b.pedido.id)}/${codigo}/planilha`);
  expect(res.status).toBe(200);
  const { nome, conteudo } = (await res.json()) as { nome: string; conteudo: string };
  expect(nome).toMatch(/^Cotacao-.+-\d{4}-\d{2}-\d{2}\.xlsx$/);
  return Buffer.from(conteudo, "base64");
}

async function preencher(buffer: Buffer, precos: Record<number, number>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  for (const [linha, valor] of Object.entries(precos)) defined(wb.worksheets[0], "a planilha").getRow(Number(linha) + 5).getCell(7).value = valor;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** O arquivo vai em base64 no JSON: o cliente de API da plataforma só fala JSON. */
const enviar = (b: Boot, caminho: string, arquivo: Buffer, version?: number) => b.req("gil", "POST", `${BASE(b.pedido.id)}${caminho}`, { arquivo: arquivo.toString("base64"), version });

describe("Cotação: fornecedores", () => {
  it("lista os fornecedores ativos do ERP em ordem alfabética, com busca", async () => {
    const { req } = await boot();
    const todos = await (await req("gil", "GET", "/pedidos/fornecedores")).json();
    expect(todos).toEqual([FORNECEDORES[0], FORNECEDORES[1], FORNECEDORES[2]]);
    expect(await (await req("gil", "GET", "/pedidos/fornecedores?busca=beta")).json()).toEqual([FORNECEDORES[1]]);
    expect((await req("ana", "GET", "/pedidos/fornecedores")).status).toBe(403);
  });

  it("recusa a lista com 503 quando o ERP falha", async () => {
    const { req } = await boot({ erpFalha: true });
    expect((await req("gil", "GET", "/pedidos/fornecedores")).status).toBe(503);
  });

  it("inicia a cotação guardando só o código, leva o Pedido a aguardando preços e registra no Audit Log", async () => {
    const b = await boot();
    const res = await iniciar(b);
    expect(res.status).toBe(200);
    const detalhe = (await res.json()) as { pedido: Pedido; fornecedores: { codigo: number; nome: string; importado: boolean }[] };
    expect(detalhe.pedido).toMatchObject({ status: "aguardando_precos", version: 2 });
    expect(detalhe.fornecedores).toMatchObject([{ codigo: 7, nome: "ALFA DISTRIBUIDORA", importado: false }, { codigo: 9, nome: "BETA", importado: false }]);
    expect(b.log).toEqual(["Iniciou a cotação do Pedido com 2 fornecedores."]);
  });

  it("informa no detalhe a escolha gravada e se o usuário pode confirmar", async () => {
    const b = await boot();
    await iniciar(b);
    const detalhe = (await (await b.req("gil", "GET", BASE(b.pedido.id))).json()) as { pedido: Pedido & { escolhas: unknown }; podeConfirmar: boolean };
    expect(detalhe.pedido.escolhas).toEqual({});
    expect(detalhe.podeConfirmar).toBe(false);
  });

  it("recusa iniciar com versão antiga (409), sem fornecedores ou repetidos (400) e sem Permission (403)", async () => {
    const b = await boot();
    expect((await b.req("gil", "POST", BASE(b.pedido.id), { fornecedores: [7], version: 5 })).status).toBe(409);
    expect((await b.req("gil", "POST", BASE(b.pedido.id), { fornecedores: [], version: 1 })).status).toBe(400);
    expect((await b.req("gil", "POST", BASE(b.pedido.id), { fornecedores: [7, 7], version: 1 })).status).toBe(400);
    expect((await b.req("ana", "POST", BASE(b.pedido.id), { fornecedores: [7], version: 1 })).status).toBe(403);
    expect((await b.req("gil", "POST", BASE("ped_nao_existe"), { fornecedores: [7], version: 1 })).status).toBe(404);
    expect((await iniciar(b)).status).toBe(200);
    expect((await iniciar(b)).status).toBe(409);
  });

  it("mostra 'Fornecedor <código>' quando o ERP não responde", async () => {
    const b = await boot({ erpFalha: true });
    await iniciar(b);
    const detalhe = (await (await b.req("gil", "GET", BASE(b.pedido.id))).json()) as { fornecedores: { nome: string }[] };
    expect(detalhe.fornecedores.map((f) => f.nome)).toEqual(["Fornecedor 7", "Fornecedor 9"]);
  });
});

describe("Cotação: planilha e importação", () => {
  it("baixa a planilha com a quantidade total de cada produto, sem dividir por Loja", async () => {
    const b = await boot();
    await iniciar(b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await baixarPlanilha(b, 7)) as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    expect([7, 8].map((n) => ws.getRow(n).getCell(4).value)).toEqual([13, 3]);
    expect(ws.getRow(7).getCell(3).value).toBe("EMS");
  });

  it("devolve a prévia sem gravar nada", async () => {
    const b = await boot();
    await iniciar(b);
    const previa = await enviar(b, "/7/previa", await preencher(await baixarPlanilha(b, 7), { 2: 12.5 }));
    expect(previa.status).toBe(200);
    expect(await previa.json()).toEqual({ validas: 1, semOferta: 1, quantidadesDiferentes: 0, erros: [], semMatch: [] });
    const detalhe = (await (await b.req("gil", "GET", BASE(b.pedido.id))).json()) as { pedido: Pedido; fornecedores: { importado: boolean }[] };
    expect(detalhe.pedido.status).toBe("aguardando_precos");
    expect(detalhe.fornecedores[0]?.importado).toBe(false);
  });

  it("importa, leva o Pedido a cotado e compara os preços por produto (ida e volta)", async () => {
    const b = await boot();
    await iniciar(b);
    const res = await enviar(b, "/7/importar", await preencher(await baixarPlanilha(b, 7), { 2: 12.5, 3: 4 }), 1);
    expect(res.status).toBe(200);
    expect((await enviar(b, "/9/importar", await preencher(await baixarPlanilha(b, 9), { 2: 11 }), 1)).status).toBe(200);
    const detalhe = (await (await b.req("gil", "GET", BASE(b.pedido.id))).json()) as {
      pedido: Pedido;
      fornecedores: { codigo: number; importado: boolean; version: number }[];
      produtos: { produtoId: string; quantidade: number; precos: Record<string, number | null> }[];
    };
    expect(detalhe.pedido.status).toBe("cotado");
    expect(detalhe.fornecedores.map((f) => [f.codigo, f.importado, f.version])).toEqual([[7, true, 2], [9, true, 2]]);
    expect(detalhe.produtos).toMatchObject([
      { produtoId: "p-1", quantidade: 13, precos: { 7: 12.5, 9: 11 } },
      { produtoId: "p-2", quantidade: 3, precos: { 7: 4, 9: null } },
    ]);
    expect(b.log.at(-1)).toBe("Importou a planilha de preços do fornecedor 9: 1 oferta.");
  });

  it("aceita a quantidade corrigida pelo fornecedor e a mostra na comparação junto da pedida", async () => {
    const b = await boot();
    await iniciar(b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await baixarPlanilha(b, 7)) as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    ws.getRow(7).getCell(7).value = 12.5;
    ws.getRow(7).getCell(4).value = 10;
    const arquivo = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await (await enviar(b, "/7/previa", arquivo)).json()).toMatchObject({ validas: 1, quantidadesDiferentes: 1 });
    expect((await enviar(b, "/7/importar", arquivo, 1)).status).toBe(200);
    const detalhe = (await (await b.req("gil", "GET", BASE(b.pedido.id))).json()) as { produtos: { produtoId: string; pedidas: Record<string, number>; ofertadas: Record<string, number | null> }[] };
    expect(detalhe.produtos[0]).toMatchObject({ produtoId: "p-1", pedidas: { 7: 13 }, ofertadas: { 7: 10 } });
  });

  it("identifica de quem é a planilha pelo próprio arquivo", async () => {
    const b = await boot();
    await iniciar(b);
    const res = await enviar(b, "/identificar", await baixarPlanilha(b, 9));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ codigoFornecedor: 9 });
    expect((await enviar(b, "/identificar", Buffer.from("não é excel"))).status).toBe(422);
  });

  it("rejeita a planilha de outro fornecedor ou de outra cotação", async () => {
    const b = await boot();
    await iniciar(b);
    const deOutro = await baixarPlanilha(b, 9);
    const res = await enviar(b, "/7/importar", deOutro, 1);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Esta planilha é de outro fornecedor ou de outra cotação." });
    expect((await enviar(b, "/7/previa", deOutro)).status).toBe(422);
  });

  it("aponta preço inválido na prévia e não importa enquanto houver erro", async () => {
    const b = await boot();
    await iniciar(b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await baixarPlanilha(b, 7)) as never);
    defined(wb.worksheets[0], "a planilha").getRow(7).getCell(7).value = "abc";
    const arquivo = Buffer.from(await wb.xlsx.writeBuffer());
    expect(await (await enviar(b, "/7/previa", arquivo)).json()).toMatchObject({ erros: [{ linha: 7, mensagem: "Preço inválido." }] });
    expect((await enviar(b, "/7/importar", arquivo, 1)).status).toBe(400);
  });

  it("lista como sem match a linha de um produto que não está no Pedido", async () => {
    const b = await boot();
    await iniciar(b);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await baixarPlanilha(b, 7)) as never);
    const ws = defined(wb.worksheets[0], "a planilha");
    ws.getRow(7).getCell(7).value = 5;
    ws.getRow(8).getCell(8).value = String(ws.getRow(8).getCell(8).value).replace("p-2", "p-99");
    ws.getRow(8).getCell(7).value = 9;
    const previa = await (await enviar(b, "/7/previa", Buffer.from(await wb.xlsx.writeBuffer()))).json();
    expect(previa).toMatchObject({ validas: 1, semMatch: [{ linha: 8 }] });
  });

  it("exige a version do fornecedor ao importar (409 se mudou)", async () => {
    const b = await boot();
    await iniciar(b);
    const arquivo = await preencher(await baixarPlanilha(b, 7), { 2: 1 });
    expect((await enviar(b, "/7/importar", arquivo, 1)).status).toBe(200);
    const velho = await enviar(b, "/7/importar", arquivo, 1);
    expect(velho.status).toBe(409);
    expect(await velho.json()).toMatchObject({ code: "versao_desatualizada" });
    expect((await enviar(b, "/7/importar", arquivo)).status).toBe(400);
    expect((await enviar(b, "/8/importar", arquivo, 1)).status).toBe(404);
  });

  it("não importa em Pedido que ainda é rascunho", async () => {
    const b = await boot();
    expect((await enviar(b, "/7/previa", Buffer.from("x"))).status).toBe(409);
  });
});
