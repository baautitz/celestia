import { describe, it, expect } from "vitest";
import { createPlatform } from "../src/index.js";
import { integrationPlugins } from "../src/plugins.js";
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

describe("Plugin de exemplo (/integrations/example)", () => {
  it("está na lista estática de Modules como Plugin", () => {
    const entries = integrationPlugins({ auth: async (_c, next) => next() });
    expect(entries.some((e) => e.tier === "plugin" && e.def.id === "example")).toBe(true);
  });

  it("serve a rota com a Permission e nega sem ela", async () => {
    const allowed = await boot(["example:note:read"]);
    const ok = await allowed.platform.app.request("/api/m/example/hello", { headers: allowed.headers });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ message: "Olá do Plugin de exemplo." });

    const denied = await boot([]);
    expect((await denied.platform.app.request("/api/m/example/hello", { headers: denied.headers })).status).toBe(403);
    expect((await denied.platform.app.request("/api/m/example/hello")).status).toBe(401);
  });

  it("registra a Permission e a migration no Module", async () => {
    const { platform } = await boot([]);
    const example = platform.modules.find((m) => m.id === "example");
    expect(example?.permissions?.items.map((p) => p.key)).toEqual(["example:note:read"]);
    expect(example?.migrations?.schema).toBe("example");
  });
});
