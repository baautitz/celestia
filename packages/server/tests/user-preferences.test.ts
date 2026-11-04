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
});
