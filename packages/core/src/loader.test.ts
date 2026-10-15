import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { loadModules } from "./loader.js";
import { defineModule, type ModuleDef } from "./module.js";
import { definePermissions } from "./permissions.js";

const quiet = { info() {}, warn() {}, error() {} };
const mod = (id: string, dependsOn: string[] = [], register: ModuleDef["register"] = () => {}) =>
  defineModule({ id, version: "1.0.0", dependsOn, register });

describe("defineModule", () => {
  it("valida id e versão", () => {
    expect(() => mod("Bad-Id")).toThrow(/inválido/);
    expect(() => defineModule({ id: "a", version: "x", register() {} })).toThrow(/semver/);
  });
});

describe("loadModules", () => {
  it("ordena por dependência e monta rotas em /api/m/<id>", async () => {
    const order: string[] = [];
    const reg = (id: string): ModuleDef["register"] => (ctx) => {
      order.push(id);
      ctx.routes.get("/ping", (c) => c.text(id));
    };
    const app = new Hono();
    const r = await loadModules(app, [mod("b", ["a"], reg("b")), mod("a", [], reg("a"))], { logger: quiet });
    expect(order).toEqual(["a", "b"]);
    expect(r.loaded).toEqual(["a", "b"]);
    expect(r.pruneSafe).toBe(true);
    expect(await (await app.request("/api/m/b/ping")).text()).toBe("b");
    expect((await app.request("/api/m/zzz/ping")).status).toBe(404);
  });

  it("ciclo, dependência desconhecida e duplicado lançam sem montar", async () => {
    for (const mods of [
      [mod("a", ["b"]), mod("b", ["a"])],
      [mod("a", ["nope"])],
      [mod("a"), mod("a")],
    ]) {
      let called = false;
      const spy = mods.map((m) => ({ ...m, register: () => void (called = true) }));
      await expect(loadModules(new Hono(), spy, { logger: quiet })).rejects.toThrow();
      expect(called).toBe(false);
    }
  });

  it("services: não-dependência lança; exposto é consumido pelo dependente", async () => {
    let got = 0;
    let err = "";
    const r = await loadModules(
      new Hono(),
      [
        mod("a", [], (c) => { c.services.expose("n", 42); }),
        mod("b", ["a"], (c) => {
          got = c.services.use<number>("a", "n");
        }),
        mod("c", [], (c) => {
          try {
            c.services.use("a", "n");
          } catch (e) {
            err = (e as Error).message;
          }
        }),
      ],
      { logger: quiet },
    );
    expect(got).toBe(42);
    expect(err).toMatch(/dependsOn/);
    expect(r.failed).toEqual([]);
  });

  it("eventos escopados: before de um módulo cancela ação de outro", async () => {
    const r = await loadModules(
      new Hono(),
      [
        mod("a", [], (c) => {
          c.events.before("x", (ctx) => ctx.cancel("não"));
        }),
        mod("b"),
      ],
      { logger: quiet },
    );
    const res = await r.events.run("x", {}, () => 1);
    expect(res).toMatchObject({ cancelled: true, reason: "não", by: "a" });
  });

  it("falha: sem rotas, permissões preservadas, pruneSafe=false, dependente failed, independente ok", async () => {
    const perms = definePermissions("a", { "r:read": "Ler" });
    const app = new Hono();
    const r = await loadModules(
      app,
      [
        defineModule({
          id: "a",
          version: "1.0.0",
          permissions: perms,
          register(ctx) {
            ctx.routes.get("/x", (c) => c.text("x"));
            throw new Error("boom");
          },
        }),
        mod("b", ["a"]),
        mod("c", [], (ctx) => { ctx.routes.get("/x", (c) => c.text("c")); }),
      ],
      { logger: quiet },
    );
    expect(r.loaded).toEqual(["c"]);
    expect(r.failed.map((f) => f.moduleId)).toEqual(["a", "b"]);
    expect(r.pruneSafe).toBe(false);
    expect(r.registry.allKeys().has("a:r:read")).toBe(true);
    expect((await app.request("/api/m/a/x")).status).toBe(404);
    expect((await app.request("/api/m/c/x")).status).toBe(200);
  });

  it("routeMiddleware aplicado e permissões em catalog()", async () => {
    const perms = definePermissions("a", { "r:read": "Ler" });
    const app = new Hono();
    const r = await loadModules(
      app,
      [defineModule({ id: "a", version: "1.0.0", permissions: perms, register: (c) => void c.routes.get("/x", (k) => k.text("ok")) })],
      { logger: quiet, routeMiddleware: async (c) => c.text("no", 401) },
    );
    expect((await app.request("/api/m/a/x")).status).toBe(401);
    expect(r.registry.catalog()[0]?.items[0]?.key).toBe("a:r:read");
  });
});
