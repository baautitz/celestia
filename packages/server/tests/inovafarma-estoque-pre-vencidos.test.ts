import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const ESTOQUE = "inovafarma:pre-vencidos-estoque:manage";
const BAIXAS = "inovafarma:pre-vencidos-baixas:manage";
const BAIXAS_GERAL = "inovafarma:pre-vencidos-baixas-geral:view";
const BAIXAS_LOJA = "inovafarma:pre-vencidos-baixas-loja:view";
const BAIXAS_INDIVIDUAL = "inovafarma:pre-vencidos-baixas-individual:view";
const CODIGO_PRODUTO_SECRETO = 987654;
const PRODUTO = { produtoId: "6f1c0a52-0000-4000-8000-000000000001", nome: "DIPIRONA 500MG", codigoBarra: "7891234567895" };

const LOJAS = [
  { codigoEmpresa: 1, nome: "Centro" },
  { codigoEmpresa: 2, nome: "Bairro" },
];
const COLABORADORES = [
  { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
  { codigoColaborador: 8, nome: "GIL COSTA", ativo: true },
  { codigoColaborador: 9, nome: "LIA MELO", ativo: true },
  { codigoColaborador: 10, nome: "RUI LIMA", ativo: true },
];

/** Linhas de venda do ERP, com a Loja e o código do produto que o ERP filtra. */
type VendaFake = { codigoLoja: number; vendaId: number; data: string; cancelada: boolean; codigoColaborador: number; nomeColaborador: string; codigoProduto: number; produtoId: string; quantidade: number };
let vendas: VendaFake[] = [];
let erpFora = false;

const DIA = 24 * 60 * 60 * 1000;
/** Dia (UTC) a `dias` de hoje, `AAAA-MM-DD`: com dias inteiros de folga, o fuso do ERP não muda o lado da inclusão. */
const dia = (dias: number) => new Date(Date.now() + dias * DIA).toISOString().slice(0, 10);
const venda = (vendaId: number, dias: number, quantidade: number, extra: Partial<VendaFake> = {}): VendaFake => ({
  codigoLoja: 1,
  vendaId,
  data: `${dia(dias)} 12:00:00`,
  cancelada: false,
  codigoColaborador: 7,
  nomeColaborador: "ANA SOUZA",
  codigoProduto: CODIGO_PRODUTO_SECRETO,
  produtoId: PRODUTO.produtoId,
  quantidade,
  ...extra,
});

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) => {
    if (sql.includes("Venda_Produto")) {
      if (erpFora) throw new Error("ERP fora do ar");
      const produtos = Object.entries(params ?? {}).filter(([k]) => /^p\d+$/.test(k)).map(([, v]) => v);
      return vendas
        .filter((v) => v.codigoLoja === params?.codigoLoja && v.data >= String(params?.dataInicio) && produtos.includes(v.codigoProduto))
        .map(({ codigoLoja: _l, codigoProduto: _c, ...linha }) => linha) as TRow[];
    }
    if (sql.includes("Config")) return LOJAS as TRow[];
    if (params?.produtoId !== undefined) {
      return (params.produtoId === PRODUTO.produtoId
        ? [{ codigoProduto: CODIGO_PRODUTO_SECRETO, produtoId: PRODUTO.produtoId, nome: PRODUTO.nome, codigoBarra: PRODUTO.codigoBarra }]
        : []) as TRow[];
    }
    if (params?.busca !== undefined) return [{ ...PRODUTO }] as TRow[];
    return (params?.codigo === undefined ? COLABORADORES : COLABORADORES.filter((c) => c.codigoColaborador === params.codigo)) as TRow[];
  },
};

const passwordHash = PasswordService.hash("Senha@123");
const usuario = (id: string, roleId: string): User => ({ id, username: id, fullname: id, passwordHash, roleId, status: "active", createdAt: new Date().toISOString() });

