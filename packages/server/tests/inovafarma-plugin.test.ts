import { describe, it, expect } from "vitest";
import { createPlatform } from "../src/index.js";
import { integrationPlugins, integrationExternalFields } from "../src/plugins.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { PasswordService } from "../src/iam/password-service.js";

async function boot(permissions: string[]) {
  const userStore = new MemoryUserStore({
    roles: [{ id: "r", name: "R", permissions }],
    users: [
      {
        id: "u",
        username: "ana",
        fullname: "Ana",
        passwordHash: PasswordService.hash("Senha@123"),
        roleId: "r",
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  const platform = createPlatform({ userStore });
  await platform.start();
  const login = await platform.app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: "Senha@123" }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  return { platform, headers: { authorization: `Bearer ${accessToken}` } };
}

describe("Plugin InovaFarma (/integrations/inovafarma)", () => {
  it("está na lista estática de Modules como Plugin", () => {
    const entries = integrationPlugins({ auth: async (_c, next) => next() });
    expect(entries.some((e) => e.tier === "plugin" && e.def.id === "inovafarma")).toBe(true);
  });

  it("declara externals para o ERP inovafarma", () => {
    const fields = integrationExternalFields();
    expect(fields.inovafarma).toBeDefined();
    expect(fields.inovafarma!.map((f) => f.name)).toEqual(["codigoColaborador", "codigoLoja"]);
  });

  it("serve a rota /status com a Permission e nega sem ela", async () => {
    const allowed = await boot(["inovafarma:integration:view"]);
    const ok = await allowed.platform.app.request("/api/m/inovafarma/status", { headers: allowed.headers });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      module: "inovafarma",
      erpId: "inovafarma",
      externals: expect.arrayContaining([
        expect.objectContaining({ name: "codigoColaborador" }),
        expect.objectContaining({ name: "codigoLoja" }),
      ]),
    });

    const denied = await boot([]);
    expect((await denied.platform.app.request("/api/m/inovafarma/status", { headers: denied.headers })).status).toBe(403);
    expect((await denied.platform.app.request("/api/m/inovafarma/status")).status).toBe(401);
  });
});
