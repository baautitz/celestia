import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createPlatformApp } from "../src/index.js";
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

  beforeEach(() => {
    process.env.ERP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    erpStore = new MemoryErpStore();
    closed.length = 0;
    const fake: ErpClient = {
      query: async () => [],
      healthCheck: async () => true,
      close: async () => {
        closed.push("closed");
      },
    };
    app = createPlatformApp({
      userStore: createSeededUserStore(),
      erpStore,
      clientFactory: () => fake,
    });
  });

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
    const drivers = (await res.json()) as { id: string; fields: { name: string; type: string }[] }[];
    expect(drivers.map((t) => t.id)).toEqual(["mssql"]);
    expect(drivers[0]!.fields.map((f) => f.name)).toEqual(["host", "port", "database", "username", "password", "trustServerCertificate"]);
    expect(drivers[0]!.fields.find((f) => f.name === "password")!.type).toBe("password");
  });

  it("lista só id e nome dos ERPs para quem gerencia usuários", async () => {
    const admin = await tokenOf("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", admin, body);
    const res = await send("GET", "/api/iam/erps", admin);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "inovafarma", name: "InovaFarma" }]);
    expect((await send("GET", "/api/iam/erps", await tokenOf("joao.silva"))).status).toBe(403);
  });

  it("nega acesso a quem não tem system:erps:manage", async () => {
    const token = await tokenOf("joao.silva");
    expect((await send("PUT", "/api/admin/erps/inovafarma", token, body)).status).toBe(403);
    expect((await send("GET", "/api/admin/erps", token)).status).toBe(403);
  });
});
