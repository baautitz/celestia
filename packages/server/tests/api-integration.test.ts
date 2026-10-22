import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { createSeededUserStore } from "./helpers/fixtures.js";

describe("Hono API Integration Test", () => {
  const app = createPlatformApp({ userStore: createSeededUserStore({ admin: true }) });

  it("GET /api/health deve responder status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("rotas de Modelos/Dashboards foram removidas", async () => {
    for (const path of ["/api/recipes", "/api/admin/recipes", "/api/dashboards/x/schema", "/api/lookups"]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});
