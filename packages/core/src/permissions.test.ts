import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ForbiddenError, PermissionRegistry, byPermission, definePermissions, guarded, pickVariant, pruneOrphans,
} from "./permissions.js";

const perms = definePermissions("metas", {
  "meta:aprovar": "Aprovar meta",
  "meta:ver": { label: "Ver meta", description: "d" },
});
const ctx = (...p: string[]) => ({ user: { permissions: p } });

describe("definePermissions", () => {
  it("monta chaves e itens", () => {
    expect(perms.keys["meta:aprovar"]).toBe("metas:meta:aprovar");
    expect(perms.items[1]).toMatchObject({ key: "metas:meta:ver", label: "Ver meta", description: "d", module: "metas" });
    expectTypeOf(perms.keys).toHaveProperty("meta:ver");
    // @ts-expect-error chave inexistente
    void perms.keys["x:y"];
  });
  it("valida formato", () => {
    expect(() => definePermissions("Metas", {})).toThrow(/Módulo inválido/);
    expect(() => definePermissions("m", { "a:b:c": "x" })).toThrow(/inválida/);
    expect(() => definePermissions("m", { A: "x" })).toThrow(/inválida/);
  });
  it("é imutável", () => {
    expect(Object.isFrozen(perms)).toBe(true);
  });
});

describe("PermissionRegistry", () => {
  it("une estáticos e providers dinâmicos", () => {
    const r = new PermissionRegistry();
    r.register(perms);
    let n = 1;
    r.registerProvider("recipe", () =>
      Array.from({ length: n }, (_, i) => ({ key: `recipe:r${i}:view`, label: "v", module: "recipe" })));
    expect(r.allKeys().size).toBe(3);
    n = 2;
    expect(r.allKeys().has("recipe:r1:view")).toBe(true);
    expect(r.catalog().map((c) => c.module)).toEqual(["metas", "recipe"]);
    r.unregisterModule("recipe");
    expect(r.allKeys().size).toBe(2);
  });
  it("has honra *", () => {
    const r = new PermissionRegistry();
    expect(r.has(["*"], "a:b:c")).toBe(true);
    expect(r.has(["a"], "b")).toBe(false);
  });
});

describe("guarded", () => {
  const f = guarded(perms.keys["meta:aprovar"], (_c: ReturnType<typeof ctx>, n: number) => n * 2);
  it("permite", () => expect(f(ctx("metas:meta:aprovar"), 2)).toBe(4));
  it("nega com 403", () => {
    try {
      f(ctx(), 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).status).toBe(403);
      expect((e as ForbiddenError).message).toContain("metas:meta:aprovar");
    }
  });
});

describe("byPermission", () => {
  const f = byPermission([
    { when: "a", run: () => "A" },
    { when: "b", run: () => "B" },
  ]);
  it("primeira que casa", () => {
    expect(f(ctx("b", "a"))).toBe("A");
    expect(f(ctx("b"))).toBe("B");
  });
  it("nenhuma casa", () => expect(() => f(ctx())).toThrow(ForbiddenError));
  it("pickVariant", () => expect(pickVariant([{ when: "x" }], ["*"])).toEqual({ when: "x" }));
});

describe("pruneOrphans", () => {
  it("mantém * e válidas", () => {
    expect(pruneOrphans(["*", "a", "b"], new Set(["a"]))).toEqual(["*", "a"]);
  });
});
