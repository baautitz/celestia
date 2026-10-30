import { describe, it, expect } from "vitest";
import { defineModule } from "@platform/core/module";
import { definePermissions } from "@platform/core/permissions";
import { createPlatformApp } from "../src/index.js";
import { PasswordService } from "../src/iam/password-service.js";
import { TEST_PASSWORD, TestUserStore } from "./helpers/fixtures.js";

const extra = defineModule({
  id: "vendas",
  version: "1.0.0",
  prefix: "/vendas-api",
  permissions: definePermissions("vendas", { "meta:read": "Ler meta" }),
  register({ routes }) {
    routes.get("/ping", (c) => c.json({ ok: true }));
  },
});
const implicit = defineModule({
  id: "implicito",
  version: "1.0.0",
  register({ routes }) {
    routes.get("/ping", (c) => c.json({ ok: true }));
  },
});

function boot() {
  const userStore = new TestUserStore({
    roles: [{ id: "r", name: "R", permissions: [] }],
    users: [
      { id: "u1", username: "chefe", fullname: "x", passwordHash: PasswordService.hash(TEST_PASSWORD), roleId: "r", status: "active", createdAt: new Date().toISOString() },
    ],
  });
  return { userStore, app: createPlatformApp({ userStore, extraModules: [{ tier: "plugin", def: extra }, { tier: "plugin", def: implicit }] }) };
}

describe("Plugins com prefixo próprio", () => {
  it("alcança as rotas de um Plugin montado em qualquer prefixo", async () => {
    const { app } = boot();
    expect(await (await app.request("/vendas-api/ping")).json()).toEqual({ ok: true });
    expect(await (await app.request("/api/m/implicito/ping")).json()).toEqual({ ok: true });
    expect((await app.request("/vendas-api/nada")).status).toBe(404);
  });

  it("o bypass do admin cobre as Permissions do registro, inclusive as de Plugins extras", async () => {
    const { app, userStore } = boot();
    await userStore.setAdmin("u1", true);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "chefe", password: TEST_PASSWORD }),
    });
    const body = (await res.json()) as { user: { permissions: string[] } };
    expect(body.user.permissions).toContain("vendas:meta:read");
    expect(body.user.permissions).toContain("system:users:create");
    expect(body.user.permissions).toContain("*");
  });
});
