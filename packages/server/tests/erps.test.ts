import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { createPlatformApp } from "../src/index.js";
import { createLogger } from "../src/logger.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import type { ErpClientFactory } from "../src/erp/erp-factory.js";
import type { ErpClientRegistry } from "../src/erp/erp-client.js";
import { MemoryErpStore } from "../src/erp/erp-store.js";
import { assertReadOnlyQuery } from "../src/erp/read-only-guard.js";
import { decryptSecret } from "../src/erp/secret-box.js";
import type { ErpClient } from "../src/erp/erp-client.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

describe("assertReadOnlyQuery", () => {
  it("aceita SELECT e WITH, inclusive com comentários e literais", () => {
    expect(() => assertReadOnlyQuery("SELECT a FROM t WHERE x = @p1")).not.toThrow();
    expect(() => assertReadOnlyQuery("  -- c\n WITH x AS (SELECT 1 AS a) SELECT a FROM x;")).not.toThrow();
    expect(() => assertReadOnlyQuery("SELECT 'DELETE; DROP' AS txt, update_date FROM t")).not.toThrow();
  });

  it("recusa escrita, múltiplas instruções, exec e select into", () => {
    for (const q of [
      "DELETE FROM t",
      "SELECT 1; DROP TABLE t",
      "EXEC sp_who",
      "SELECT * INTO nova FROM t",
      "/* x */ UPDATE t SET a = 1",
      "SELECT 1 /* ok */; INSERT INTO t VALUES (1)",
    ]) {
      expect(() => assertReadOnlyQuery(q), q).toThrow();
    }
  });
});