async function boot() {
  const userStore = new TestUserStore({
    roles: [
      { id: "adm", name: "Adm", permissions: ["inovafarma:colaboradores:update", "inovafarma:colaboradores:view", "closing_period:period:create", "closing_period:period:close", "closing_period:period:reopen", "closing_period:period:read"] },
      { id: "est", name: "Estoque", permissions: [ESTOQUE] },
      { id: "ger", name: "Gestor", permissions: [BAIXAS, BAIXAS_LOJA] },
      { id: "geral", name: "Diretoria", permissions: [BAIXAS_GERAL] },
      { id: "corrige", name: "Só corrige", permissions: [BAIXAS] },
      { id: "ambos", name: "Gestor do Estoque", permissions: [ESTOQUE, BAIXAS, BAIXAS_INDIVIDUAL] },
      { id: "outro", name: "Outro", permissions: ["inovafarma:colaboradores:view"] },
      { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] },
    ],
    users: [usuario("adm", "adm"), usuario("ana", "est"), usuario("caio", "est"), usuario("zeca", "outro"), usuario("auditor", "audit"), usuario("gil", "ger"), usuario("lia", "ger"), usuario("rui", "ambos"), usuario("dir", "geral"), usuario("teo", "corrige")],
  });
  vendas = [];
  erpFora = false;
  const platform = createPlatform({ userStore, erpClients: { inovafarma: erp } });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Senha@123" }) });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  };
  const h = { adm: await login("adm"), ana: await login("ana"), caio: await login("caio"), zeca: await login("zeca"), auditor: await login("auditor"), gil: await login("gil"), lia: await login("lia"), rui: await login("rui"), dir: await login("dir"), teo: await login("teo") };
  const req = (who: keyof typeof h, method: string, path: string, body?: unknown) =>
    platform.app.request(path, { method, headers: h[who], body: body === undefined ? undefined : JSON.stringify(body) });
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/7/vinculo", { usuarioId: "ana", lojas: [1], version: 0 })).status).toBe(200);
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/8/vinculo", { usuarioId: "gil", lojas: [1], version: 0 })).status).toBe(200);
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/9/vinculo", { usuarioId: "lia", lojas: [2], version: 0 })).status).toBe(200);
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/10/vinculo", { usuarioId: "rui", lojas: [1], version: 0 })).status).toBe(200);
  const periodo = await req("adm", "POST", "/api/closing-periods", { name: "Atual", startDate: dia(-5), endDate: dia(10) });
  expect(periodo.status).toBe(201);
  const { id: periodoId } = (await periodo.json()) as { id: string };
  const incluir = (who: keyof typeof h, body: Record<string, unknown> = {}) =>
    req(who, "POST", "/api/m/inovafarma/pre-vencidos/estoque/itens", { codigoLoja: 1, produtoId: PRODUTO.produtoId, quantidade: 3, validade: "2027-06", ...body });
  const listar = async (who: keyof typeof h, codigoLoja = 1) => (await (await req(who, "GET", `/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=${codigoLoja}`)).json()) as Item[];
  return { req, incluir, listar, periodoId };
}

type Item = { id: string; version: number; nomeProduto: string; quantidade: number; restante: number; validade: string; incluidoEm: string; [k: string]: unknown };

