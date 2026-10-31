import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * Serve o SPA compilado no mesmo endereço da API (a imagem `celestia` é um processo só). Rotas fora de `/api` que não
 * são arquivos caem no `index.html`; um `/api` desconhecido continua 404. Registre depois das rotas da API.
 * `root` é relativo ao diretório de trabalho do processo.
 */
export function serveWebApp(app: Hono, root: string): void {
  app.use("*", async (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next();
    return serveStatic({ root })(c, next);
  });
  app.get("*", async (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next();
    return serveStatic({ root, path: "index.html" })(c, next);
  });
}
