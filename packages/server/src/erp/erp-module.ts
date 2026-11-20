import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import type { ValidationErrorBody } from "@platform/shared";
import { zValidator } from "../validation.js";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { getAuthenticatedUser, requirePermission } from "../iam/middleware.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ErpClient, ErpClientRegistry } from "./erp-client.js";
import { declareErpAudit, ERP_PLUGIN, ERP_TARGET } from "./erp-audit.js";
import { ERP_DRIVERS, ErpValuesError, parseErpValues, type ErpDriverDef } from "./erp-drivers.js";
import { readSecrets, type ErpClientFactory } from "./erp-factory.js";
import { ERP_PERMISSIONS } from "./erp-permissions.js";
import type { ErpRecord, ErpStore } from "./erp-store.js";
import { encryptSecret } from "./secret-box.js";

/** Pasta de migrations do Plugin (schema Postgres "erp"). */
export const ERP_MIGRATIONS = { folder: resolve(import.meta.dirname, "migrations"), schema: "erp" };

export interface ErpModuleDeps {
  erpStore: ErpStore;
  /** Clientes ativos por id de ERP; o módulo os recria a cada edição. */
  clients: ErpClientRegistry;
  clientFactory: ErpClientFactory;
  auth: MiddlewareHandler;
  auditLog: AuditLog;
  /** Drivers adicionais registrados por Plugins de /integrations. */
  extraDrivers?: Record<string, ErpDriverDef>;
}

/** A senha (segredos cifrados) nunca é devolvida. */
const publicErp = ({ secretsEncrypted: _omit, ...rest }: ErpRecord) => rest;

const ErpIdParam = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "O id do ERP deve usar letras minúsculas, números e _ (ex.: inovafarma)."),
});

/** Tipo aceito para o valor de cada campo do formulário do driver (obrigatoriedade e limites ficam em `parseErpValues`). */
function fieldValueSchema(field: ErpDriverDef["fields"][number]): z.ZodType {
  switch (field.type) {
    case "switch":
      return z.boolean();
    case "number":
    case "money":
      return z.union([z.number(), z.string()]);
    default:
      return z.string();
  }
}

/** Cada id do registro é um dado do usuário: só vale a chave própria (`constructor`, `toString`... não existem). */
const clientOf = (clients: ErpClientRegistry, id: string): ErpClient | undefined => (Object.hasOwn(clients, id) ? clients[id] : undefined);

/**
 * Plugin `erp`: cadastro, teste e remoção de ERPs (/api/admin/erps) e o catálogo de ERP Drivers
 * (/api/admin/erp-drivers).
 */
export function createErpModule({ erpStore, clients, clientFactory, auth, auditLog, extraDrivers }: ErpModuleDeps): ModuleDef {
  declareErpAudit(auditLog);
  const drivers = new Map<string, ErpDriverDef>(Object.entries({ ...ERP_DRIVERS, ...(extraDrivers ?? {}) }));

  const SaveSchema = z
    .object({ name: z.string().min(1), driver: z.string().min(1), values: z.record(z.string(), z.unknown()) })
    .superRefine((input, ctx) => {
      const driver = drivers.get(input.driver);
      if (!driver) {
        ctx.addIssue({ code: "custom", path: ["driver"], message: `ERP Driver '${input.driver}' não suportado.` });
        return;
      }
      for (const field of driver.fields) {
        const raw = input.values[field.name];
        if (raw === undefined || raw === null || raw === "") continue;
        const typed = fieldValueSchema(field).safeParse(raw);
        if (!typed.success) {
          ctx.addIssue({ code: "custom", path: ["values", field.name], message: `${field.label} tem um tipo de valor inválido.` });
        }
      }
    });

  return defineModule({
    id: "erp",
    version: "1.0.0",
    prefix: "/api/admin",
    permissions: ERP_PERMISSIONS,
    migrations: ERP_MIGRATIONS,
    register({ routes }) {
      const manage = requirePermission(ERP_PERMISSIONS.keys["erps:manage"]);

      const audit = (c: Context, action: string, id: string, attributes: Record<string, unknown>) => {
        const user = getAuthenticatedUser(c);
        return auditLog.record({
          plugin: ERP_PLUGIN,
          action,
          actor: { id: user.sub, name: user.fullname },
          target: { type: ERP_TARGET, id },
          attributes,
        });
      };

      routes.get("/erp-drivers", auth, manage, (c) =>
        c.json([...drivers.values()].map(({ id, label, fields }) => ({ id, label, fields })))
      );

      routes.get("/erps", auth, manage, async (c) => c.json((await erpStore.list()).map(publicErp)));

      // O id é o identificador do ERP usado pelos módulos.
      routes.put("/erps/:id", auth, manage, zValidator("param", ErpIdParam), zValidator("json", SaveSchema), async (c) => {
        const { id } = c.req.valid("param");
        const { name, driver, values } = c.req.valid("json");
        const driverDef = drivers.get(driver);
        if (!driverDef) return c.json(validationError(["driver"], `ERP Driver '${driver}' não suportado.`), 400);

        const existing = await erpStore.get(id);
        let parsed: ReturnType<typeof parseErpValues>;
        try {
          // Segredo em branco numa edição mantém o valor salvo (só se o driver não mudou).
          parsed = parseErpValues(driverDef, values, existing && existing.driver === driver ? readSecrets(existing) : {});
        } catch (err: unknown) {
          if (err instanceof ErpValuesError) return c.json(validationError(["values", err.field], err.message), 400);
          throw err;
        }

        const secretsEncrypted = encryptSecret(JSON.stringify(parsed.secrets));
        // O cliente novo nasce antes de qualquer gravação: se a fábrica falhar, nada mudou (nem o banco, nem o cliente antigo).
        const now = new Date().toISOString();
        let next: ErpClient;
        try {
          next = clientFactory({ id, name, driver, config: parsed.config, secretsEncrypted, createdAt: existing?.createdAt ?? now, updatedAt: now });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Não foi possível criar o cliente do ERP.";
          return c.json(validationError(["values"], message), 400);
        }
        let record: ErpRecord;
        try {
          record = await erpStore.save({ id, name, driver, config: parsed.config, secretsEncrypted });
        } catch (err: unknown) {
          await next.close?.();
          throw err;
        }
        const previous = clientOf(clients, id);
        clients[id] = next;
        await previous?.close?.();
        await audit(c, "save", id, { name, driver, created: !existing });
        return c.json(publicErp(record));
      });

      routes.post("/erps/:id/test", auth, manage, async (c) => {
        const id = c.req.param("id");
        const client = clientOf(clients, id);
        if (!client) return c.json({ error: "ERP não encontrado." }, 404);
        const ok = (await client.healthCheck?.()) ?? false;
        const record = await erpStore.get(id);
        await audit(c, "test", id, { name: record?.name ?? id, driver: record?.driver ?? "desconhecido", ok });
        return c.json({ ok }, ok ? 200 : 502);
      });

      routes.delete("/erps/:id", auth, manage, async (c) => {
        const id = c.req.param("id");
        const record = await erpStore.get(id);
        if (!record) return c.json({ error: "ERP não encontrado." }, 404);
        await erpStore.delete(id);
        await clientOf(clients, id)?.close?.();
        delete clients[id];
        await audit(c, "delete", id, { name: record.name, driver: record.driver });
        return c.json({ success: true });
      });
    },
  });
}

/** Corpo de recusa no contrato `ValidationErrorBody`. */
function validationError(path: (string | number)[], message: string): ValidationErrorBody {
  return { error: { issues: [{ path, message }] } };
}
