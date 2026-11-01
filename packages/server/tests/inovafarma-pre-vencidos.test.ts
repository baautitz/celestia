import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const LANCAR = "inovafarma:pre-vencidos-lancamento:manage";
const CONFERIR = "inovafarma:pre-vencidos-conferencia:view";
const CODIGO_PRODUTO_SECRETO = 987654;
const PRODUTO = { produtoId: "6f1c0a52-0000-4000-8000-000000000001", nome: "DIPIRONA 500MG", codigoBarra: "7891234567895" };

const LOJAS = [
  { codigoEmpresa: 1, nome: "Centro" },
  { codigoEmpresa: 2, nome: "Bairro" },
];
const COLABORADORES = [
  { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
  { codigoColaborador: 8, nome: "BIA LIMA", ativo: true },
];
/** Vendido no ERP por Colaborador e produto no período, em todas as Lojas. */
let vendas: { codigoColaborador: number; produtoId: string; quantidade: number }[] = [];

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) => {
    if (sql.includes("Venda_Produto")) return vendas as TRow[];
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
      { id: "adm", name: "Adm", permissions: ["inovafarma:colaboradores:update", "inovafarma:colaboradores:view", "closing_period:period:create", "closing_period:period:read", "closing_period:period:close"] },
      { id: "vend", name: "Vendedor", permissions: [LANCAR] },
      { id: "ger", name: "Gestor", permissions: [CONFERIR] },
      { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] },
    ],
    users: [usuario("adm", "adm"), usuario("ana", "vend"), usuario("bia", "vend"), usuario("caio", "vend"), usuario("ger", "ger"), usuario("auditor", "audit")],
  });
  const platform = createPlatform({ userStore, erpClients: { inovafarma: erp } });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Senha@123" }) });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  };
  const h = { adm: await login("adm"), ana: await login("ana"), bia: await login("bia"), caio: await login("caio"), ger: await login("ger"), auditor: await login("auditor") };
  const req = (who: keyof typeof h, method: string, path: string, body?: unknown) =>
    platform.app.request(path, { method, headers: h[who], body: body === undefined ? undefined : JSON.stringify(body) });
  const vincular = async (codigo: number, usuarioId: string, lojas: number[]) =>
    expect((await req("adm", "PUT", `/api/m/inovafarma/colaboradores/${codigo}/vinculo`, { usuarioId, lojas, version: 0 })).status).toBe(200);
  const criarPeriodo = async (name: string, startDate: string, endDate: string) => {
    const res = await req("adm", "POST", "/api/closing-periods", { name, startDate, endDate });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; version: number };
  };
  await vincular(7, "ana", [1]);
  await vincular(8, "bia", [1, 2]);
  const marco = await criarPeriodo("Março", "2027-03-01", "2027-03-31");
  const abril = await criarPeriodo("Abril", "2027-04-01", "2027-04-30");
  const lancar = (who: keyof typeof h, body: Record<string, unknown>) =>
    req(who, "POST", "/api/m/inovafarma/pre-vencidos/lancamentos", { produtoId: PRODUTO.produtoId, quantidade: 3, validade: "2027-06", codigoLoja: 1, periodoId: abril.id, ...body });
  return { platform, req, lancar, marco, abril };
}

type Lancamento = { id: string; version: number; nomeProduto: string; quantidade: number; [k: string]: unknown };

