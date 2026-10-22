import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { definePermissions, PermissionRegistry } from "@platform/core/permissions";
import { composeModules, migrationPlan } from "../src/boot/compose.js";
import { createPlatformApp } from "../src/index.js";
import { MemoryUserStore } from "../src/iam/user-store.js";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

const okPlugin = (id: string): ModuleDef =>
  defineModule({
    id,
    version: "1.0.0",
    permissions: definePermissions(id, { "thing:read": "Ler" }),
    register({ routes }) {
      routes.get("/ping", (c) => c.json({ id }));
    },
  });

const failingPlugin = (id: string): ModuleDef =>
  defineModule({
    id,
    version: "1.0.0",
    permissions: definePermissions(id, { "thing:read": "Ler" }),
    register({ routes }) {
      routes.get("/ping", (c) => c.json({ id }));
      throw new Error("boom");
    },
  });

describe("composeModules", () => {
  it("monta os Modules e poda órfãs com as chaves do registro quando tudo carrega", async () => {
    const app = new Hono();
    const prune = vi.fn(async () => {});
    const registry = new PermissionRegistry();
    const result = await composeModules(app, [{ tier: "plugin", def: okPlugin("alpha") }], { registry, logger: quiet, prune });
    expect(result.pruned).toBe(true);
    expect(prune).toHaveBeenCalledWith(new Set(["alpha:thing:read"]));
    expect((await app.request("/api/m/alpha/ping")).status).toBe(200);
  });

  it("Plugin que falha: sem rotas, mantém Permissions, não poda e o resto sobe", async () => {
    const app = new Hono();
    const prune = vi.fn(async () => {});
    const registry = new PermissionRegistry();
    const result = await composeModules(
      app,
      [
        { tier: "plugin", def: failingPlugin("bad") },
        { tier: "plugin", def: okPlugin("good") },
      ],
      { registry, logger: quiet, prune },
    );
    expect(result.pruned).toBe(false);
    expect(prune).not.toHaveBeenCalled();
    expect(result.failed.map((f) => f.moduleId)).toEqual(["bad"]);
    expect((await app.request("/api/m/bad/ping")).status).toBe(404);
    expect((await app.request("/api/m/good/ping")).status).toBe(200);
    expect(registry.allKeys().has("bad:thing:read")).toBe(true);
  });

  it("falha de Module do Base System aborta o boot nomeando o Module", async () => {
    const prune = vi.fn(async () => {});
    await expect(
      composeModules(new Hono(), [{ tier: "base", def: failingPlugin("core_iam") }], {
        registry: new PermissionRegistry(),
        logger: quiet,
        prune,
      }),
    ).rejects.toThrow(/core_iam/);
    expect(prune).not.toHaveBeenCalled();
  });
});

describe("migrationPlan", () => {
  it("lista os Modules com migrations, pelo id do Module", () => {
    const withMig = defineModule({ id: "m1", version: "1.0.0", migrations: { folder: "/x" }, register() {} });
    expect(migrationPlan([okPlugin("a"), withMig])).toEqual([{ moduleId: "m1", folder: "/x", schema: undefined }]);
  });
});

describe("createPlatformApp com Plugin que falha", () => {
  it("não derruba as rotas do resto nem poda as Permissions das roles", async () => {
    const userStore = new MemoryUserStore({
      roles: [{ id: "r", name: "R", description: "", permissions: ["bad:thing:read", "obsolete:key"] }],
    });
    const app = createPlatformApp({ userStore, extraModules: [{ tier: "plugin", def: failingPlugin("bad") }] });
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/closing-periods")).status).toBe(401);
    expect((await userStore.getRole("r"))?.permissions).toContain("obsolete:key");
  });
});
