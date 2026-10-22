import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPlatformApp } from "../src/index.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import { createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

async function boot() {
  const auditLog = new AuditLog(new MemoryAuditStore());
  auditLog.declareAction({
    plugin: "erp",
    action: "closing.close",
    schemaVersion: 1,
    schema: z.object({}),
    summary: () => "Fechou o período",
  });
  const app = createPlatformApp({ userStore: createSeededUserStore(), auditLog });
  const login = async (username: string) => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: TEST_PASSWORD }),
    });
    return ((await res.json()) as { access_token: string }).access_token;
  };
  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { auditLog, login, get };
}

describe("GET /api/audit", () => {
  it("exige autenticação e system:audit:read", async () => {
    const { login, get } = await boot();
    expect((await get("/api/audit")).status).toBe(401);
    expect((await get("/api/audit", await login("joao.silva"))).status).toBe(403);
    expect((await get("/api/audit", await login("carlos.admin"))).status).toBe(200);
  });

  it("lista e filtra por alvo, usuário, plugin e data", async () => {
    const { auditLog, login, get } = await boot();
    const rec = (id: string, actorId: string, at: string) =>
      auditLog.record({
        plugin: "erp",
        action: "closing.close",
        actor: { id: actorId, name: actorId },
        target: { type: "closing_period", id },
        attributes: {},
        occurredAt: new Date(at),
      });
    await rec("cp-1", "u1", "2026-01-10T12:00:00Z");
    await rec("cp-2", "u2", "2026-02-10T12:00:00Z");
    const token = await login("carlos.admin");
    const ids = async (qs: string) =>
      ((await (await get(`/api/audit?${qs}`, token)).json()) as { targetId: string }[]).map((e) => e.targetId);
    expect(await ids("")).toEqual(["cp-2", "cp-1"]);
    expect(await ids("targetType=closing_period&targetId=cp-1")).toEqual(["cp-1"]);
    expect(await ids("actorId=u2")).toEqual(["cp-2"]);
    expect(await ids("plugin=nope")).toEqual([]);
    expect(await ids("from=2026-02-01&to=2026-03-01")).toEqual(["cp-2"]);
    expect((await get("/api/audit?from=lixo", token)).status).toBe(400);
  });
});