describe("Estoque de Pré-vencidos", () => {
  it("inclui Itens e lista os da Loja com produto, validade, quantidade e data de inclusão", async () => {
    const { incluir, listar } = await boot();
    const antes = Date.now();
    const res = await incluir("ana");
    expect(res.status).toBe(201);
    const [item] = await listar("ana");
    expect(item).toMatchObject({ nomeProduto: PRODUTO.nome, codigoBarra: PRODUTO.codigoBarra, codigoLoja: 1, quantidade: 3, restante: 3, validade: "2027-06", version: 1 });
    expect(Date.parse(item!.incluidoEm)).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("inclui o mesmo produto e validade de novo como outro Item", async () => {
    const { incluir, listar } = await boot();
    await incluir("ana");
    await incluir("ana", { quantidade: 2 });
    expect((await listar("ana")).map((i) => i.quantidade).sort()).toEqual([2, 3]);
  });

  it("o código do produto no ERP nunca sai do servidor", async () => {
    const { incluir, listar, req } = await boot();
    const criado = await incluir("ana");
    const vazamentos = (await criado.text()) + JSON.stringify(await listar("ana")) + (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).text());
    expect(vazamentos).not.toContain(String(CODIGO_PRODUTO_SECRETO));
  });

  it("a busca de produto devolve nome e código de barras, nunca o código do produto, e só para quem gere o Estoque", async () => {
    const { req } = await boot();
    const res = await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/produtos?q=dipirona");
    expect(await res.json()).toEqual([{ id: PRODUTO.produtoId, nome: PRODUTO.nome, codigoBarra: PRODUTO.codigoBarra }]);
    expect((await req("gil", "GET", "/api/m/inovafarma/pre-vencidos/produtos?q=dipirona")).status).toBe(403);
  });

  it("recusa Loja fora do Vínculo, validade fora de AAAA-MM, quantidade inválida e produto inexistente", async () => {
    const { incluir, req } = await boot();
    expect((await incluir("ana", { codigoLoja: 2 })).status).toBe(403);
    expect((await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=2")).status).toBe(403);
    expect((await incluir("ana", { validade: "06/2027" })).status).toBe(400);
    expect((await incluir("ana", { quantidade: 0 })).status).toBe(400);
    expect((await incluir("ana", { quantidade: 1.5 })).status).toBe(400);
    expect((await incluir("ana", { produtoId: "6f1c0a52-0000-4000-8000-0000000000ff" })).status).toBe(404);
  });

  it("recusa quem não tem a Permission ou não tem Vínculo", async () => {
    const { incluir, req } = await boot();
    expect((await incluir("zeca")).status).toBe(403);
    expect((await req("zeca", "GET", "/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=1")).status).toBe(403);
    expect((await incluir("caio")).status).toBe(403);
  });

  it("edita quantidade e validade pela version e responde 409 quando ela está desatualizada", async () => {
    const { incluir, req } = await boot();
    const criado = (await (await incluir("ana")).json()) as Item;
    const editado = await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}`, { quantidade: 5, validade: "2027-07", version: criado.version });
    expect(editado.status).toBe(200);
    expect(await editado.json()).toMatchObject({ quantidade: 5, validade: "2027-07", version: criado.version + 1 });
    expect((await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}`, { quantidade: 6, validade: "2027-07", version: criado.version })).status).toBe(409);
    expect((await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}`, { quantidade: 0, validade: "2027-07", version: criado.version + 1 })).status).toBe(400);
  });

  it("exclui pela version, e quem não tem a Loja no Vínculo não mexe no Item", async () => {
    const { incluir, listar, req } = await boot();
    const criado = (await (await incluir("ana")).json()) as Item;
    expect((await req("caio", "DELETE", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}?version=${criado.version}`)).status).toBe(403);
    expect((await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}?version=${criado.version + 1}`)).status).toBe(409);
    expect((await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}?version=${criado.version}`)).status).toBe(200);
    expect(await listar("ana")).toEqual([]);
  });

  it("registra a inclusão, a edição e a exclusão no Audit Log", async () => {
    const { incluir, req } = await boot();
    const criado = (await (await incluir("ana")).json()) as Item;
    await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}`, { quantidade: 5, validade: "2027-06", version: criado.version });
    await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}?version=${criado.version + 1}`);
    const eventos = (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).json()) as { action: string; summary: string }[];
    expect(eventos.map((e) => e.action)).toEqual(expect.arrayContaining(["item_pre_vencido_create", "item_pre_vencido_update", "item_pre_vencido_delete"]));
  });

  it("o contexto diz que pode gerir o Estoque e traz as Lojas do Vínculo", async () => {
    const { req } = await boot();
    const contexto = await (await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(contexto).toMatchObject({ podeEstoque: true, lojas: [{ codigo: 1, nome: "Centro" }] });
    // Sem a Permission de Baixas, não há inclusão retroativa.
    expect(contexto).not.toHaveProperty("inclusaoRetroativa");
  });
});

type Grupo = { codigoColaborador: number; nomeColaborador: string; quantidade: number; vendas: { vendaId: number; data: string; nomeProduto: string; quantidade: number }[] };

