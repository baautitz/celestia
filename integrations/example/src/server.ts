import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { EXAMPLE_PERMISSIONS } from "./permissions.js";

export { EXAMPLE_PERMISSIONS };

/** Migrations do Plugin (schema Postgres "example"). */
export const EXAMPLE_MIGRATIONS = { folder: resolve(import.meta.dirname, "../drizzle"), schema: "example" };

export interface ExamplePluginDeps {
  /** Middleware de autenticação, injetado pelo servidor: o Plugin não importa o servidor. */
  auth: MiddlewareHandler;
}

/** Plugin de exemplo: uma rota em /api/m/example/hello, uma Permission, uma migration e uma tela de menu (web). */
export function createExamplePlugin({ auth }: ExamplePluginDeps): ModuleDef {
  return defineModule({
    id: "example",
    version: "1.0.0",
    permissions: EXAMPLE_PERMISSIONS,
    migrations: EXAMPLE_MIGRATIONS,
    register({ routes, permissions }) {
      routes.get("/hello", auth, (c: Context<{ Variables: { user?: { permissions?: string[] } } }>) => {
        const user = c.get("user");
        const key = EXAMPLE_PERMISSIONS.keys["note:read"];
        if (!permissions.has(user?.permissions, key)) {
          return c.json({ error: EXAMPLE_PERMISSIONS.items[0]?.deniedMessage ?? "Acesso negado." }, 403);
        }
        return c.json({ message: "Olá do Plugin de exemplo." });
      });
    },
  });
}