describe("assertReadOnlyQuery: literais, comentários e identificadores na ordem do texto", () => {
  it("não deixa um '--' dentro de literal esconder instruções seguintes", () => {
    expect(() => assertReadOnlyQuery("SELECT '--'; DROP TABLE t; --'")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT '--' AS a, 'x'; DELETE FROM t; --'")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT '/*'; DROP TABLE t; --*/'")).toThrow();
  });

  it("não deixa aspas dentro de comentário abrir literal", () => {
    expect(() => assertReadOnlyQuery("SELECT 1 -- it's\n; DROP TABLE t")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT 1 /* ' */; DROP TABLE t; /* ' */")).toThrow();
  });

  it("trata comentários de bloco aninhados e literais com aspa duplicada", () => {
    expect(() => assertReadOnlyQuery("SELECT 1 /* a /* b */ ; DROP TABLE t */")).not.toThrow();
    expect(() => assertReadOnlyQuery("SELECT 1 /* a /* b */ */; DROP TABLE t")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT 'it''s; DROP' AS a")).not.toThrow();
    expect(() => assertReadOnlyQuery("SELECT 'it''s'; DROP TABLE t")).toThrow();
  });

  it("trata identificadores entre colchetes e aspas duplas", () => {
    expect(() => assertReadOnlyQuery("SELECT [delete], [a]]; drop] FROM t")).not.toThrow();
    expect(() => assertReadOnlyQuery('SELECT "update" FROM t')).not.toThrow();
    expect(() => assertReadOnlyQuery("SELECT [--] FROM t; DROP TABLE t; --]")).toThrow();
    expect(() => assertReadOnlyQuery("SELECT [a]; DROP TABLE t")).toThrow();
  });

  it("recusa construções sem fechamento que escondiam o resto", () => {
    expect(() => assertReadOnlyQuery("DROP TABLE t -- SELECT")).toThrow();
    expect(() => assertReadOnlyQuery("/* SELECT 1 */ DROP TABLE t")).toThrow();
  });
});

describe("ERPs (/api/admin/erps)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let erpStore: MemoryErpStore;
  const closed: string[] = [];

  const values = { host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" };
  const body = { name: "InovaFarma", driver: "mssql", values };

  async function tokenOf(username: string): Promise<string> {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    });
    return ((await res.json()) as { access_token: string }).access_token;
  }

  const send = (method: string, path: string, token: string, payload?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: payload ? JSON.stringify(payload) : undefined,
    });

  let auditLog: AuditLog;
  let registry: ErpClientRegistry;
  let factory: ErpClientFactory;

  const fake: ErpClient = {
    query: async () => [],
    healthCheck: async () => true,
    close: async () => {
      closed.push("closed");
    },
  };

  beforeEach(() => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", randomBytes(16).toString("hex"));
    erpStore = new MemoryErpStore();
    auditLog = new AuditLog(new MemoryAuditStore());
    registry = {};
    closed.length = 0;
    factory = () => fake;
    app = createPlatformApp({
      userStore: createSeededUserStore(),
      erpStore,
      erpClients: registry,
      auditLog,
      clientFactory: (record) => factory(record),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const entriesOf = () => auditLog.list({});

  it("salva com a senha cifrada e nunca a devolve", async () => {
    const token = await tokenOf("carlos.admin");
    const res = await send("PUT", "/api/admin/erps/inovafarma", token, body);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/Seg@1234|password/i);

    const stored = await erpStore.get("inovafarma");
    expect(stored!.secretsEncrypted).not.toContain("Seg@1234");
    expect(JSON.parse(decryptSecret(stored!.secretsEncrypted))).toEqual({ password: "Seg@1234" });
    expect(JSON.stringify(stored!.config)).not.toContain("Seg@1234");

    const list = await (await send("GET", "/api/admin/erps", token)).text();
    expect(list).not.toMatch(/Seg@1234|password/i);
  });

  it("mantém a senha ao atualizar sem informar uma nova", async () => {
    const token = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", token, body);
    const { password: _p, ...semSenha } = values;
    const res = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: { ...semSenha, host: "novo" } });
    expect(res.status).toBe(200);
    const stored = await erpStore.get("inovafarma");
    expect(stored!.config.host).toBe("novo");
    expect(JSON.parse(decryptSecret(stored!.secretsEncrypted))).toEqual({ password: "Seg@1234" });
    expect(closed).toHaveLength(1);
  });

  it("exige senha ao criar, valida o id, testa e exclui", async () => {
    const token = await tokenOf("carlos.admin");
    const { password: _p, ...semSenha } = values;
    expect((await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: semSenha })).status).toBe(400);
    expect((await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, driver: "oracle" })).status).toBe(400);
    expect((await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: { ...values, port: 99999 } })).status).toBe(400);
    expect((await send("PUT", "/api/admin/erps/Inova-Farma", token, body)).status).toBe(400);

    await send("PUT", "/api/admin/erps/inovafarma", token, body);
    expect((await send("POST", "/api/admin/erps/inovafarma/test", token)).status).toBe(200);
    expect((await send("DELETE", "/api/admin/erps/inovafarma", token)).status).toBe(200);
    expect(await erpStore.get("inovafarma")).toBeNull();
    expect((await send("POST", "/api/admin/erps/inovafarma/test", token)).status).toBe(404);
  });

  it("entrega o catálogo de ERP Drivers com os campos de cada um", async () => {
    const res = await send("GET", "/api/admin/erp-drivers", await tokenOf("carlos.admin"));
    const drivers = (await res.json()) as { id: string; label: string; fields: { name: string; type: string }[] }[];
    expect(drivers.map((t) => t.id).sort()).toEqual(["inovafarma", "mssql"]);
    const inovafarma = drivers.find((d) => d.id === "inovafarma")!;
    expect(inovafarma.label).toBe("InovaFarma");
    expect(inovafarma).not.toHaveProperty("externalFields");

    const mssql = drivers.find((d) => d.id === "mssql")!;
    expect(mssql.label).toBe("SQL Server");
    expect(mssql.fields.map((f) => f.name)).toEqual(["host", "port", "database", "username", "password", "trustServerCertificate"]);
    expect(mssql.fields.find((f) => f.name === "password")!.type).toBe("password");
  });

  it("não expõe mais as rotas de identificadores de ERP", async () => {
    const admin = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", admin, body);
    expect((await send("GET", "/api/admin/erp-externals/usr_1002", admin)).status).toBe(404);
    expect((await send("PUT", "/api/admin/erp-externals/usr_1002/inovafarma", admin, { values: {} })).status).toBe(404);
  });

  it("nega acesso a quem não tem system:erps:manage", async () => {
    const token = await tokenOf("joao.silva");
    expect((await send("PUT", "/api/admin/erps/inovafarma", token, body)).status).toBe(403);
    expect((await send("GET", "/api/admin/erps", token)).status).toBe(403);
  });

  it("registra salvar, testar e remover no Audit Log sem segredos nem valores do formulário", async () => {
    const token = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", token, body);
    await send("PUT", "/api/admin/erps/inovafarma", token, body);
    await send("POST", "/api/admin/erps/inovafarma/test", token);
    await send("DELETE", "/api/admin/erps/inovafarma", token);

    const entries = (await entriesOf()).filter((e) => e.plugin === "erp");
    expect(entries.map((e) => e.action).sort()).toEqual(["delete", "save", "save", "test"]);
    expect(entries.map((e) => e.attributes).filter((a) => "created" in a).map((a) => a.created).sort()).toEqual([false, true]);
    expect(entries.every((e) => e.targetType === "erp" && e.targetId === "inovafarma" && e.actorName)).toBe(true);
    expect(JSON.stringify(entries)).not.toMatch(/Seg@1234|password|"host"|"db"|ro"/);
    expect(entries.find((e) => e.action === "test")!.attributes).toMatchObject({ ok: true });
  });

  it("não grava nada no Audit Log quando a requisição é recusada", async () => {
    const token = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, driver: "oracle" });
    await send("DELETE", "/api/admin/erps/inexistente", token);
    expect((await entriesOf()).filter((e) => e.plugin === "erp")).toEqual([]);
  });

  it("mantém o ERP e o cliente antigo quando a fábrica do cliente novo falha", async () => {
    const token = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", token, body);
    const before = await erpStore.get("inovafarma");
    const old = registry.inovafarma;
    factory = () => {
      throw new Error("config inválida");
    };

    const res = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: { ...values, host: "outro" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { issues: [{ path: ["values"], message: "config inválida" }] } });
    expect(await erpStore.get("inovafarma")).toEqual(before);
    expect(registry.inovafarma).toBe(old);
    expect(closed).toHaveLength(0);
  });

  it("não resolve ids como membros do protótipo (constructor, toString)", async () => {
    const token = await tokenOf("carlos.admin");
    for (const id of ["constructor", "toString", "hasOwnProperty"]) {
      expect((await send("POST", `/api/admin/erps/${id}/test`, token)).status).toBe(404);
      expect((await send("DELETE", `/api/admin/erps/${id}`, token)).status).toBe(404);
    }
    expect(await send("PUT", "/api/admin/erps/constructor", token, body).then((r) => r.status)).toBe(200);
    expect(Object.hasOwn(registry, "constructor")).toBe(true);
  });

  it("recusa com ValidationErrorBody: id inválido, driver desconhecido, campo ausente e tipo errado", async () => {
    const token = await tokenOf("carlos.admin");
    const issues = async (res: Response) => ((await res.json()) as { error: { issues: { path: (string | number)[]; message: string }[] } }).error.issues;

    const badId = await send("PUT", "/api/admin/erps/Inova-Farma", token, body);
    expect(badId.status).toBe(400);
    expect((await issues(badId))[0]!.path).toEqual(["id"]);

    const badDriver = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, driver: "oracle" });
    expect(badDriver.status).toBe(400);
    expect((await issues(badDriver))[0]).toMatchObject({ path: ["driver"], message: "ERP Driver 'oracle' não suportado." });

    const { password: _p, ...semSenha } = values;
    const missing = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: semSenha });
    expect(missing.status).toBe(400);
    expect((await issues(missing))[0]).toMatchObject({ path: ["values", "password"] });

    const wrongType = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: { ...values, host: 42, trustServerCertificate: "sim" } });
    expect(wrongType.status).toBe(400);
    expect((await issues(wrongType)).map((i) => i.path.join(".")).sort()).toEqual(["values.host", "values.trustServerCertificate"]);

    const range = await send("PUT", "/api/admin/erps/inovafarma", token, { ...body, values: { ...values, port: 99999 } });
    expect((await issues(range))[0]!.path).toEqual(["values", "port"]);
  });
});