describe("Baixas de Pré-vencido", () => {
  it("as vendas da Loja feitas depois da inclusão gastam o Item: a lista mostra o Restante e esconde os zerados, salvo pelo filtro", async () => {
    const { incluir, listar, req } = await boot();
    const zerado = (await (await incluir("ana", { quantidade: 2, validade: "2027-05" })).json()) as Item;
    const outro = (await (await incluir("ana", { quantidade: 3, validade: "2027-06" })).json()) as Item;
    vendas = [venda(1, -2, 1), venda(2, 2, 3), venda(3, 3, 9, { codigoLoja: 2 })];
    expect((await listar("ana")).map((i) => [i.id, i.restante])).toEqual([[outro.id, 2]]);
    const todos = (await (await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=1&zerados=true")).json()) as Item[];
    // Incluídos no mesmo instante, a ordem entre os dois não é fixa.
    expect(todos.map((i) => [i.id, i.restante])).toEqual(expect.arrayContaining([[zerado.id, 0], [outro.id, 2]]));
    expect(todos).toHaveLength(2);
  });

  it("lista as Baixas da Loja no Closing Period por Colaborador e por venda, inclusive de quem não tem Vínculo, sem as canceladas", async () => {
    const { incluir, req, periodoId } = await boot();
    await incluir("ana", { quantidade: 10 });
    vendas = [
      venda(1, 1, 2),
      venda(2, 2, 1, { codigoColaborador: 30, nomeColaborador: "RUI SEM VINCULO" }),
      venda(3, 2, 4, { cancelada: true }),
      venda(4, 3, 1),
      venda(5, 30, 1),
    ];
    const res = await req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`);
    expect(res.status).toBe(200);
    const grupos = (await res.json()) as Grupo[];
    expect(grupos.map((g) => [g.codigoColaborador, g.nomeColaborador, g.quantidade, g.vendas.map((v) => [v.vendaId, v.quantidade])])).toEqual([
      [7, "ANA SOUZA", 3, [[1, 2], [4, 1]]],
      [30, "RUI SEM VINCULO", 1, [[2, 1]]],
    ]);
    expect(grupos[0]!.vendas[0]).toMatchObject({ nomeProduto: PRODUTO.nome, data: `${dia(1)} 12:00:00` });
    expect(JSON.stringify(grupos)).not.toContain(String(CODIGO_PRODUTO_SECRETO));
  });

  it("só quem tem a Permission vê as Baixas, e só das Lojas do Vínculo", async () => {
    const { req, periodoId } = await boot();
    expect((await req("ana", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`)).status).toBe(403);
    expect((await req("lia", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`)).status).toBe(403);
    expect((await req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=nao-existe`)).status).toBe(404);
  });

  it("com o ERP indisponível responde 503 com mensagem clara, em vez de Baixas erradas", async () => {
    const { incluir, req, periodoId } = await boot();
    await incluir("ana");
    erpFora = true;
    const estoque = await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=1");
    expect(estoque.status).toBe(503);
    expect(await estoque.json()).toMatchObject({ error: expect.stringContaining("indisponível") });
    expect((await req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`)).status).toBe(503);
  });

  it("o contexto diz que pode ver as Baixas e traz as Lojas do Vínculo", async () => {
    const { req, periodoId } = await boot();
    const contexto = await (await req("gil", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(contexto).toMatchObject({ podeBaixas: true, podeEstoque: false, lojas: [{ codigo: 1, nome: "Centro" }], inclusaoRetroativa: { inicio: dia(-5) } });
    expect(contexto.periodos.map((p: { id: string }) => p.id)).toEqual([periodoId]);
  });
});

describe("Visualizações das Baixas", () => {
  async function comVendas() {
    const ctx = await boot();
    await ctx.incluir("ana", { quantidade: 10 });
    vendas = [venda(1, 1, 2), venda(2, 2, 1, { codigoColaborador: 10, nomeColaborador: "RUI LIMA" })];
    const baixas = async (who: "gil" | "dir" | "rui" | "teo" | "ana", query = "") => {
      const res = await ctx.req(who, "GET", `/api/m/inovafarma/pre-vencidos/baixas?periodoId=${ctx.periodoId}${query}`);
      return { status: res.status, grupos: res.status === 200 ? ((await res.json()) as Grupo[]).map((g) => [g.codigoColaborador, g.vendas.map((v) => v.vendaId)]) : null };
    };
    return { ...ctx, baixas };
  }

  it("Geral vê todas as Lojas e Colaboradores sem Vínculo; Loja, as do Vínculo; Individual, só as do Colaborador vinculado", async () => {
    const { baixas } = await comVendas();
    expect(await baixas("dir")).toEqual({ status: 200, grupos: [[7, [1]], [10, [2]]] });
    expect(await baixas("dir", "&codigoLoja=2")).toEqual({ status: 200, grupos: [] });
    expect(await baixas("gil", "&visualizacao=loja")).toEqual({ status: 200, grupos: [[7, [1]], [10, [2]]] });
    expect((await baixas("gil", "&visualizacao=loja&codigoLoja=2")).status).toBe(403);
    expect((await baixas("gil", "&visualizacao=geral")).status).toBe(403);
    expect(await baixas("rui")).toEqual({ status: 200, grupos: [[10, [2]]] });
  });

  it("gerir as Baixas sem Visualização abre a aba, mas não lista as Baixas", async () => {
    const { baixas, req } = await comVendas();
    expect((await baixas("teo")).status).toBe(403);
    expect((await baixas("ana")).status).toBe(403);
    const contexto = await (await req("teo", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(contexto).toMatchObject({ podeBaixas: true, podeCorrigir: true, visualizacoes: [] });
    const geral = await (await req("dir", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(geral).toMatchObject({ podeBaixas: true, podeCorrigir: false, visualizacoes: [{ id: "geral", lojas: [{ codigo: 1, nome: "Centro" }, { codigo: 2, nome: "Bairro" }] }] });
  });
});

describe("Congelamento das Baixas no fechamento do Closing Period", () => {
  async function comDoisPeriodos() {
    const ctx = await boot();
    const criado = await ctx.req("adm", "POST", "/api/closing-periods", { name: "Seguinte", startDate: dia(11), endDate: dia(40) });
    const { id: seguinteId } = (await criado.json()) as { id: string };
    const baixas = async (periodoId: string) =>
      ((await (await ctx.req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`)).json()) as Grupo[]).map((g) => [g.codigoColaborador, g.quantidade, g.vendas.map((v) => [v.vendaId, v.quantidade])]);
    const fechar = (id: string) => ctx.req("adm", "POST", `/api/closing-periods/${id}/close`);
    const reabrir = (id: string) => ctx.req("adm", "POST", `/api/closing-periods/${id}/reopen`);
    return { ...ctx, seguinteId, baixas, fechar, reabrir };
  }

  it("o Período fechado mostra as Baixas gravadas: venda cancelada depois do fechamento não o muda, e o Período aberto parte do Restante congelado", async () => {
    const { incluir, listar, periodoId, seguinteId, baixas, fechar } = await comDoisPeriodos();
    await incluir("ana", { quantidade: 5 });
    vendas = [venda(1, 2, 2), venda(2, 3, 1, { codigoColaborador: 8, nomeColaborador: "GIL COSTA" }), venda(3, 15, 4)];
    expect((await fechar(periodoId)).status).toBe(200);

    vendas = vendas.map((v) => (v.vendaId === 1 ? { ...v, cancelada: true } : v));
    expect(await baixas(periodoId)).toEqual([
      [7, 2, [[1, 2]]],
      [8, 1, [[2, 1]]],
    ]);
    // A venda 1 cancelada não devolve ao Restante: o Período fechado já a contou.
    expect(await baixas(seguinteId)).toEqual([[7, 2, [[3, 2]]]]);
    expect((await listar("ana", 1)).map((i) => i.restante)).toEqual([]);
  });

  it("recusa o fechamento com o ERP indisponível, sem gravar nada", async () => {
    const { incluir, req, periodoId, baixas, fechar } = await comDoisPeriodos();
    await incluir("ana", { quantidade: 5 });
    vendas = [venda(1, 2, 2)];
    erpFora = true;
    const recusa = await fechar(periodoId);
    expect(recusa.status).toBe(409);
    expect(await recusa.json()).toMatchObject({ error: expect.stringContaining("indisponível") });
    erpFora = false;
    expect(await (await req("adm", "GET", `/api/closing-periods/${periodoId}`)).json()).toMatchObject({ status: "open" });
    vendas = [venda(1, 2, 2, { cancelada: true })];
    expect(await baixas(periodoId)).toEqual([]);
  });

  it("o Período fechado sem Baixas gravadas não é recalculado ao vivo", async () => {
    const { incluir, periodoId, baixas, fechar } = await comDoisPeriodos();
    expect((await fechar(periodoId)).status).toBe(200);
    await incluir("ana", { quantidade: 5 });
    vendas = [venda(1, 1, 2)];
    expect(await baixas(periodoId)).toEqual([]);
  });

  it("reabrir descarta o congelado e volta a calcular ao vivo", async () => {
    const { incluir, periodoId, seguinteId, baixas, fechar, reabrir } = await comDoisPeriodos();
    await incluir("ana", { quantidade: 5 });
    vendas = [venda(1, 2, 2), venda(3, 15, 4)];
    expect((await fechar(periodoId)).status).toBe(200);
    vendas = [venda(1, 2, 2, { cancelada: true }), venda(3, 15, 4)];
    expect(await baixas(periodoId)).toEqual([[7, 2, [[1, 2]]]]);
    expect((await reabrir(periodoId)).status).toBe(200);
    expect(await baixas(periodoId)).toEqual([]);
    expect(await baixas(seguinteId)).toEqual([[7, 4, [[3, 4]]]]);
  });
});

