import { describe, expect, it } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import { createSeededUserStore, refreshTokenOf, TEST_PASSWORD } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

function setup() {
  let now = Date.parse("2026-11-20T10:00:00Z");
  const auditLog = new AuditLog(new MemoryAuditStore());
  const app = createPlatformApp({ userStore: createSeededUserStore({ admin: true }), auditLog, now: () => now });
  const cookie = (token: string) => ({ ...JSON_HEADERS, Cookie: `refresh_token=${token}` });
  const login = async () =>
    refreshTokenOf(await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "test.root", password: TEST_PASSWORD }) }));
  const post = (path: string, token: string, body?: object) => app.request(path, { method: "POST", headers: cookie(token), body: body && JSON.stringify(body) });
  const entries = async (action: string) => (await auditLog.list({ plugin: "iam" })).filter((e) => e.action === action);
  return { advance: (ms: number) => (now += ms), login, post, entries };
}

describe("Audit Log da sessão", () => {
  it("registra o bloqueio e o desbloqueio, sem senha nem token", async () => {
    const { login, post, entries } = setup();
    const token = await login();
    await post("/api/auth/lock", token);
    expect(await entries("lock_session")).toMatchObject([{ actorName: "Test Root", targetType: "user", attributes: { username: "test.root" } }]);

    await post("/api/auth/unlock", token, { password: TEST_PASSWORD });
    expect(await entries("unlock_session")).toMatchObject([{ attributes: { username: "test.root" } }]);
    expect(JSON.stringify([...(await entries("lock_session")), ...(await entries("unlock_session"))])).not.toContain(token);
  });

  it("registra o reuso detectado, que derruba a sessão", async () => {
    const { advance, login, post, entries } = setup();
    const first = await login();
    await post("/api/auth/refresh", first);
    advance(31_000);
    await post("/api/auth/refresh", first);
    expect(await entries("detect_session_reuse")).toMatchObject([{ attributes: { username: "test.root" } }]);
  });

  it("registra o logout", async () => {
    const { login, post, entries } = setup();
    await post("/api/auth/logout", await login());
    expect(await entries("logout")).toMatchObject([{ attributes: { username: "test.root" } }]);
  });
});
