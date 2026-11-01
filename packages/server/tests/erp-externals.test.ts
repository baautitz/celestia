import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import { createPlatformApp } from "../src/index.js";
import { MemoryErpStore } from "../src/erp/erp-store.js";
import { MemoryErpExternalsStore } from "../src/erp/erp-externals-store.js";
import type { ErpClient } from "../src/erp/erp-client.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

describe("Externals declarados pelo Plugin erp (/api/admin/erp-externals)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let token: string;

  const send = (method: string, path: string, payload?: unknown, tk = token) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
      body: payload ? JSON.stringify(payload) : undefined,
    });

  const loginRaw = (username: string) =>
    app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    });

  const login = async (username: string): Promise<string> =>
    ((await (await loginRaw(username)).json()) as { access_token: string }).access_token;

  beforeEach(async () => {
    process.env.ERP_ENCRYPTION_KEY = randomBytes(16).toString("hex");
    const fake: ErpClient = { query: async () => [] };
    app = createPlatformApp({
      userStore: createSeededUserStore(),
      erpStore: new MemoryErpStore(),
      erpExternalsStore: new MemoryErpExternalsStore(),
      clientFactory: () => fake,
    });
    token = await login("carlos.admin");
    await send("PUT", "/api/admin/erps/inovafarma", {
      name: "InovaFarma",
      driver: "mssql",
      values: { host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" },
    });
  });

  it("lista, por ERP, os campos que o Plugin declara e os valores do usuário", async () => {
    const res = await send("GET", "/api/admin/erp-externals/usr_x");
    expect(res.status).toBe(200);
    const [entry] = (await res.json()) as { erpId: string; fields: { name: string }[]; values: object }[];
    expect(entry!.erpId).toBe("inovafarma");
    expect(entry!.fields.map((f) => f.name)).toEqual(["codigoColaborador", "codigoLoja"]);
    expect(entry!.values).toEqual({});
  });

  it("grava e devolve os valores por ERP", async () => {
    const put = await send("PUT", "/api/admin/erp-externals/usr_x/inovafarma", { values: { codigoColaborador: "42", codigoLoja: "1" } });
    expect(put.status).toBe(200);
    const [entry] = (await (await send("GET", "/api/admin/erp-externals/usr_x")).json()) as { values: object }[];
    expect(entry!.values).toEqual({ codigoColaborador: "42", codigoLoja: "1" });
  });

  it("rejeita valores fora do que o Plugin declara", async () => {
    const res = await send("PUT", "/api/admin/erp-externals/usr_x/inovafarma", { values: { naoDeclarado: "1" } });
    expect(res.status).toBe(400);
  });

  it("rejeita ERP inexistente", async () => {
    const res = await send("PUT", "/api/admin/erp-externals/usr_x/sap", { values: {} });
    expect(res.status).toBe(404);
  });

  it("remover o ERP apaga seus Externals", async () => {
    await send("PUT", "/api/admin/erp-externals/usr_x/inovafarma", { values: { codigoColaborador: "42" } });
    await send("DELETE", "/api/admin/erps/inovafarma");
    await send("PUT", "/api/admin/erps/inovafarma", {
      name: "InovaFarma",
      driver: "mssql",
      values: { host: "db", port: 1433, database: "erp", username: "ro", password: "Seg@1234" },
    });
    const [entry] = (await (await send("GET", "/api/admin/erp-externals/usr_x")).json()) as { values: object }[];
    expect(entry!.values).toEqual({});
  });

  it("o token e o User do core não carregam Externals", async () => {
    expect(JSON.stringify(await (await loginRaw("carlos.admin")).json()).toLowerCase()).not.toContain("external");
    const users = await send("GET", "/api/iam/users");
    expect(JSON.stringify(await users.json()).toLowerCase()).not.toContain("external");
  });
});
