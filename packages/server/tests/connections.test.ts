import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createPlatformApp } from "../src/index.js";
import { MemoryConnectionStore } from "../src/data/connection-store.js";
import { assertReadOnlyQuery } from "../src/data/read-only-guard.js";
import { decryptSecret } from "../src/data/secret-box.js";
import type { SourceConnector } from "../src/data/source-connector.js";
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

describe("Conexões com fontes de dados (/api/admin/connections)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let connectionStore: MemoryConnectionStore;
  const closed: string[] = [];

  const body = { name: "InovaFarma", type: "mssql", host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" };

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

  beforeEach(() => {
    process.env.CONNECTIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    connectionStore = new MemoryConnectionStore();
    closed.length = 0;
    const fake: SourceConnector = {
      query: async () => [],
      healthCheck: async () => true,
      close: async () => {
        closed.push("closed");
      },
    };
    app = createPlatformApp({
      userStore: createSeededUserStore(),
      connectionStore,
      connectorFactory: () => fake,
    });
  });

  it("salva com a senha cifrada e nunca a devolve", async () => {
    const token = await tokenOf("carlos.admin");
    const res = await send("PUT", "/api/admin/connections/inovafarma", token, body);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/Seg@1234|password/i);

    const stored = await connectionStore.get("inovafarma");
    expect(stored!.passwordEncrypted).not.toContain("Seg@1234");
    expect(decryptSecret(stored!.passwordEncrypted)).toBe("Seg@1234");

    const list = await (await send("GET", "/api/admin/connections", token)).text();
    expect(list).not.toMatch(/Seg@1234|password/i);
  });

  it("mantém a senha ao atualizar sem informar uma nova", async () => {
    const token = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/connections/inovafarma", token, body);
    const { password: _p, ...semSenha } = body;
    const res = await send("PUT", "/api/admin/connections/inovafarma", token, { ...semSenha, host: "novo" });
    expect(res.status).toBe(200);
    const stored = await connectionStore.get("inovafarma");
    expect(stored!.host).toBe("novo");
    expect(decryptSecret(stored!.passwordEncrypted)).toBe("Seg@1234");
    expect(closed).toHaveLength(1);
  });

  it("exige senha ao criar, valida o id, testa e exclui", async () => {
    const token = await tokenOf("carlos.admin");
    const { password: _p, ...semSenha } = body;
    expect((await send("PUT", "/api/admin/connections/inovafarma", token, semSenha)).status).toBe(400);
    expect((await send("PUT", "/api/admin/connections/Inova-Farma", token, body)).status).toBe(400);

    await send("PUT", "/api/admin/connections/inovafarma", token, body);
    expect((await send("POST", "/api/admin/connections/inovafarma/test", token)).status).toBe(200);
    expect((await send("DELETE", "/api/admin/connections/inovafarma", token)).status).toBe(200);
    expect(await connectionStore.get("inovafarma")).toBeNull();
    expect((await send("POST", "/api/admin/connections/inovafarma/test", token)).status).toBe(404);
  });

  it("lista só id e nome das fontes para quem gerencia usuários", async () => {
    const admin = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/connections/inovafarma", admin, body);
    const res = await send("GET", "/api/iam/sources", admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "inovafarma", name: "InovaFarma" }]);
    expect((await send("GET", "/api/iam/sources", await tokenOf("joao.silva"))).status).toBe(403);
  });

  it("nega acesso a quem não tem system:sources:manage", async () => {
    const token = await tokenOf("joao.silva");
    expect((await send("PUT", "/api/admin/connections/inovafarma", token, body)).status).toBe(403);
    expect((await send("GET", "/api/admin/connections", token)).status).toBe(403);
  });
});
