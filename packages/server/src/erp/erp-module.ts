import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { FormFieldDef } from "@platform/shared";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { requirePermission } from "../iam/middleware.js";
import { IAM_PERMISSIONS } from "../iam/iam-permissions.js";
import type { ErpClientRegistry } from "./erp-client.js";
import { ERP_DRIVERS, parseErpValues, parseExternals, type ErpDriverDef } from "./erp-drivers.js";
import { readSecrets, type ErpClientFactory } from "./erp-factory.js";
import { ERP_PERMISSIONS } from "./erp-permissions.js";
import type { ErpExternalsStore } from "./erp-externals-store.js";
import type { ErpRecord, ErpStore } from "./erp-store.js";
import { encryptSecret } from "./secret-box.js";

/** Pasta de migrations do Plugin (schema Postgres "erp"). */
export const ERP_MIGRATIONS = { folder: resolve(import.meta.dirname, "migrations"), schema: "erp" };

export interface ErpModuleDeps {
  erpStore: ErpStore;
  /** Externals dos usuários por ERP. */
  externalsStore: ErpExternalsStore;
  /** Clientes ativos por id de ERP; o módulo os recria a cada edição. */
  clients: ErpClientRegistry;
  clientFactory: ErpClientFactory;
  auth: MiddlewareHandler;
  /** Externals declarados pelos Plugins ativos para cada ERP (por id do ERP). */
  externalFieldsByErp?: Record<string, FormFieldDef[]>;
  /** Drivers adicionais registrados por Plugins de /integrations. */
  extraDrivers?: Record<string, ErpDriverDef>;
}

/** A senha (segredos cifrados) nunca é devolvida. */
const publicErp = ({ secretsEncrypted: _omit, ...rest }: ErpRecord) => rest;

/**
 * Plugin `erp`: cadastro, teste e remoção de ERPs (/api/admin/erps) e o catálogo de ERP Drivers
 * (/api/admin/erp-drivers).
 */
export function createErpModule({ erpStore, externalsStore, clients, clientFactory, auth, externalFieldsByErp, extraDrivers }: ErpModuleDeps): ModuleDef {
  const drivers: Record<string, ErpDriverDef> = { ...ERP_DRIVERS, ...(extraDrivers ?? {}) };
  return defineModule({
    id: "erp",
    version: "1.0.0",
    prefix: "/api/admin",
    permissions: ERP_PERMISSIONS,
    migrations: ERP_MIGRATIONS,
    register({ routes }) {
      const manage = requirePermission(ERP_PERMISSIONS.keys["erps:manage"]);

      routes.get("/erp-drivers", auth, manage, (c) =>
        c.json(Object.values(drivers).map(({ id, label, fields, externalFields }) => ({ id, label, fields, externalFields })))
      );

      routes.get("/erps", auth, manage, async (c) => c.json((await erpStore.list()).map(publicErp)));

      // O id é o identificador do ERP usado pelos módulos.
      routes.put(
        "/erps/:id",
        auth,
        manage,
        zValidator("json", z.object({ name: z.string().min(1), driver: z.string().min(1), values: z.record(z.unknown()) })),
        async (c) => {
          const id = c.req.param("id");
          if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            return c.json({ error: "O id do ERP deve usar letras minúsculas, números e _ (ex.: inovafarma)." }, 400);
          }
          const { name, driver, values } = c.req.valid("json");
          const driverDef = drivers[driver];
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

      // Externals: valores do User por ERP, nos campos que o ERP Driver declara.
      const editUsers = requirePermission(IAM_PERMISSIONS.keys["users:update"]);

      routes.get("/erp-externals/:userId", auth, editUsers, async (c) => {
        const userId = c.req.param("userId");
        const entries = [];
        for (const erp of await erpStore.list()) {
          const driver = drivers[erp.driver];
          if (!driver) continue;
          const fields = externalFieldsByErp?.[erp.id] ?? driver.externalFields;
          entries.push({
            erpId: erp.id,
            erpName: erp.name,
            fields,
            values: await externalsStore.get(userId, erp.id),
          });
        }
        return c.json(entries);
      });

      routes.put(
        "/erp-externals/:userId/:erpId",
        auth,
        editUsers,
        zValidator("json", z.object({ values: z.record(z.unknown()) })),
        async (c) => {
          const erpId = c.req.param("erpId");
          const erp = await erpStore.get(erpId);
          const driver = erp && drivers[erp.driver];
          if (!erp || !driver) return c.json({ error: "ERP não encontrado." }, 404);
          const fields = externalFieldsByErp?.[erpId] ?? driver.externalFields;
          let values: Record<string, string | number>;
          try {
            values = parseExternals({ ...driver, externalFields: fields }, c.req.valid("json").values);
          } catch (err: unknown) {
            return c.json({ error: err instanceof Error ? err.message : "Valores inválidos." }, 400);
          }
          await externalsStore.save(c.req.param("userId"), erp.id, values);
          return c.json({ values });
        }
      );

      routes.post("/erps/:id/test", auth, manage, async (c) => {
        const client = clients[c.req.param("id")];
        if (!client) return c.json({ error: "ERP não encontrado." }, 404);
        const ok = (await client.healthCheck?.()) ?? false;
        return c.json({ ok }, ok ? 200 : 502);
      });

      routes.delete("/erps/:id", auth, manage, async (c) => {
        const id = c.req.param("id");
        if (!(await erpStore.get(id))) return c.json({ error: "ERP não encontrado." }, 404);
        await erpStore.delete(id);
        await externalsStore.deleteByErp(id);
        await clients[id]?.close?.();
        delete clients[id];
        return c.json({ success: true });
      });
    },
  });
}
