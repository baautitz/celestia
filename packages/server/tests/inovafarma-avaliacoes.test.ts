import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const INDIVIDUAL = "inovafarma:avaliacoes-individual:view";
const LOJA = "inovafarma:avaliacoes-loja:manage";
const GERAL = "inovafarma:avaliacoes-geral:manage";

const LOJAS = [
  { codigoEmpresa: 1, nome: "Centro" },
  { codigoEmpresa: 2, nome: "Bairro" },
];
const COLABORADORES = [
  { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, codigoEmpresa: 1 },
  // Vinculada à Loja 2: o Vínculo vale mais que a Loja do ERP.
  { codigoColaborador: 8, nome: "BIA LIMA", ativo: true, codigoEmpresa: 1 },
  { codigoColaborador: 9, nome: "GIL GERENTE", ativo: true, codigoEmpresa: 1 },
  // Sem Vínculo: valem a Loja do ERP e o estado no ERP.
  { codigoColaborador: 10, nome: "CAIO SEM VINCULO", ativo: true, codigoEmpresa: 1 },
  { codigoColaborador: 11, nome: "DORA INATIVA", ativo: false, codigoEmpresa: 1 },
];

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) => {
    if (sql.includes("Config")) return LOJAS as TRow[];
    return (params?.codigo === undefined ? COLABORADORES : COLABORADORES.filter((c) => c.codigoColaborador === params.codigo)) as TRow[];
  },
};

const passwordHash = PasswordService.hash("Senha@123");
const usuario = (id: string, roleId: string): User => ({ id, username: id, fullname: id, passwordHash, roleId, status: "active", createdAt: new Date().toISOString() });

async function boot() {
  const userStore = new TestUserStore({
    roles: [
      { id: "adm", name: "Adm", permissions: ["inovafarma:colaboradores:update", "inovafarma:colaboradores:view", "closing_period:period:create", "closing_period:period:read", "closing_period:period:close"] },
      { id: "vend", name: "Vendedor", permissions: [INDIVIDUAL] },
      { id: "ger", name: "Gestor", permissions: [INDIVIDUAL, LOJA] },
      { id: "rh", name: "RH", permissions: [GERAL] },
      { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] },
    ],
    users: [usuario("adm", "adm"), usuario("ana", "vend"), usuario("bia", "vend"), usuario("gil", "ger"), usuario("rh", "rh"), usuario("auditor", "audit")],
  });
  const platform = createPlatform({ userStore, erpClients: { inovafarma: erp } });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Senha@123" }) });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
  };
  const h = { adm: await login("adm"), ana: await login("ana"), bia: await login("bia"), gil: await login("gil"), rh: await login("rh"), auditor: await login("auditor") };
  const req = (who: keyof typeof h, method: string, path: string, body?: unknown) =>
    platform.app.request(path, { method, headers: h[who], body: body === undefined ? undefined : JSON.stringify(body) });
  const vincular = async (codigo: number, usuarioId: string, lojas: number[]) =>
    expect((await req("adm", "PUT", `/api/m/inovafarma/colaboradores/${codigo}/vinculo`, { usuarioId, lojas, version: 0 })).status).toBe(200);
  await vincular(7, "ana", [1]);
  await vincular(8, "bia", [2]);
  await vincular(9, "gil", [1]);
  const res = await req("adm", "POST", "/api/closing-periods", { name: "Abril", startDate: "2027-04-01", endDate: "2027-04-30" });
  const abril = (await res.json()) as { id: string };
  const lancar = (who: keyof typeof h, body: Record<string, unknown> = {}) =>
    req(who, "POST", "/api/m/inovafarma/avaliacoes", { periodoId: abril.id, codigoColaborador: 7, codigoLoja: 1, descricao: "Atraso no caixa", valor: 12.5, ...body });
  return { req, lancar, abril };
}

type Avaliacao = { id: string; version: number; valor: number; descricao: string; [k: string]: unknown };

