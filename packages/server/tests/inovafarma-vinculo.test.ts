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

const LOJAS = [
  { codigoEmpresa: 1, nome: " Centro " },
  { codigoEmpresa: 2, nome: "Bairro" },
  { codigoEmpresa: 3, nome: "Shopping" },
];

const erp: ErpClient = {
  query: async <TRow>(sql: string, params?: Record<string, unknown>) =>
    sql.includes("Config") ? (LOJAS as TRow[]) : (params?.codigo === undefined ? COLABORADORES : COLABORADORES.filter((c) => c.codigoColaborador === params.codigo)) as TRow[],
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

async function boot(permissions: string[] = [VIEW, UPDATE], erpClients: Record<string, ErpClient> = { inovafarma: erp }, extras: User[] = []) {
  const userStore = new TestUserStore({
    roles: [{ id: "r", name: "R", permissions }, { id: "audit", name: "Auditoria", permissions: ["system:audit:read"] }],
    users: [
      usuario("autor", "Autor Teste", "active"),
      usuario("auditor", "Auditor", "active", "audit"),
      usuario("ana", "Ana Souza", "active"),
      usuario("bia", "Bia Lima", "active"),
      usuario("caio", "Caio Inativo", "inactive"),
      ...extras,
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
      colaboradores: { codigoColaborador: number; confirmado: boolean; usuarioId: string | null; lojas: number[]; version: number; usuario: Record<string, unknown> | null; sugestao: { usuarioId: string | null; lojas: number[] } | null }[];
      usuarios: Record<string, unknown>[];
      lojas: unknown[];
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
    expect(colaboradores[0]).toEqual({ codigoColaborador: 7, nome: "ANA SOUZA", ativo: true, confirmado: false, usuarioId: null, usuario: null, lojas: [], version: 0, sugestao: { usuarioId: "ana", lojas: [] } });
    expect(usuarios.map((u) => u.id)).toEqual(expect.arrayContaining(["ana", "bia"]));
    expect(usuarios.map((u) => u.id)).not.toContain("caio");
    expect(Object.keys(usuarios[0]!).sort()).toEqual(["fullname", "id", "username"]);
  });

  it("grava o vínculo, passa a Confirmado e altera com a nova version", async () => {
    const { salvar, listar } = await boot();
    const criado = await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    expect(criado.status).toBe(200);
    expect(await criado.json()).toMatchObject({ codigoColaborador: 7, confirmado: true, usuarioId: "ana", version: 1 });
    expect((await listar()).colaboradores.find((c) => c.codigoColaborador === 7)).toMatchObject({
      confirmado: true,
      usuario: { id: "ana", fullname: "Ana Souza", username: "ana", status: "active" },
    });

    const alterado = await salvar(7, { usuarioId: "bia", lojas: [], version: 1 });
    expect(await alterado.json()).toMatchObject({ usuarioId: "bia", version: 2 });
  });

  it("limpar o Usuário desfaz o vínculo, devolve a Pendente e libera o Usuário", async () => {
    const { salvar, listar } = await boot();
    await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    const limpo = await salvar(7, { usuarioId: null, lojas: [], version: 1 });
    expect(limpo.status).toBe(200);
    expect((await listar()).colaboradores[0]).toMatchObject({ confirmado: false, usuarioId: null, version: 0 });
    expect((await salvar(9, { usuarioId: "ana", lojas: [], version: 0 })).status).toBe(200);
  });

  it("nega a gravação sem a Permission, com deniedMessage em PT-BR", async () => {
    const { salvar } = await boot([VIEW]);
    const res = await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Acesso negado: o usuário não possui permissão para alterar os vínculos dos Colaboradores do InovaFarma." });
  });

  it("recusa com 409 o Usuário já vinculado a outro Colaborador", async () => {
    const { salvar } = await boot();
    await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    const res = await salvar(9, { usuarioId: "ana", lojas: [], version: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Este Usuário já está vinculado a outro Colaborador." });
  });

  it("recusa com 409 a version desatualizada, com mensagem distinta", async () => {
    const { salvar } = await boot();
    await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    const res = await salvar(7, { usuarioId: "bia", lojas: [], version: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "O vínculo foi alterado por outra pessoa. A linha foi recarregada." });
  });

  it("recusa Usuário inexistente ou inativo e Colaborador fora do ERP", async () => {
    const { salvar } = await boot();
    expect((await salvar(7, { usuarioId: "caio", lojas: [], version: 0 })).status).toBe(400);
    expect((await salvar(7, { usuarioId: "nao-existe", lojas: [], version: 0 })).status).toBe(400);
    expect((await salvar(7, { usuarioId: "ana", lojas: [] })).status).toBe(400);
    expect((await salvar("abc", { usuarioId: "ana", lojas: [], version: 0 })).status).toBe(400);
    expect((await salvar(123, { usuarioId: "ana", lojas: [], version: 0 })).status).toBe(404);
  });

  it("responde 503 sem conexão com o ERP", async () => {
    const { salvar } = await boot([VIEW, UPDATE], {});
    expect((await salvar(7, { usuarioId: "ana", lojas: [], version: 0 })).status).toBe(503);
  });

  it("grava no Audit Log cada alteração, com valores anteriores, novos e resumo", async () => {
    const { salvar, auditoria } = await boot();
    await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    await salvar(7, { usuarioId: "bia", lojas: [], version: 1 });
    await salvar(7, { usuarioId: "bia", lojas: [], version: 2 }); // sem mudança: não é alteração
    await salvar(7, { usuarioId: null, lojas: [], version: 2 });

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

  describe("Lojas", () => {
    it("oferece as Lojas do ERP e devolve as gravadas na listagem", async () => {
      const { salvar, listar } = await boot();
      const res = await salvar(7, { usuarioId: "ana", lojas: [2, 1], version: 0 });
      expect(await res.json()).toMatchObject({ confirmado: true, usuarioId: "ana", lojas: [1, 2], version: 1 });
      const lista = await listar();
      expect(lista.lojas).toEqual([
        { codigo: 1, nome: "Centro" },
        { codigo: 2, nome: "Bairro" },
        { codigo: 3, nome: "Shopping" },
      ]);
      expect(lista.colaboradores.find((c) => c.codigoColaborador === 7)).toMatchObject({ lojas: [1, 2] });
    });

    it("grava só as Lojas, sem Usuário, e o Usuário continua livre", async () => {
      const { salvar, listar } = await boot();
      const res = await salvar(7, { usuarioId: null, lojas: [3], version: 0 });
      expect(res.status).toBe(200);
      expect((await listar()).colaboradores.find((c) => c.codigoColaborador === 7)).toMatchObject({ confirmado: true, usuarioId: null, usuario: null, lojas: [3], version: 1 });
      expect((await salvar(9, { usuarioId: "ana", lojas: [], version: 0 })).status).toBe(200);
    });

    it("Usuário e Lojas são independentes: limpar um mantém o outro", async () => {
      const { salvar } = await boot();
      await salvar(7, { usuarioId: "ana", lojas: [1], version: 0 });
      expect(await (await salvar(7, { usuarioId: null, lojas: [1], version: 1 })).json()).toMatchObject({ confirmado: true, usuarioId: null, lojas: [1], version: 2 });
      expect(await (await salvar(7, { usuarioId: "bia", lojas: [], version: 2 })).json()).toMatchObject({ confirmado: true, usuarioId: "bia", lojas: [], version: 3 });
    });

    it("limpar Usuário e Lojas desfaz o vínculo e devolve a Pendente", async () => {
      const { salvar, listar } = await boot();
      await salvar(7, { usuarioId: "ana", lojas: [1, 2], version: 0 });
      expect(await (await salvar(7, { usuarioId: null, lojas: [], version: 1 })).json()).toMatchObject({ confirmado: false, usuarioId: null, lojas: [], version: 0 });
      expect((await listar()).colaboradores[0]).toMatchObject({ confirmado: false, lojas: [], version: 0 });
    });

    it("sem vínculo gravado, Usuário e Lojas vazios não criam vínculo", async () => {
      const { salvar, auditoria } = await boot();
      expect(await (await salvar(7, { usuarioId: null, lojas: [], version: 0 })).json()).toMatchObject({ confirmado: false, version: 0 });
      expect(await auditoria()).toEqual([]);
    });

    it("recusa Loja fora do ERP e corpo sem lojas, mas mantém uma Loja já gravada que saiu do ERP", async () => {
      const { salvar } = await boot();
      expect((await salvar(7, { usuarioId: "ana", lojas: [99], version: 0 })).status).toBe(400);
      expect((await salvar(7, { usuarioId: "ana", version: 0 })).status).toBe(400);

      const saiu = LOJAS[2]!;
      try {
        await salvar(7, { usuarioId: "ana", lojas: [saiu.codigoEmpresa], version: 0 });
        LOJAS.pop();
        const res = await salvar(7, { usuarioId: "bia", lojas: [saiu.codigoEmpresa, 1], version: 1 });
        expect(await res.json()).toMatchObject({ usuarioId: "bia", lojas: [1, 3], version: 2 });
      } finally {
        LOJAS.push(saiu);
      }
    });

    it("responde 503 quando as Lojas não podem ser lidas do ERP, sem esconder a falha", async () => {
      const semLojas: ErpClient = {
        query: async <TRow>(sql: string) => {
          if (sql.includes("Config")) throw new Error("fora do ar");
          return COLABORADORES as TRow[];
        },
      };
      const { salvar } = await boot([VIEW, UPDATE], { inovafarma: semLojas });
      expect((await salvar(7, { usuarioId: "ana", lojas: [1], version: 0 })).status).toBe(503);
    });

    it("registra no Audit Log as Lojas anteriores e novas, com nome e resumo", async () => {
      const { salvar, auditoria } = await boot();
      await salvar(7, { usuarioId: "ana", lojas: [1], version: 0 });
      await salvar(7, { usuarioId: "ana", lojas: [2, 3], version: 1 });
      await salvar(7, { usuarioId: "ana", lojas: [3, 2], version: 2 }); // mesma escolha: não é alteração
      await salvar(7, { usuarioId: null, lojas: [], version: 2 });

      const entradas = await auditoria();
      expect(entradas).toHaveLength(3);
      const alteracao = entradas.find((e) => e.summary.startsWith("Alterou"));
      expect(alteracao?.summary).toBe('Alterou as Lojas do Colaborador "ANA SOUZA" (cód. 7) de "Centro" para "Bairro", "Shopping".');
      expect(alteracao?.attributes).toMatchObject({
        anterior: { usuario: { id: "ana" }, lojas: [{ codigo: 1, nome: "Centro" }] },
        novo: { usuario: { id: "ana" }, lojas: [{ codigo: 2, nome: "Bairro" }, { codigo: 3, nome: "Shopping" }] },
      });
      expect(entradas.map((e) => e.summary)).toEqual(
        expect.arrayContaining([
          'Vinculou o Colaborador "ANA SOUZA" (cód. 7) ao Usuário "Ana Souza" e às Lojas "Centro".',
          'Desfez o vínculo do Colaborador "ANA SOUZA" (cód. 7) com o Usuário "Ana Souza" e as Lojas "Bairro", "Shopping".',
        ]),
      );
    });

    it("no resumo, alterar Usuário e Lojas juntos cita os dois", async () => {
      const { salvar, auditoria } = await boot();
      await salvar(7, { usuarioId: "ana", lojas: [1], version: 0 });
      await salvar(7, { usuarioId: "bia", lojas: [], version: 1 });
      expect((await auditoria()).map((e) => e.summary)).toContain(
        'Alterou o Usuário do Colaborador "ANA SOUZA" (cód. 7) de "Ana Souza" para "Bia Lima" e as Lojas de "Centro" para nenhuma.',
      );
    });
  });
});

describe("Sugestões do Vínculo do Colaborador", () => {
  const erpCom = (colaboradores: Record<string, unknown>[]): Record<string, ErpClient> => ({
    inovafarma: {
      query: async <TRow>(sql: string, params?: Record<string, unknown>) =>
        (sql.includes("Config") ? LOJAS : params?.codigo === undefined ? colaboradores : colaboradores.filter((c) => c.codigoColaborador === params.codigo)) as TRow[],
    },
  });
  const colaborador = (codigoColaborador: number, nome: string, codigoEmpresa: number | null = null) => ({ codigoColaborador, nome, ativo: true, codigoEmpresa });
  const sugestaoDe = async (nome: string, extras: User[] = []) => {
    const { listar } = await boot([VIEW, UPDATE], erpCom([colaborador(7, nome)]), extras);
    return (await listar()).colaboradores[0]!.sugestao!.usuarioId;
  };

  it("sugere a Loja de Cadastro.CodigoEmpresa", async () => {
    const { listar } = await boot([VIEW, UPDATE], erpCom([colaborador(7, "SEM PAR", 2)]));
    expect((await listar()).colaboradores[0]!.sugestao).toEqual({ usuarioId: null, lojas: [2] });
  });

  it("não sugere uma Loja que não existe entre as do ERP", async () => {
    const { listar } = await boot([VIEW, UPDATE], erpCom([colaborador(7, "SEM PAR", 99)]));
    expect((await listar()).colaboradores[0]!.sugestao).toEqual({ usuarioId: null, lojas: [] });
  });

  it("ignora acentos e maiúsculas ao comparar os nomes", async () => {
    expect(await sugestaoDe("JOSÉ ANTÔNIO", [usuario("jose", "Jose Antonio", "active")])).toBe("jose");
    expect(await sugestaoDe("JOSE ANTONIO", [usuario("jose", "josé antônio", "active")])).toBe("jose");
  });

  it("aceita um nome contido no outro, com o mesmo primeiro nome", async () => {
    expect(await sugestaoDe("MARIA DE FATIMA COSTA", [usuario("maria", "Maria Costa", "active")])).toBe("maria");
  });

  it("não sugere por um único nome em comum nem com primeiro nome diferente", async () => {
    expect(await sugestaoDe("BRUNO LIMA")).toBeNull();
    expect(await sugestaoDe("MARIA COSTA", [usuario("maria", "Maria", "active")])).toBeNull();
  });

  it("deixa vazio no empate entre dois Usuários", async () => {
    expect(await sugestaoDe("ANA SOUZA", [usuario("ana2", "Ána Souza", "active")])).toBeNull();
    expect(await sugestaoDe("MARIA COSTA SILVA", [usuario("m1", "Maria Costa", "active"), usuario("m2", "Maria Silva", "active")])).toBeNull();
  });

  it("o nome idêntico vence um nome apenas contido", async () => {
    expect(await sugestaoDe("ANA SOUZA LIMA", [usuario("exato", "Ana Souza Lima", "active"), usuario("parcial", "Ana Lima", "active")])).toBe("exato");
  });

  it("deixa vazio quando o mesmo Usuário serviria a dois Colaboradores", async () => {
    const { listar } = await boot([VIEW, UPDATE], erpCom([colaborador(7, "ANA SOUZA"), colaborador(8, "ANA SOUZA")]));
    expect((await listar()).colaboradores.map((c) => c.sugestao!.usuarioId)).toEqual([null, null]);
  });

  it("considera só Usuários ativos", async () => {
    expect(await sugestaoDe("CAIO INATIVO")).toBeNull();
  });

  it("não sugere Usuário já vinculado, e a linha confirmada não traz sugestão", async () => {
    const { salvar, listar } = await boot([VIEW, UPDATE], erpCom([colaborador(7, "ANA MARIA"), colaborador(8, "ANA SOUZA", 2)]));
    await salvar(7, { usuarioId: "ana", lojas: [], version: 0 });
    const { colaboradores } = await listar();
    expect(colaboradores.find((c) => c.codigoColaborador === 7)!.sugestao).toBeNull();
    expect(colaboradores.find((c) => c.codigoColaborador === 8)!.sugestao).toEqual({ usuarioId: null, lojas: [2] });
  });

  it("carregar a lista não grava nem audita nada", async () => {
    const { listar, auditoria } = await boot([VIEW, UPDATE], erpCom([colaborador(7, "ANA SOUZA", 1)]));
    await listar();
    const { colaboradores } = await listar();
    expect(colaboradores[0]).toMatchObject({ confirmado: false, usuarioId: null, lojas: [], version: 0 });
    expect(await auditoria()).toEqual([]);
  });

  it("lista os pendentes primeiro, mantendo a ordem do ERP em cada grupo", async () => {
    const { salvar, listar } = await boot([VIEW, UPDATE], erpCom([colaborador(1, "ALFA"), colaborador(2, "BETA"), colaborador(3, "GAMA")]));
    await salvar(1, { usuarioId: null, lojas: [1], version: 0 });
    expect((await listar()).colaboradores.map((c) => c.codigoColaborador)).toEqual([2, 3, 1]);
  });
});
