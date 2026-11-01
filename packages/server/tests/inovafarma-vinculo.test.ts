import { describe, expect, it } from "vitest";
import type { User } from "@platform/shared";
import { TestUserStore } from "./helpers/fixtures.js";
import { createPlatform } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import type { ErpClient } from "../src/erp/erp-client.js";

const VIEW = "inovafarma:colaboradores:view";
const UPDATE = "inovafarma:colaboradores:update";
const COLABORADORES = [
  { codigoColaborador: 7, nome: "ANA SOUZA", ativo: true },
  { codigoColaborador: 9, nome: "BRUNO LIMA", ativo: false },
];

const erp: ErpClient = {
  query: async <TRow>(_sql: string, params?: Record<string, unknown>) =>
    (params?.codigo === undefined ? COLABORADORES : COLABORADORES.filter((c) => c.codigoColaborador === params.codigo)) as TRow[],
};

const passwordHash = PasswordService.hash("Senha@123");
const usuario = (id: string, fullname: string, status: User["status"], roleId = "r"): User => ({
  id,
  username: id,
  fullname,
  passwordHash,
  roleId,
  status,
  createdAt: new Date().toISOString(),
});

async function boot(permissions: string[] = [VIEW, UPDATE], erpClients: Record<string, ErpClient> = { inovafarma: erp }) {
  const userStore = new TestUserStore({
    roles: [{ id: "r", name: "R", permissions }, { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] }],
    users: [
      usuario("autor", "Autor Teste", "active"),
      usuario("auditor", "Auditor", "active", "audit"),
      usuario("ana", "Ana Souza", "active"),
      usuario("bia", "Bia Lima", "active"),
      usuario("caio", "Caio Inativo", "inactive"),
    ],
  });
  const platform = createPlatform({ userStore, erpClients });
  await platform.start();
  const login = async (username: string) => {
    const res = await platform.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "Senha@123" }),
    });
    const { accessToken } = (await res.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}` };
  };
  const headers = await login("autor");
  const salvar = (codigo: number | string, body: unknown) =>
    platform.app.request(`/api/m/inovafarma/colaboradores/${codigo}/vinculo`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const listar = async () => {
    const res = await platform.app.request("/api/m/inovafarma/colaboradores", { headers });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      colaboradores: { codigoColaborador: number; confirmado: boolean; usuarioId: string | null; version: number; usuario: Record<string, unknown> | null }[];
      usuarios: Record<string, unknown>[];
    };
  };
  const auditoria = async () => {
    const res = await platform.app.request("/api/audit?plugin=inovafarma", { headers: await login("auditor") });
    expect(res.status).toBe(200);
    return (await res.json()) as { action: string; actorId: string; targetType: string; targetId: string; attributes: unknown; summary: string }[];
  };
  return { platform, salvar, listar, auditoria };
}

describe("Vínculo do Colaborador com Usuário", () => {
  it("o Plugin depende de iam e audit", async () => {
    const { platform } = await boot();
    expect(platform.modules.find((m) => m.id === "inovafarma")?.dependsOn).toEqual(["iam", "audit"]);
  });

  it("lista Pendente sem vínculo e oferece só Usuários ativos, sem dados além dos expostos pelo iam", async () => {
    const { listar } = await boot();
    const { colaboradores, usuarios } = await listar();
    expect(colaboradores[0]).toEqual({ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, confirmado: false, usuarioId: null, usuario: null, version: 0 });
    expect(usuarios.map((u) => u.id)).toEqual(expect.arrayContaining(["ana", "bia"]));
    expect(usuarios.map((u) => u.id)).not.toContain("caio");
    expect(Object.keys(usuarios[0]!).sort()).toEqual(["fullname", "id", "username"]);
  });

  it("grava o vínculo, passa a Confirmado e altera com a nova version", async () => {
    const { salvar, listar } = await boot();
    const criado = await salvar(7, { usuarioId: "ana", version: 0 });
    expect(criado.status).toBe(200);
    expect(await criado.json()).toMatchObject({ codigoColaborador: 7, confirmado: true, usuarioId: "ana", version: 1 });
    expect((await listar()).colaboradores[0]).toMatchObject({
      confirmado: true,
      usuario: { id: "ana", fullname: "Ana Souza", username: "ana", status: "active" },
    });

    const alterado = await salvar(7, { usuarioId: "bia", version: 1 });
    expect(await alterado.json()).toMatchObject({ usuarioId: "bia", version: 2 });
  });

  it("limpar o Usuário desfaz o vínculo, devolve a Pendente e libera o Usuário", async () => {
    const { salvar, listar } = await boot();
    await salvar(7, { usuarioId: "ana", version: 0 });
    const limpo = await salvar(7, { usuarioId: null, version: 1 });
    expect(limpo.status).toBe(200);
    expect((await listar()).colaboradores[0]).toMatchObject({ confirmado: false, usuarioId: null, version: 0 });
    expect((await salvar(9, { usuarioId: "ana", version: 0 })).status).toBe(200);
  });

  it("nega a gravação sem a Permission, com deniedMessage em PT-BR", async () => {
    const { salvar } = await boot([VIEW]);
    const res = await salvar(7, { usuarioId: "ana", version: 0 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Acesso negado: o usuário não possui permissão para alterar os vínculos dos Colaboradores do InovaFarma." });
  });

  it("recusa com 409 o Usuário já vinculado a outro Colaborador", async () => {
    const { salvar } = await boot();
    await salvar(7, { usuarioId: "ana", version: 0 });
    const res = await salvar(9, { usuarioId: "ana", version: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Este Usuário já está vinculado a outro Colaborador." });
  });

  it("recusa com 409 a version desatualizada, com mensagem distinta", async () => {
    const { salvar } = await boot();
    await salvar(7, { usuarioId: "ana", version: 0 });
    const res = await salvar(7, { usuarioId: "bia", version: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "O vínculo foi alterado por outra pessoa. A linha foi recarregada." });
  });

  it("recusa Usuário inexistente ou inativo e Colaborador fora do ERP", async () => {
    const { salvar } = await boot();
    expect((await salvar(7, { usuarioId: "caio", version: 0 })).status).toBe(400);
    expect((await salvar(7, { usuarioId: "nao-existe", version: 0 })).status).toBe(400);
    expect((await salvar(7, { usuarioId: "ana" })).status).toBe(400);
    expect((await salvar("abc", { usuarioId: "ana", version: 0 })).status).toBe(400);
    expect((await salvar(123, { usuarioId: "ana", version: 0 })).status).toBe(404);
  });

  it("responde 503 sem conexão com o ERP", async () => {
    const { salvar } = await boot([VIEW, UPDATE], {});
    expect((await salvar(7, { usuarioId: "ana", version: 0 })).status).toBe(503);
  });

  it("grava no Audit Log cada alteração, com valores anteriores, novos e resumo", async () => {
    const { salvar, auditoria } = await boot();
    await salvar(7, { usuarioId: "ana", version: 0 });
    await salvar(7, { usuarioId: "bia", version: 1 });
    await salvar(7, { usuarioId: "bia", version: 2 }); // sem mudança: não é alteração
    await salvar(7, { usuarioId: null, version: 2 });

    const entradas = await auditoria();
    expect(entradas.map((e) => e.summary).sort()).toEqual([
      'Alterou o Usuário do Colaborador "ANA SOUZA" (cód. 7) de "Ana Souza" para "Bia Lima".',
      'Desfez o vínculo do Colaborador "ANA SOUZA" (cód. 7) com o Usuário "Bia Lima".',
      'Vinculou o Colaborador "ANA SOUZA" (cód. 7) ao Usuário "Ana Souza".',
    ]);
    const alteracao = entradas.find((e) => e.summary.startsWith("Alterou"));
    expect(alteracao).toMatchObject({
      action: "vinculo_update",
      actorId: "autor",
      targetType: "colaborador",
      targetId: "7",
      attributes: {
        codigoColaborador: 7,
        nomeColaborador: "ANA SOUZA",
        anterior: { usuario: { id: "ana", fullname: "Ana Souza" } },
        novo: { usuario: { id: "bia", fullname: "Bia Lima" } },
      },
    });
  });
});