describe("tratamento de erros do servidor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responde 404 e 500 em JSON, sem vazar o detalhe da falha", async () => {
    vi.stubEnv("ERP_ENCRYPTION_KEY", randomBytes(16).toString("hex"));
    const logged: unknown[] = [];
    const store = new MemoryErpStore();
    store.list = async () => {
      throw new Error("detalhe interno com Seg@1234");
    };
    const app = createPlatformApp({
      userStore: createSeededUserStore(),
      erpStore: store,
      logger: createLogger({ level: "error", destination: { write: (line: string) => void logged.push(line) } }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "carlos.admin", password: TEST_PASSWORD }),
    });
    const token = ((await login.json()) as { access_token: string }).access_token;

    const missing = await app.request("/api/nao-existe");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Rota não encontrada." });

    const failing = await app.request("/api/admin/erps", { headers: { Authorization: `Bearer ${token}` } });
    expect(failing.status).toBe(500);
    expect(await failing.json()).toEqual({ error: "Erro interno do servidor." });
    expect(logged.join("")).toContain("detalhe interno");
  });
});

describe("logger", () => {
  it("redige segredos dos registros", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", destination: { write: (line: string) => void lines.push(line) } });
    logger.info({ password: "Seg@1234", secrets: { password: "x" }, req: { headers: { authorization: "Bearer abc" } } }, "teste");
    expect(lines.join("")).not.toMatch(/Seg@1234|Bearer abc|"x"/);
  });
});
