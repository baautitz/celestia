import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import type { ClosingPeriodRecord } from "@platform/shared";
import { requirePermission } from "../iam/middleware.js";
import { CLOSING_PERIOD_PERMISSIONS } from "./closing-period-permissions.js";
import type { ClosingPeriodStore } from "./closing-period-store.js";

/** Pasta de migrations do Plugin (schema Postgres "closing_period"). */
export const CLOSING_PERIOD_MIGRATIONS = { folder: resolve(import.meta.dirname, "drizzle"), schema: "closing_period" };

export interface ClosingPeriodModuleDeps {
  store: ClosingPeriodStore;
  auth: MiddlewareHandler;
}

/** Data civil estrita YYYY-MM-DD (e existente no calendário). */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data inexistente.");

const CreateSchema = z
  .object({ name: z.string().min(1), startDate: IsoDateSchema, endDate: IsoDateSchema })
  .refine((d) => d.endDate >= d.startDate, {
    message: "A Data Final não pode ser anterior à Data Inicial.",
    path: ["endDate"],
  });

/** Duas faixas inclusivas compartilham ao menos uma data. */
const overlaps = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

/** Plugin `closing_period`: Closing Periods em /api/closing-periods. */
export function createClosingPeriodModule({ store, auth }: ClosingPeriodModuleDeps): ModuleDef {
  return defineModule({
    id: "closing_period",
    version: "1.0.0",
    prefix: "/api/closing-periods",
    permissions: CLOSING_PERIOD_PERMISSIONS,
    migrations: CLOSING_PERIOD_MIGRATIONS,
    register({ routes }) {
      const P = CLOSING_PERIOD_PERMISSIONS.keys;

      routes.get("/", auth, requirePermission(P["period:read"]), async (c) => {
        const all = await store.list();
        return c.json(all.sort((a, b) => b.startDate.localeCompare(a.startDate)));
      });

      routes.get("/:id", auth, requirePermission(P["period:read"]), async (c) => {
        const period = await store.get(c.req.param("id"));
        if (!period) return c.json({ error: "Período de Fechamento não encontrado." }, 404);
        return c.json(period);
      });

      routes.post(
        "/",
        auth,
        requirePermission(P["period:create"]),
        zValidator("json", CreateSchema),
        async (c) => {
          const body = c.req.valid("json");
          const clash = (await store.list()).find((p) => overlaps(p, body));
          if (clash) {
            return c.json(
              { error: `O período informado coincide com "${clash.name}" (${clash.startDate} a ${clash.endDate}). Uma data pertence a no máximo um Período de Fechamento.` },
              400,
            );
          }
          const now = new Date().toISOString();
          const period: ClosingPeriodRecord = {
            id: `cp_${randomUUID()}`,
            name: body.name,
            startDate: body.startDate,
            endDate: body.endDate,
            status: "open",
            createdAt: now,
            updatedAt: now,
          };
          await store.save(period);
          return c.json(period, 201);
        },
      );
    },
  });
}
