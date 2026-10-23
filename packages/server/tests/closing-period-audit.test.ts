import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MemoryClosingPeriodStore } from "../src/closing-period/closing-period-store.js";
import { authHeader, createSeededUserStore } from "./helpers/fixtures.js";

// Seam: GET /api/audit após ações no Plugin (Audit Log global, ADR 0001).
describe("Closing Period grava Log Entries", () => {
  it("registra criar, editar faixa, fechar, reabrir e cancelar, e as entradas sobrevivem ao cancelamento", async () => {
    const app = createPlatformApp({ userStore: createSeededUserStore(), closingPeriodStore: new MemoryClosingPeriodStore() });
    const admin = await authHeader(app, "carlos.admin");
    const send = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { "Content-Type": "application/json", ...admin },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const created = (await (
      await send("POST", "/api/closing-periods", { name: "Janeiro", startDate: "2026-01-01", endDate: "2026-01-31" })
    ).json()) as { id: string; version: number };
    await send("PUT", `/api/closing-periods/${created.id}/range`, { startDate: "2026-01-01", endDate: "2026-01-30", version: created.version });
    await send("POST", `/api/closing-periods/${created.id}/close`);
    await send("POST", `/api/closing-periods/${created.id}/reopen`);
    expect((await send("DELETE", `/api/closing-periods/${created.id}`)).status).toBe(200);

    const res = await send("GET", `/api/audit?targetType=closing_period&targetId=${created.id}`);
    const entries = (await res.json()) as {
      action: string;
      plugin: string;
      summary: string;
      attributes: Record<string, unknown>;
      actorName: string;
    }[];
    expect(entries.map((e) => e.action).sort()).toEqual(["cancel", "close", "create", "reopen", "update_range"]);
    expect(entries.every((e) => e.plugin === "closing_period" && e.summary.includes("Janeiro") && e.actorName)).toBe(true);
    const range = entries.find((e) => e.action === "update_range");
    expect(range?.attributes).toMatchObject({
      from: { startDate: "2026-01-01", endDate: "2026-01-31" },
      to: { startDate: "2026-01-01", endDate: "2026-01-30" },
    });
  });
});
