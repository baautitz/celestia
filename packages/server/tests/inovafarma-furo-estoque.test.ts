import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const LOJA = "inovafarma:furo-estoque-loja:manage";
const GERAL = "inovafarma:furo-estoque-geral:manage";

const LOJAS = [
  { codigoEmpresa: 1, nome: "Centro" },
  { codigoEmpresa: 2, nome: "Bairro" },
];

const item = (codigoMovimento: number, codigoLoja: number, operacao: "+" | "-", nome: string, quantidade: number, totalCusto: number) => ({
  codigoMovimento,
  codigoLoja,
  data: new Date("2027-04-10T15:36:00Z"),
  operacao,
  produtoId: `p-${nome}`,
  nome,
  codigoBarra: null,
  quantidade,
  precoCusto: Math.abs(totalCusto / quantidade),
  totalCusto,
  colaborador: "ANA SOUZA",
  usuario: "ANA",
  observacao: "VENCIDOS MES 04",
});
const ITENS = [item(100, 1, "-", "DIPIRONA", -2, -10), item(100, 1, "-", "FRALDA", -1, -40.5), item(200, 2, "+", "SABONETE", 3, 9)];

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) => {
    if (sql.includes("Config")) return LOJAS as TRow[];
    if (sql.includes("Estoque_Movimentacao")) {
      const lojas = Object.entries(params ?? {}).filter(([k]) => k.startsWith("loja")).map(([, v]) => v);
      return ITENS.filter((i) => (params?.codigoMovimento === undefined || i.codigoMovimento === params.codigoMovimento) && (lojas.length === 0 || lojas.includes(i.codigoLoja))) as TRow[];
    }
    return [{ codigoColaborador: 9, nome: "GIL GERENTE", ativo: true, codigoEmpresa: 1 }] as TRow[];
  },
};

const passwordHash = PasswordService.hash("Senha@123");
const usuario = (id: string, roleId: string): User => ({ id, username: id, fullname: id, passwordHash, roleId, status: "active", createdAt: new Date().toISOString() });

