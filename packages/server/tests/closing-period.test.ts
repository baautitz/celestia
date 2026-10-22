import { describe, it, expect, beforeEach } from "vitest";
import { createPlatformApp } from "../src/index.js";
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
});
