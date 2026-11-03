import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const ESTOQUE = "inovafarma:pre-vencidos-estoque:manage";
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

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) => {
    if (sql.includes("Venda_Produto")) return [] as TRow[];
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
      { id: "adm", name: "Adm", permissions: ["inovafarma:colaboradores:update", "inovafarma:colaboradores:view"] },
      { id: "est", name: "Estoque", permissions: [ESTOQUE] },
      { id: "outro", name: "Outro", permissions: ["inovafarma:colaboradores:view"] },
      { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] },
    ],
    users: [usuario("adm", "adm"), usuario("ana", "est"), usuario("caio", "est"), usuario("zeca", "outro"), usuario("auditor", "audit")],
  });
  const platform = createPlatform({ userStore, erpClients: { inovafarma: erp } });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Senha@123" }) });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  };
  const h = { adm: await login("adm"), ana: await login("ana"), caio: await login("caio"), zeca: await login("zeca"), auditor: await login("auditor") };
  const req = (who: keyof typeof h, method: string, path: string, body?: unknown) =>
    platform.app.request(path, { method, headers: h[who], body: body === undefined ? undefined : JSON.stringify(body) });
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/7/vinculo", { usuarioId: "ana", lojas: [1], version: 0 })).status).toBe(200);
  const incluir = (who: keyof typeof h, body: Record<string, unknown> = {}) =>
    req(who, "POST", "/api/m/inovafarma/pre-vencidos/estoque/itens", { codigoLoja: 1, produtoId: PRODUTO.produtoId, quantidade: 3, validade: "2027-06", ...body });
  const listar = async (who: keyof typeof h, codigoLoja = 1) => (await (await req(who, "GET", `/api/m/inovafarma/pre-vencidos/estoque/itens?codigoLoja=${codigoLoja}`)).json()) as Item[];
  return { req, incluir, listar };
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
    expect(contexto).toMatchObject({ podeEstoque: true, lojasEstoque: [{ codigo: 1, nome: "Centro" }] });
  });
});
