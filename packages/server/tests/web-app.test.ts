import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { serveWebApp } from "../src/boot/web-app.js";

const dir = mkdtempSync(join(tmpdir(), "web-app-"));
mkdirSync(join(dir, "assets"));
writeFileSync(join(dir, "index.html"), "<html>spa</html>");
writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function createApp() {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  serveWebApp(app, relative(process.cwd(), dir));
  return app;
}

describe("serveWebApp", () => {
  it("entrega os arquivos do SPA", async () => {
    const res = await createApp().request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("devolve o index.html nas rotas do SPA", async () => {
    const res = await createApp().request("/login/certificado");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("spa");
  });

  it("mantém a API e não troca um /api desconhecido pelo SPA", async () => {
    const app = createApp();
    expect((await app.request("/api/health")).status).toBe(200);
    const unknown = await app.request("/api/nao-existe");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain("spa");
  });
});