async function boot() {
  const userStore = new TestUserStore({
    roles: [
      { id: "adm", name: "Adm", permissions: ["inovafarma:colaboradores:update", "inovafarma:colaboradores:view", "closing_period:period:create", "closing_period:period:read", "closing_period:period:close"] },
      { id: "ger", name: "Gestor", permissions: [LOJA] },
      { id: "dir", name: "Diretor", permissions: [GERAL] },
      { id: "vend", name: "Vendedor", permissions: [] },
    ],
    users: [usuario("adm", "adm"), usuario("gil", "ger"), usuario("dir", "dir"), usuario("ana", "vend")],
  });
  const platform = createPlatform({ userStore, erpClients: { inovafarma: erp } });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Senha@123" }) });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  };
  const h = { adm: await login("adm"), gil: await login("gil"), dir: await login("dir"), ana: await login("ana") };
  const req = (who: keyof typeof h, method: string, path: string, body?: unknown) =>
    platform.app.request(path, { method, headers: h[who], body: body === undefined ? undefined : JSON.stringify(body) });
  expect((await req("adm", "PUT", "/api/m/inovafarma/colaboradores/9/vinculo", { usuarioId: "gil", lojas: [1], version: 0 })).status).toBe(200);
  const abril = (await (await req("adm", "POST", "/api/closing-periods", { name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30" })).json()) as { id: string };
  const contexto = (await (await req("dir", "GET", "/api/m/inovafarma/furo-estoque/contexto")).json()) as { motivos: { id: string; nome: string; version: number }[] };
  const motivo = contexto.motivos.find((m) => m.nome === "Vencido")!;
  const justificar = (who: keyof typeof h, body: Record<string, unknown> = {}) =>
    req(who, "POST", "/api/m/inovafarma/furo-estoque/justificativas", { periodoId: abril.id, codigoMovimento: 100, motivoId: motivo.id, observacao: "Vencidos do mês", ...body });
  const ajustes = async (who: keyof typeof h) => (await req(who, "GET", `/api/m/inovafarma/furo-estoque/ajustes?periodoId=${abril.id}`)).json() as Promise<Ajuste[]>;
  return { req, justificar, ajustes, abril, motivo };
}

type Ajuste = { codigoMovimento: number; totalCusto: number; quantidade: number; data: string; itens: unknown[]; justificativa: { id: string; version: number; motivo: string; justificadoPor: string } | null };

describe("Furo de Estoque", () => {
  it("lista os Ajustes de Estoque do período agrupados por movimentação, com sinal e custo", async () => {
    const { ajustes } = await boot();
    const lista = await ajustes("dir");
    expect(lista.map((a) => [a.codigoMovimento, a.quantidade, a.totalCusto, a.itens.length])).toEqual([
      [100, -3, -50.5, 2],
      [200, 3, 9, 1],
    ]);
    expect(lista[0]).toMatchObject({ data: "2027-04-10 15:36", operacao: "-", observacaoErp: "VENCIDOS MES 04", justificativa: null });
    expect(JSON.stringify(lista)).not.toContain("codigoProduto");
  });

  it("o gestor só vê e justifica Ajustes das suas Lojas; sem Permission, 403", async () => {
    const { ajustes, justificar } = await boot();
    expect((await ajustes("gil")).map((a) => a.codigoMovimento)).toEqual([100]);
    expect((await justificar("gil", { codigoMovimento: 200 })).status).toBe(403);
    expect((await justificar("ana")).status).toBe(403);
    expect((await justificar("gil")).status).toBe(201);
    expect((await ajustes("gil"))[0]!.justificativa).toMatchObject({ motivo: "Vencido", justificadoPor: "gil" });
  });

  it("um Ajuste tem uma só Justificativa e o Ajuste precisa existir no período", async () => {
    const { justificar } = await boot();
    expect((await justificar("dir")).status).toBe(201);
    expect((await justificar("dir")).status).toBe(409);
    expect((await justificar("dir", { codigoMovimento: 999 })).status).toBe(404);
  });

  it("edita com version, exclui e bloqueia com o período fechado", async () => {
    const { req, justificar, ajustes, abril, motivo } = await boot();
    const criada = (await (await justificar("dir")).json()) as { id: string };
    const url = `/api/m/inovafarma/furo-estoque/justificativas/${criada.id}`;
    expect(await (await req("dir", "PUT", url, { motivoId: motivo.id, observacao: "", version: 1 })).json()).toMatchObject({ observacao: null, version: 2 });
    expect((await req("dir", "PUT", url, { motivoId: motivo.id, version: 1 })).status).toBe(409);

    expect((await req("adm", "POST", `/api/closing-periods/${abril.id}/close`, { version: 1 })).status).toBe(200);
    expect((await req("dir", "DELETE", `${url}?version=2`)).status).toBe(409);
    expect((await ajustes("dir"))[0]!.justificativa).not.toBeNull();
  });

  it("Motivos: só a Permission geral cadastra; nome único; inativo não pode ser escolhido", async () => {
    const { req, justificar, motivo } = await boot();
    expect((await req("gil", "POST", "/api/m/inovafarma/furo-estoque/motivos", { nome: "Furto" })).status).toBe(403);
    expect((await req("dir", "POST", "/api/m/inovafarma/furo-estoque/motivos", { nome: "vencido" })).status).toBe(409);
    expect((await req("dir", "POST", "/api/m/inovafarma/furo-estoque/motivos", { nome: "Furto" })).status).toBe(201);
    expect((await req("dir", "PUT", `/api/m/inovafarma/furo-estoque/motivos/${motivo.id}`, { nome: "Vencido", ativo: false, version: motivo.version })).status).toBe(200);
    expect((await justificar("dir")).status).toBe(400);
  });
});