describe("Avaliações do Colaborador", () => {
  it("o gestor lança para um Colaborador da sua Loja e o Colaborador vê só as suas", async () => {
    const { req, lancar, abril } = await boot();
    const res = await lancar("gil");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ nomeColaborador: "ANA SOUZA", codigoLoja: 1, valor: 12.5, descricao: "Atraso no caixa" });

    const daAna = (await (await req("ana", "GET", `/api/m/inovafarma/avaliacoes/minhas?periodoId=${abril.id}`)).json()) as Avaliacao[];
    expect(daAna.map((a) => a.valor)).toEqual([12.5]);
    expect(daAna[0]).not.toHaveProperty("criadoPor");
    expect(daAna[0]).not.toHaveProperty("lancadoPor");
    expect(await (await req("bia", "GET", `/api/m/inovafarma/avaliacoes/minhas?periodoId=${abril.id}`)).json()).toEqual([]);
  });

  it("aceita valor zero e recusa negativo", async () => {
    const { lancar } = await boot();
    expect((await lancar("gil", { valor: 0 })).status).toBe(201);
    expect((await lancar("gil", { valor: -1 })).status).toBe(400);
  });

  it("o gestor só lança e vê nas suas Lojas e não avalia a si mesmo", async () => {
    const { req, lancar, abril } = await boot();
    expect((await lancar("gil", { codigoColaborador: 8, codigoLoja: 2 })).status).toBe(403);
    expect((await lancar("gil", { codigoColaborador: 9 })).status).toBe(403);
    expect((await lancar("ana")).status).toBe(403);

    const colaboradores = await (await req("gil", "GET", "/api/m/inovafarma/avaliacoes/colaboradores")).json();
    expect(colaboradores).toEqual([
      { codigoColaborador: 7, nome: "ANA SOUZA", usuario: "ana", lojas: [1] },
      { codigoColaborador: 10, nome: "CAIO SEM VINCULO", usuario: null, lojas: [1] },
    ]);

    expect((await lancar("rh", { codigoColaborador: 8, codigoLoja: 2 })).status).toBe(201);
    expect(await (await req("gil", "GET", `/api/m/inovafarma/avaliacoes?periodoId=${abril.id}`)).json()).toEqual([]);
    expect(await (await req("rh", "GET", `/api/m/inovafarma/avaliacoes?periodoId=${abril.id}`)).json()).toMatchObject([{ nomeColaborador: "BIA LIMA", lancadoPor: "rh" }]);
  });

  it("avalia Colaborador ativo sem Vínculo pela Loja do ERP, mas não o inativo sem Vínculo", async () => {
    const { lancar } = await boot();
    expect(await (await lancar("gil", { codigoColaborador: 10 })).json()).toMatchObject({ nomeColaborador: "CAIO SEM VINCULO", codigoLoja: 1 });
    expect((await lancar("gil", { codigoColaborador: 11 })).status).toBe(403);
    expect((await lancar("gil", { codigoColaborador: 10, codigoLoja: 2 })).status).toBe(403);
  });

  it("edita descrição e valor com controle de version e não altera em período fechado", async () => {
    const { req, lancar, abril } = await boot();
    const criada = (await (await lancar("gil")).json()) as Avaliacao;
    const editar = (version: number) => req("gil", "PUT", `/api/m/inovafarma/avaliacoes/${criada.id}`, { descricao: "Atraso", valor: 20, version });
    expect(await (await editar(1)).json()).toMatchObject({ descricao: "Atraso", valor: 20, version: 2 });
    expect((await editar(1)).status).toBe(409);

    await req("adm", "POST", `/api/closing-periods/${abril.id}/close`);
    expect((await req("gil", "DELETE", `/api/m/inovafarma/avaliacoes/${criada.id}?version=2`)).status).toBe(409);
    expect((await lancar("gil")).status).toBe(409);
  });

  it("registra lançar, editar e excluir no Audit Log", async () => {
    const { req, lancar } = await boot();
    const criada = (await (await lancar("gil")).json()) as Avaliacao;
    await req("gil", "PUT", `/api/m/inovafarma/avaliacoes/${criada.id}`, { descricao: "Atraso", valor: 20, version: 1 });
    expect((await req("gil", "DELETE", `/api/m/inovafarma/avaliacoes/${criada.id}?version=2`)).status).toBe(200);
    const log = await (await req("auditor", "GET", "/api/audit?plugin=inovafarma")).text();
    for (const action of ["avaliacao_create", "avaliacao_update", "avaliacao_delete"]) expect(log).toContain(action);
  });

  it("sem Permission nenhuma, recusa o contexto", async () => {
    const { req } = await boot();
    expect((await req("auditor", "GET", "/api/m/inovafarma/avaliacoes/contexto")).status).toBe(403);
  });
});
