import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { requirePermission } from "../iam/middleware.js";
import type { ErpClientRegistry } from "./erp-client.js";
import { ERP_DRIVERS, parseErpValues } from "./erp-drivers.js";
import { readSecrets, type ErpClientFactory } from "./erp-factory.js";
import { ERP_PERMISSIONS } from "./erp-permissions.js";
import type { ErpRecord, ErpStore } from "./erp-store.js";
import { encryptSecret } from "./secret-box.js";

/** Pasta de migrations do Plugin (schema Postgres "erp"). */
export const ERP_MIGRATIONS = { folder: resolve(__dirname, "migrations"), schema: "erp" };

export interface ErpModuleDeps {
  erpStore: ErpStore;
  /** Clientes ativos por id de ERP; o módulo os recria a cada edição. */
  clients: ErpClientRegistry;
  clientFactory: ErpClientFactory;
  auth: MiddlewareHandler;
}

/** A senha (segredos cifrados) nunca é devolvida. */
const publicErp = ({ secretsEncrypted: _omit, ...rest }: ErpRecord) => rest;

/**
 * Plugin `erp`: cadastro, teste e remoção de ERPs (/api/admin/erps) e o catálogo de ERP Drivers
 * (/api/admin/erp-drivers).
 */
export function createErpModule({ erpStore, clients, clientFactory, auth }: ErpModuleDeps): ModuleDef {
  return defineModule({
    id: "erp",
    version: "1.0.0",
    prefix: "/api",
    permissions: ERP_PERMISSIONS,
    migrations: ERP_MIGRATIONS,
    register({ routes }) {
      const manage = requirePermission(ERP_PERMISSIONS.keys["erps:manage"]);

      routes.get("/admin/erp-drivers", auth, manage, (c) =>
        c.json(Object.values(ERP_DRIVERS).map(({ id, label, fields }) => ({ id, label, fields })))
      );

      routes.get("/admin/erps", auth, manage, async (c) => c.json((await erpStore.list()).map(publicErp)));

      // O id é o identificador do ERP usado pelos módulos.
      routes.put(
        "/admin/erps/:id",
        auth,
        manage,
        zValidator("json", z.object({ name: z.string().min(1), driver: z.string().min(1), values: z.record(z.unknown()) })),
        async (c) => {
          const id = c.req.param("id");
          if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            return c.json({ error: "O id do ERP deve usar letras minúsculas, números e _ (ex.: inovafarma)." }, 400);
          }
          const { name, driver, values } = c.req.valid("json");
          const driverDef = ERP_DRIVERS[driver];
          if (!driverDef) return c.json({ error: `ERP Driver '${driver}' não suportado.` }, 400);

          const existing = await erpStore.get(id);
          let parsed: ReturnType<typeof parseErpValues>;
          try {
            // Segredo em branco numa edição mantém o valor salvo (só se o driver não mudou).
            parsed = parseErpValues(driverDef, values, existing && existing.driver === driver ? readSecrets(existing) : {});
          } catch (err: unknown) {
            return c.json({ error: err instanceof Error ? err.message : "Valores inválidos." }, 400);
          }

          const record = await erpStore.save({
            id,
            name,
            driver,
            config: parsed.config,
            secretsEncrypted: encryptSecret(JSON.stringify(parsed.secrets)),
          });
          await clients[id]?.close?.();
          clients[id] = clientFactory(record);
          return c.json(publicErp(record));
        }
      );

      routes.post("/admin/erps/:id/test", auth, manage, async (c) => {
        const client = clients[c.req.param("id")];
        if (!client) return c.json({ error: "ERP não encontrado." }, 404);
        const ok = (await client.healthCheck?.()) ?? false;
        return c.json({ ok }, ok ? 200 : 502);
      });

      routes.delete("/admin/erps/:id", auth, manage, async (c) => {
        const id = c.req.param("id");
        if (!(await erpStore.get(id))) return c.json({ error: "ERP não encontrado." }, 404);
        await erpStore.delete(id);
        await clients[id]?.close?.();
        delete clients[id];
        return c.json({ success: true });
      });
    },
  });
}
