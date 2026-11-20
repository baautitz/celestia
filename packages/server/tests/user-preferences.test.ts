import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("Preferências do Usuário", () => {
  it("cada Usuário lê e grava só as próprias, com a chave validada", async () => {
    const store = createSeededUserStore({ admin: true });
    await store.createRole({ id: "r", name: "R", description: "d", permissions: [] });
    await store.createUser({ fullname: "Ana", username: "ana", password: TEST_PASSWORD, roleId: "r" });
    await store.createUser({ fullname: "Bia", username: "bia", password: TEST_PASSWORD, roleId: "r" });
    const app = createPlatformApp({ userStore: store });
    const token = async (username: string) =>
      ((await (await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username, password: TEST_PASSWORD }) })).json()) as { accessToken: string }).accessToken;
    const ana = { Authorization: `Bearer ${await token("ana")}` };
    const bia = { Authorization: `Bearer ${await token("bia")}` };
    const key = "/api/iam/preferences/inovafarma:montar-metas:view";

    expect(await (await app.request(key, { headers: ana })).json()).toEqual({ key: "inovafarma:montar-metas:view", value: null });
    const put = await app.request(key, { method: "PUT", headers: { ...ana, ...JSON_HEADERS }, body: JSON.stringify({ value: "by-meta" }) });
    expect(put.status).toBe(200);
    expect(((await (await app.request(key, { headers: ana })).json()) as { value: unknown }).value).toBe("by-meta");
    expect(((await (await app.request(key, { headers: bia })).json()) as { value: unknown }).value).toBeNull();

    expect((await app.request("/api/iam/preferences/Chave%20Ruim", { headers: ana })).status).toBe(400);
    expect((await app.request(key)).status).toBe(401);
  });

  describe("validação do corpo", () => {
    const setup = async () => {
      const store = createSeededUserStore({ admin: true });
      await store.createRole({ id: "r", name: "R", description: "d", permissions: [] });
      await store.createUser({ fullname: "Ana", username: "ana", password: TEST_PASSWORD, roleId: "r" });
      const app = createPlatformApp({ userStore: store });
      const res = await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "ana", password: TEST_PASSWORD }) });
      const headers = { ...JSON_HEADERS, Authorization: `Bearer ${((await res.json()) as { accessToken: string }).accessToken}` };
      const put = (body: string) => app.request("/api/iam/preferences/tela:view", { method: "PUT", headers, body });
      return { put, get: () => app.request("/api/iam/preferences/tela:view", { headers }) };
    };

    it("recusa corpo que não é JSON ou sem value, e aceita null", async () => {
      const { put, get } = await setup();
      expect((await put("{nao-json")).status).toBe(400);
      expect((await put("{}")).status).toBe(400);
      expect((await put(JSON.stringify({ value: null }))).status).toBe(200);
      expect(await (await get()).json()).toEqual({ key: "tela:view", value: null });
    });

    it("mede o limite em bytes, não em caracteres", async () => {
      const { put } = await setup();
      // 'é' ocupa 2 bytes em UTF-8: 2.100 deles passam de 4.096 bytes, mas têm só 2.100 caracteres.
      expect((await put(JSON.stringify({ value: "a".repeat(4000) }))).status).toBe(200);
      expect((await put(JSON.stringify({ value: "é".repeat(2100) }))).status).toBe(400);
    });
  });
});
