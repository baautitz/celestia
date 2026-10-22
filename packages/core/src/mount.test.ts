import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { loadModules } from "./loader.js";
import { defineModule, type ModuleDef } from "./module.js";
import { definePermissions } from "./permissions.js";

const quiet = { info() {}, warn() {}, error() {} };
const withPrefix = (id: string, prefix: string, register: ModuleDef["register"] = () => {}) =>
  defineModule({ id, version: "1.0.0", prefix, register });

describe("prefixo de montagem", () => {
  it("módulo com prefix /api responde nas URLs esperadas", async () => {
    const app = new Hono();
    await loadModules(app, [withPrefix("alfa", "/api", (c) => { c.routes.get("/users", (x) => x.text("ok")); })], { logger: quiet });
    expect(await (await app.request("/api/users")).text()).toBe("ok");
    expect((await app.request("/api/m/alfa/users")).status).toBe(404);
  });

  it("colisão de prefixo derruba o boot nomeando os dois módulos, sem registrar nada", async () => {
    let called = false;
    const reg: ModuleDef["register"] = () => void (called = true);
    await expect(
      loadModules(new Hono(), [withPrefix("alfa", "/api", reg), withPrefix("beta", "/api/", reg)], { logger: quiet }),
    ).rejects.toThrow(/"alfa".*"beta"|"beta".*"alfa"/);
    expect(called).toBe(false);
  });

  it("prefixo inválido é rejeitado", () => {
    expect(() => withPrefix("a", "api")).toThrow(/prefix/i);
  });
});

describe("catálogo agregado", () => {
  it("qualquer módulo lê o catálogo e todas as chaves", async () => {
    let keys: string[] = [];
    let mods: string[] = [];
    const a = defineModule({
      id: "a",
      version: "1.0.0",
      permissions: definePermissions("a", { "r:read": "Ler" }),
      register() {},
    });
    const b = defineModule({
      id: "b",
      version: "1.0.0",
      dependsOn: ["a"],
      register(ctx) {
        keys = [...ctx.permissions.allKeys()];
        mods = ctx.permissions.catalog().map((c) => c.module);
      },
    });
    await loadModules(new Hono(), [a, b], { logger: quiet });
    expect(keys).toEqual(["a:r:read"]);
    expect(mods).toContain("a");
  });
});
