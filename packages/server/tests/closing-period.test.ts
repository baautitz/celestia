import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { Hono } from "hono";
import { loadModules } from "@platform/core/loader";
import { createClosingPeriodModule } from "../src/closing-period/closing-period-module.js";
import { MemoryClosingPeriodStore } from "../src/closing-period/closing-period-store.js";
import { authHeader, createSeededUserStore } from "./helpers/fixtures.js";

// Seam: a API HTTP do Plugin Closing Period, montada por createPlatformApp.
describe("Closing Period (Período de Fechamento)", () => {
  let app: ReturnType<typeof createPlatformApp>;
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  let seller: Record<string, string>;

  beforeEach(async () => {
    app = createPlatformApp({ userStore: createSeededUserStore() });
    admin = await authHeader(app, "carlos.admin");
    operator = await authHeader(app, "maria.souza");
    seller = await authHeader(app, "joao.silva");
  });

  const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const create = (body: unknown, headers = admin) => send("POST", "/api/closing-periods", headers, body);
  const jan = { name: "Janeiro", startDate: "2026-01-01", endDate: "2026-01-31" };

  it("cria um período aberto com id, e o devolve na lista e na leitura", async () => {
    const res = await create(jan);
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string; startDate: string };
    expect(created).toMatchObject({ ...jan, status: "open" });
    expect(created.id).toBeTruthy();

    const list = (await (await send("GET", "/api/closing-periods", admin)).json()) as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([created.id]);
    const one = await send("GET", `/api/closing-periods/${created.id}`, admin);
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject(jan);
  });

  it("aceita período de um único dia e de qualquer duração", async () => {
    expect((await create({ name: "Dia", startDate: "2026-03-05", endDate: "2026-03-05" })).status).toBe(201);
    expect((await create({ name: "Longo", startDate: "2027-01-01", endDate: "2027-12-31" })).status).toBe(201);
  });

  it("rejeita fim anterior ao início com a mensagem canônica", async () => {
    const res = await create({ name: "x", startDate: "2026-02-10", endDate: "2026-02-01" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("A Data Final não pode ser anterior à Data Inicial.");
  });

  it("rejeita datas inexistentes, fora do formato ou ausentes", async () => {
    for (const bad of [
      { name: "x", startDate: "2026-02-30", endDate: "2026-03-01" },
      { name: "x", startDate: "01/02/2026", endDate: "2026-03-01" },
      { name: "x" },
    ]) {
      expect((await create(bad)).status).toBe(400);
    }
  });

  it("rejeita período que toca outro (mesmo um único dia em comum)", async () => {
    await create(jan);
    for (const [startDate, endDate] of [
      ["2026-01-31", "2026-02-15"],
      ["2025-12-15", "2026-01-01"],
      ["2026-01-10", "2026-01-20"],
      ["2025-12-01", "2026-02-28"],
    ]) {
      expect((await create({ name: "x", startDate, endDate })).status).toBe(400);
    }
    // vizinho sem data em comum é permitido
    expect((await create({ name: "Fev", startDate: "2026-02-01", endDate: "2026-02-28" })).status).toBe(201);
  });

  it("id desconhecido responde 404", async () => {
    expect((await send("GET", "/api/closing-periods/nao_existe", admin)).status).toBe(404);
  });

  it("exige autenticação e as Permissions closing_period:period:read / create", async () => {
    expect((await app.request("/api/closing-periods")).status).toBe(401);
    expect((await send("GET", "/api/closing-periods", seller)).status).toBe(403);
    expect((await create(jan, seller)).status).toBe(403);
    // operador semeado: read + create
    expect((await create(jan, operator)).status).toBe(201);
    expect((await send("GET", "/api/closing-periods", operator)).status).toBe(200);
  });

  it("as rotas antigas de workspaces não existem mais", async () => {
    expect((await send("GET", "/api/workspaces", admin)).status).toBe(404);
  });

  describe("fechar, reabrir e cancelar", () => {
    const act = (id: string, action: "close" | "reopen", headers = admin) => send("POST", `/api/closing-periods/${id}/${action}`, headers);
    const remove = (id: string, headers = admin) => send("DELETE", `/api/closing-periods/${id}`, headers);
    const make = async (body = jan) => ((await (await create(body)).json()) as { id: string }).id;
    const statusOf = async (id: string) => ((await (await send("GET", `/api/closing-periods/${id}`, admin)).json()) as { status: string }).status;

    it("fecha e reabre, alternando o estado entre open e closed", async () => {
      const id = await make();
      const closed = await act(id, "close");
      expect(closed.status).toBe(200);
      expect(await closed.json()).toMatchObject({ id, status: "closed" });
      expect(await statusOf(id)).toBe("closed");
      const reopened = await act(id, "reopen");
      expect(await reopened.json()).toMatchObject({ status: "open" });
      expect(await statusOf(id)).toBe("open");
    });

    it("recusa fechar um período já fechado e reabrir um aberto (409)", async () => {
      const id = await make();
      expect((await act(id, "reopen")).status).toBe(409);
      await act(id, "close");
      expect((await act(id, "close")).status).toBe(409);
    });

    it("cancela um período aberto, removendo a linha e liberando as datas", async () => {
      const id = await make();
      expect((await remove(id)).status).toBe(200);
      expect((await send("GET", `/api/closing-periods/${id}`, admin)).status).toBe(404);
      expect((await create(jan)).status).toBe(201);
    });

    it("recusa cancelar um período fechado até que seja reaberto", async () => {
      const id = await make();
      await act(id, "close");
      expect((await remove(id)).status).toBe(409);
      expect(await statusOf(id)).toBe("closed");
      await act(id, "reopen");
      expect((await remove(id)).status).toBe(200);
    });

    it("responde 404 para id desconhecido", async () => {
      expect((await act("nada", "close")).status).toBe(404);
      expect((await act("nada", "reopen")).status).toBe(404);
      expect((await remove("nada")).status).toBe(404);
    });

    it("exige Permissions separadas para close, reopen e cancel", async () => {
      const id = await make();
      expect((await act(id, "close", operator)).status).toBe(403);
      expect((await act(id, "reopen", operator)).status).toBe(403);
      expect((await remove(id, operator)).status).toBe(403);
      expect((await act(id, "close", seller)).status).toBe(403);
    });
  });
});

describe("Closing Period: veto por handler before", () => {
  async function boot() {
    const store = new MemoryClosingPeriodStore();
    const app = new Hono();
    const result = await loadModules(app, [
      createClosingPeriodModule({
        store,
        auth: async (c, next) => {
          c.set("user", { sub: "usr_test", username: "t", fullname: "T", role: "r", permissions: ["*"], externals: {} });
          await next();
        },
      }),
    ]);
    const now = "2026-01-01T00:00:00.000Z";
    await store.save({ id: "p1", name: "Jan", startDate: "2026-01-01", endDate: "2026-01-31", status: "open", createdAt: now, updatedAt: now });
    return { app, store, result };
  }

  it.each([
    ["closing_period.close", "POST", "/api/closing-periods/p1/close", "open"],
    ["closing_period.reopen", "POST", "/api/closing-periods/p1/reopen", "closed"],
    ["closing_period.cancel", "DELETE", "/api/closing-periods/p1", "open"],
  ])("um before em %s veta a ação e responde 409 com o motivo", async (event, method, path, initial) => {
    const { app, store, result } = await boot();
    const p = (await store.get("p1"))!;
    await store.save({ ...p, status: initial as "open" | "closed" });
    result.events.before(event, (ctx) => ctx.cancel("há dados dependentes"));
    const res = await app.request(path, { method });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "há dados dependentes" });
    expect((await store.get("p1"))?.status).toBe(initial);
  });

  it("emite o evento after com o período depois de fechar", async () => {
    const { app, result } = await boot();
    const seen: unknown[] = [];
    result.events.after("closing_period.close", (p) => void seen.push(p));
    await app.request("/api/closing-periods/p1/close", { method: "POST" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ periodId: "p1", startDate: "2026-01-01", endDate: "2026-01-31" });
  });
});