describe("Lançamento de Pré-vencidos", () => {
  it("o contexto traz os Closing Periods abertos e fechados, para consultar os fechados, e as Lojas do Vínculo", async () => {
    const { req, marco, abril } = await boot();
    await req("adm", "POST", `/api/closing-periods/${marco.id}/close`);
    const contexto = await (await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(contexto.periodos.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([[abril.id, "open"], [marco.id, "closed"]]);
    expect(contexto.lojas).toEqual([{ codigo: 1, nome: "Centro" }]);
  });

  it("lista os lançamentos de um período fechado, só para consulta", async () => {
    const { lancar, req, abril } = await boot();
    await lancar("ana", {});
    await req("adm", "POST", `/api/closing-periods/${abril.id}/close`);
    const lista = (await (await req("ana", "GET", `/api/m/inovafarma/pre-vencidos/lancamentos?periodoId=${abril.id}`)).json()) as Lancamento[];
    expect(lista).toHaveLength(1);
    expect((await lancar("ana", {})).status).toBe(409);
  });

  it("ordena os períodos pela data de início, não pela criação", async () => {
    const { req, marco, abril } = await boot();
    const { periodos } = await (await req("bia", "GET", "/api/m/inovafarma/pre-vencidos/contexto")).json();
    expect(periodos.map((p: { id: string }) => p.id)).toEqual([abril.id, marco.id]);
  });

  it("a busca de produto devolve nome e código de barras, nunca o código do produto", async () => {
    const { req } = await boot();
    const res = await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/produtos?q=dipirona");
    expect(await res.json()).toEqual([{ id: PRODUTO.produtoId, nome: PRODUTO.nome, codigoBarra: PRODUTO.codigoBarra }]);
  });

  it("lança, soma o mesmo produto em lançamentos separados e não vaza o código do produto", async () => {
    const { lancar, req } = await boot();
    const primeiro = await lancar("ana", {});
    expect(primeiro.status).toBe(201);
    expect((await lancar("ana", { quantidade: 2 })).status).toBe(201);
    const lista = (await (await req("ana", "GET", "/api/m/inovafarma/pre-vencidos/lancamentos?periodoId=" + (await primeiro.clone().json()).periodoId)).json()) as Lancamento[];
    expect(lista.map((l) => l.quantidade).sort()).toEqual([2, 3]);
    expect(lista[0]).toMatchObject({ nomeProduto: PRODUTO.nome, codigoBarra: PRODUTO.codigoBarra, codigoLoja: 1, validade: "2027-06" });

    const vazamentos = JSON.stringify(lista) + (await primeiro.text()) + (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).text());
    expect(vazamentos).not.toContain(String(CODIGO_PRODUTO_SECRETO));
  });

  it("recusa Loja fora do Vínculo, validade inválida, quantidade inválida e produto inexistente", async () => {
    const { lancar } = await boot();
    expect((await lancar("ana", { codigoLoja: 2 })).status).toBe(403);
    expect((await lancar("ana", { validade: "06/2027" })).status).toBe(400);
    expect((await lancar("ana", { quantidade: 0 })).status).toBe(400);
    expect((await lancar("ana", { produtoId: "6f1c0a52-0000-4000-8000-0000000000ff" })).status).toBe(404);
  });

  it("recusa quem não tem a Permission ou não tem Vínculo", async () => {
    const { lancar, req } = await boot();
    expect((await lancar("ger", {})).status).toBe(403);
    expect((await lancar("caio", {})).status).toBe(403);
    expect((await req("ger", "GET", "/api/m/inovafarma/pre-vencidos/lancamentos")).status).toBe(403);
  });

  it("não lança nem altera em Closing Period fechado", async () => {
    const { lancar, req, abril } = await boot();
    const criado = (await (await lancar("ana", {})).json()) as Lancamento;
    await req("adm", "POST", `/api/closing-periods/${abril.id}/close`);
    expect((await lancar("ana", {})).status).toBe(409);
    expect((await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}`, { quantidade: 9, validade: "2027-06", version: criado.version })).status).toBe(409);
    expect((await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}?version=${criado.version}`)).status).toBe(409);
  });

  it("edita com a version e responde 409 quando ela está desatualizada", async () => {
    const { lancar, req } = await boot();
    const criado = (await (await lancar("ana", {})).json()) as Lancamento;
    const editado = await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}`, { quantidade: 5, validade: "2027-07", version: criado.version });
    expect(await editado.json()).toMatchObject({ quantidade: 5, validade: "2027-07", version: criado.version + 1 });
    expect((await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}`, { quantidade: 6, validade: "2027-07", version: criado.version })).status).toBe(409);
  });

  it("exclui, e ninguém mexe no lançamento de outro vendedor", async () => {
    const { lancar, req } = await boot();
    const criado = (await (await lancar("ana", {})).json()) as Lancamento;
    expect((await req("bia", "DELETE", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}?version=${criado.version}`)).status).toBe(404);
    expect((await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}?version=${criado.version}`)).status).toBe(200);
  });

  it("registra a criação, a edição e a exclusão no Audit Log", async () => {
    const { lancar, req } = await boot();
    const criado = (await (await lancar("ana", {})).json()) as Lancamento;
    await req("ana", "PUT", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}`, { quantidade: 5, validade: "2027-06", version: criado.version });
    await req("ana", "DELETE", `/api/m/inovafarma/pre-vencidos/lancamentos/${criado.id}?version=${criado.version + 1}`);
    const eventos = (await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).json()) as { action: string }[];
    expect(eventos.map((e) => e.action)).toEqual(expect.arrayContaining(["pre_vencido_create", "pre_vencido_update", "pre_vencido_delete"]));
  });
});

describe("Conferência de Pré-vencidos", () => {
  it("compara o lançado com o vendido em todas as Lojas: verde se vendeu o bastante, vermelho se não", async () => {
    const { lancar, req, abril } = await boot();
    await lancar("ana", { quantidade: 3 });
    await lancar("bia", { quantidade: 4, codigoLoja: 2 });
    vendas = [
      { codigoColaborador: 7, produtoId: PRODUTO.produtoId, quantidade: 3 },
      { codigoColaborador: 8, produtoId: PRODUTO.produtoId, quantidade: 1 },
    ];
    const res = await req("ger", "GET", `/api/m/inovafarma/pre-vencidos/conferencia?periodoId=${abril.id}`);
    expect(res.status).toBe(200);
    const linhas = (await res.json()) as { codigoColaborador: number; situacao: string; quantidadeVendida: number }[];
    expect(linhas.map((l) => [l.codigoColaborador, l.situacao, l.quantidadeVendida])).toEqual([[7, "verde", 3], [8, "vermelho", 1]]);
    expect(JSON.stringify(linhas)).not.toContain(String(CODIGO_PRODUTO_SECRETO));
  });

  it("filtra por Loja", async () => {
    const { lancar, req, abril } = await boot();
    vendas = [];
    await lancar("ana", {});
    await lancar("bia", { codigoLoja: 2 });
    const porLoja = (await (await req("ger", "GET", `/api/m/inovafarma/pre-vencidos/conferencia?periodoId=${abril.id}&codigoLoja=2`)).json()) as { codigoColaborador: number }[];
    expect(porLoja.map((l) => l.codigoColaborador)).toEqual([8]);
  });

  it("recusa filtro que não é número, em vez de ignorá-lo", async () => {
    const { req, abril } = await boot();
    expect((await req("ger", "GET", `/api/m/inovafarma/pre-vencidos/conferencia?periodoId=${abril.id}&codigoLoja=abc`)).status).toBe(400);
  });

  it("só o gestor com a Permission vê a Conferência", async () => {
    const { req, abril } = await boot();
    expect((await req("ana", "GET", `/api/m/inovafarma/pre-vencidos/conferencia?periodoId=${abril.id}`)).status).toBe(403);
  });
});
