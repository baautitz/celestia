import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";

const actor = { id: "u1", name: "Ana Souza" };
const closing = { type: "closing_period", id: "cp-1" };

function setup() {
  const store = new MemoryAuditStore();
  const log = new AuditLog(store);
  log.declareAction({
    plugin: "erp",
    action: "closing.close",
    schemaVersion: 2,
    schema: z.object({ total: z.number() }).strict(),
    summary: (a) => `Fechou o período com total ${a.total}`,
  });
  return { store, log };
}

describe("Audit Log", () => {
  it("grava uma Log Entry com envelope, atributos, versão do schema e resumo", async () => {
    const { log } = setup();
    const entry = await log.record({ plugin: "erp", action: "closing.close", actor, target: closing, attributes: { total: 10 } });
    expect(entry).toMatchObject({
      plugin: "erp",
      action: "closing.close",
      actorId: "u1",
      actorName: "Ana Souza",
      targetType: "closing_period",
      targetId: "cp-1",
      attributes: { total: 10 },
      schemaVersion: 2,
      summary: "Fechou o período com total 10",
    });
    expect(entry.occurredAt).toBeInstanceOf(Date);
  });

  it("rejeita atributos fora do schema e ação não declarada, sem gravar", async () => {
    const { log } = setup();
    await expect(
      log.record({ plugin: "erp", action: "closing.close", actor, target: closing, attributes: { total: "x" } }),
    ).rejects.toThrow();
    await expect(
      log.record({ plugin: "erp", action: "closing.close", actor, target: closing, attributes: { total: 1, extra: 1 } }),
    ).rejects.toThrow();
    await expect(log.record({ plugin: "erp", action: "nope", actor, target: closing, attributes: {} })).rejects.toThrow();
    expect(await log.list({})).toHaveLength(0);
  });

  it("só recebe acréscimos: o store não expõe alteração nem remoção", () => {
    const { store } = setup();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(store)).sort()).toEqual(["append", "constructor", "list"]);
  });

  it("continua legível quando o Plugin que escreveu não está no build", async () => {
    const { store, log } = setup();
    await log.record({ plugin: "erp", action: "closing.close", actor, target: closing, attributes: { total: 10 } });
    const bare = new AuditLog(store); // build sem o plugin erp
    const [entry] = await bare.list({});
    expect(entry.summary).toBe("Fechou o período com total 10");
    expect(entry.plugin).toBe("erp");
  });

  it("filtra por alvo, usuário, plugin e data; mais recentes primeiro", async () => {
    const { log } = setup();
    log.declareAction({ plugin: "other", action: "x", schemaVersion: 1, schema: z.object({}), summary: () => "x" });
    const mk = (over: Partial<Parameters<typeof log.record>[0]>, at: string) =>
      log.record({ plugin: "erp", action: "closing.close", actor, target: closing, attributes: { total: 1 }, ...over, occurredAt: new Date(at) });
    await mk({}, "2026-01-10T12:00:00Z");
    await mk({ target: { type: "closing_period", id: "cp-2" } }, "2026-02-10T12:00:00Z");
    await mk({ actor: { id: "u2", name: "Bia" } }, "2026-03-10T12:00:00Z");
    await mk({ plugin: "other", action: "x", attributes: {} }, "2026-04-10T12:00:00Z");
    expect((await log.list({})).map((e) => e.occurredAt.getUTCMonth())).toEqual([3, 2, 1, 0]);
    expect(await log.list({ targetType: "closing_period", targetId: "cp-2" })).toHaveLength(1);
    expect(await log.list({ actorId: "u2" })).toHaveLength(1);
    expect(await log.list({ plugin: "other" })).toHaveLength(1);
    expect(await log.list({ from: new Date("2026-02-01"), to: new Date("2026-03-31") })).toHaveLength(2);
  });
});