describe("Inclusão retroativa de Item", () => {
  it("com a Permission de Baixas, inclui com data de inclusão retroativa e as vendas a partir dela geram Baixas", async () => {
    const { incluir, listar, req, periodoId } = await boot();
    const res = await incluir("rui", { quantidade: 5, incluidoEm: dia(-5) });
    expect(res.status).toBe(201);
    vendas = [venda(1, -6, 1), venda(2, -3, 2)];
    expect((await listar("rui")).map((i) => i.restante)).toEqual([3]);
    const grupos = (await (await req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${periodoId}`)).json()) as Grupo[];
    expect(grupos.map((g) => g.vendas.map((v) => [v.vendaId, v.quantidade]))).toEqual([[[2, 2]]]);
  });

  it("não retroage antes do início do Closing Period aberto nem para o futuro", async () => {
    const { incluir } = await boot();
    expect((await incluir("rui", { incluidoEm: dia(-6) })).status).toBe(400);
    expect((await incluir("rui", { incluidoEm: dia(2) })).status).toBe(400);
    expect((await incluir("rui", { incluidoEm: "03/11/2026" })).status).toBe(400);
  });

  it("retroage até o início do Período aberto mais antigo, mesmo que ele já tenha terminado", async () => {
    const { incluir, req, periodoId } = await boot();
    expect((await req("adm", "POST", "/api/closing-periods", { name: "Anterior", startDate: dia(-20), endDate: dia(-6) })).status).toBe(201);
    expect((await req("adm", "POST", `/api/closing-periods/${periodoId}/close`)).status).toBe(200);
    expect((await incluir("rui", { incluidoEm: dia(-15) })).status).toBe(201);
    expect((await incluir("rui", { incluidoEm: dia(-21) })).status).toBe(400);
    const contexto = await (await req("rui", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(contexto.inclusaoRetroativa).toEqual({ inicio: dia(-20), hoje: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("sem a Permission de Baixas, a data retroativa é recusada", async () => {
    const { incluir, listar } = await boot();
    expect((await incluir("ana", { incluidoEm: dia(-1) })).status).toBe(403);
    expect(await listar("ana")).toEqual([]);
  });

  it("com a Permission de Baixas, ajusta a data de inclusão de um Item na edição, com as mesmas regras e no Audit Log", async () => {
    const { incluir, listar, req } = await boot();
    const criado = (await (await incluir("rui", { quantidade: 5 })).json()) as Item;
    const editar = (who: "rui" | "ana", body: Record<string, unknown>) => req(who, "PUT", `/api/m/inovafarma/pre-vencidos/estoque/itens/${criado.id}`, { quantidade: 5, validade: "2027-06", ...body });
    expect((await editar("ana", { incluidoEm: dia(-2), version: 1 })).status).toBe(403);
    expect((await editar("rui", { incluidoEm: dia(-6), version: 1 })).status).toBe(400);
    expect((await editar("rui", { incluidoEm: dia(2), version: 1 })).status).toBe(400);
    expect((await editar("rui", { incluidoEm: dia(-5), version: 1 })).status).toBe(200);
    vendas = [venda(1, -4, 2)];
    expect((await listar("rui")).map((i) => i.restante)).toEqual([3]);
    const eventos = (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).json()) as { action: string; summary: string }[];
    expect(eventos.find((e) => e.action === "item_pre_vencido_update")?.summary).toContain("Data de inclusão de");
  });
});

type Correcao = { id: string; version: number; quantidade: number; motivo: string };
type GrupoComCorrecao = Grupo & { vendas: (Grupo["vendas"][number] & { produtoId: string; correcao?: { id: string; quantidade: number; motivo: string; version: number } })[] };

describe("Correção de Baixa", () => {
  async function comBaixas() {
    const ctx = await boot();
    await ctx.incluir("ana", { quantidade: 3 });
    vendas = [venda(1, 1, 2), venda(2, 2, 2, { codigoColaborador: 8, nomeColaborador: "GIL COSTA" })];
    const baixas = async () => (await (await ctx.req("gil", "GET", `/api/m/inovafarma/pre-vencidos/baixas?codigoLoja=1&periodoId=${ctx.periodoId}`)).json()) as GrupoComCorrecao[];
    const corrigir = (who: "gil" | "lia" | "ana" | "rui", body: Record<string, unknown> = {}) =>
      ctx.req(who, "POST", "/api/m/inovafarma/pre-vencidos/baixas/correcoes", { codigoLoja: 1, periodoId: ctx.periodoId, vendaId: 1, produtoId: PRODUTO.produtoId, quantidade: 1, motivo: "Uma unidade não era Pré-vencido", ...body });
    return { ...ctx, baixas, corrigir };
  }
  const resumo = (grupos: GrupoComCorrecao[]) => grupos.map((g) => [g.codigoColaborador, g.vendas.map((v) => [v.vendaId, v.quantidade])]);

  it("corrige a Baixa de uma venda: o que sai volta ao Restante e é gasto pelas vendas seguintes", async () => {
    const { baixas, corrigir, listar } = await comBaixas();
    expect(resumo(await baixas())).toEqual([[7, [[1, 2]]], [8, [[2, 1]]]]);
    const res = await corrigir("gil");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ quantidade: 1, motivo: "Uma unidade não era Pré-vencido", version: 1 });
    const grupos = await baixas();
    expect(resumo(grupos)).toEqual([[7, [[1, 1]]], [8, [[2, 2]]]]);
    expect(grupos[0]!.vendas[0]!.correcao).toMatchObject({ quantidade: 1, motivo: "Uma unidade não era Pré-vencido" });
    expect(await listar("ana")).toEqual([]);
  });

  it("corrige para zero e mantém a venda na lista, mas não acima do que a venda teve, sem motivo ou duas vezes", async () => {
    const { baixas, corrigir } = await comBaixas();
    expect((await corrigir("gil", { quantidade: 3 })).status).toBe(400);
    expect((await corrigir("gil", { quantidade: -1 })).status).toBe(400);
    expect((await corrigir("gil", { motivo: "  " })).status).toBe(400);
    expect((await corrigir("gil", { vendaId: 99 })).status).toBe(404);
    expect((await corrigir("gil", { quantidade: 0 })).status).toBe(201);
    expect((await corrigir("gil", { quantidade: 2 })).status).toBe(409);
    expect(resumo(await baixas())).toEqual([[7, [[1, 0]]], [8, [[2, 2]]]]);
  });

  it("não corrige acima do que havia no Estoque para a venda, para que a Correção seja a Baixa que vale", async () => {
    const { baixas, corrigir, req } = await comBaixas();
    // A venda 2 teve 2, mas só 1 restava no Estoque quando ela foi feita.
    const acima = await corrigir("gil", { vendaId: 2, quantidade: 2 });
    expect(acima.status).toBe(400);
    expect(await acima.json()).toMatchObject({ error: expect.stringContaining("(1)") });
    // Na edição, o teto é o que a venda baixaria sem a própria Correção.
    const criada = (await (await corrigir("gil", { quantidade: 1 })).json()) as Correcao;
    expect((await req("gil", "PUT", `/api/m/inovafarma/pre-vencidos/baixas/correcoes/${criada.id}`, { quantidade: 2, motivo: "Eram duas", version: 1 })).status).toBe(200);
    expect(resumo(await baixas())).toEqual([[7, [[1, 2]]], [8, [[2, 1]]]]);
  });

  it("recusa sem a Permission, fora das Lojas do Vínculo e no Período fechado", async () => {
    const { corrigir, req, periodoId } = await comBaixas();
    expect((await corrigir("ana")).status).toBe(403);
    expect((await corrigir("lia")).status).toBe(403);
    expect((await req("adm", "POST", `/api/closing-periods/${periodoId}/close`)).status).toBe(200);
    expect((await corrigir("gil")).status).toBe(409);
  });

  it("edita e desfaz a Correção pela version, com 409 quando ela está desatualizada", async () => {
    const { baixas, corrigir, req } = await comBaixas();
    const criada = (await (await corrigir("gil")).json()) as Correcao;
    const url = `/api/m/inovafarma/pre-vencidos/baixas/correcoes/${criada.id}`;
    expect((await req("gil", "PUT", url, { quantidade: 0, motivo: "Nenhuma era", version: 1 })).status).toBe(200);
    expect((await req("gil", "PUT", url, { quantidade: 2, motivo: "Todas eram", version: 1 })).status).toBe(409);
    expect((await req("lia", "PUT", url, { quantidade: 2, motivo: "Todas eram", version: 2 })).status).toBe(403);
    expect(resumo(await baixas())).toEqual([[7, [[1, 0]]], [8, [[2, 2]]]]);
    expect((await req("gil", "DELETE", `${url}?version=1`)).status).toBe(409);
    expect((await req("gil", "DELETE", `${url}?version=2`)).status).toBe(200);
    expect(resumo(await baixas())).toEqual([[7, [[1, 2]]], [8, [[2, 1]]]]);
  });

  it("registra a Correção no Audit Log com o antes, o depois e o motivo", async () => {
    const { corrigir, req } = await comBaixas();
    const criada = (await (await corrigir("gil")).json()) as Correcao;
    await req("gil", "PUT", `/api/m/inovafarma/pre-vencidos/baixas/correcoes/${criada.id}`, { quantidade: 0, motivo: "Nenhuma era", version: 1 });
    await req("gil", "DELETE", `/api/m/inovafarma/pre-vencidos/baixas/correcoes/${criada.id}?version=2`);
    const eventos = (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).json()) as { action: string; summary: string }[];
    const resumoDe = (action: string) => eventos.find((e) => e.action === action)?.summary;
    expect(resumoDe("correcao_baixa_create")).toContain("de 2 para 1 un. Motivo: Uma unidade não era Pré-vencido");
    expect(resumoDe("correcao_baixa_update")).toContain("de 1 para 0 un. Motivo: Nenhuma era (antes: Uma unidade não era Pré-vencido)");
    expect(resumoDe("correcao_baixa_delete")).toContain("era 0 un. Motivo: Nenhuma era");
    expect(JSON.stringify(eventos)).not.toContain(String(CODIGO_PRODUTO_SECRETO));
  });

  it("o Período fechado guarda a Correção com as Baixas congeladas", async () => {
    const { baixas, corrigir, req, periodoId } = await comBaixas();
    expect((await corrigir("gil")).status).toBe(201);
    expect((await req("adm", "POST", `/api/closing-periods/${periodoId}/close`)).status).toBe(200);
    const grupos = await baixas();
    expect(resumo(grupos)).toEqual([[7, [[1, 1]]], [8, [[2, 2]]]]);
    expect(grupos[0]!.vendas[0]!.correcao).toMatchObject({ motivo: "Uma unidade não era Pré-vencido" });
  });
});

