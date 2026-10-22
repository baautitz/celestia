import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import type { ClosingPeriodRecord } from "@platform/shared";
import { getAuthenticatedUser, requirePermission } from "../iam/middleware.js";
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

const EditRangeSchema = z
  .object({ startDate: IsoDateSchema, endDate: IsoDateSchema, version: z.number().int().min(1) })
  .refine((d) => d.endDate >= d.startDate, {
    message: "A Data Final não pode ser anterior à Data Inicial.",
    path: ["endDate"],
  });

/** Duas faixas inclusivas compartilham ao menos uma data. */
const overlaps = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }): boolean =>
  a.startDate <= b.endDate && b.startDate <= a.endDate;

/**
 * Plugin `closing_period`: Closing Periods em /api/closing-periods.
 *
 * Eventos before/after: closing_period.close, closing_period.reopen, closing_period.cancel
 * (payload: actorId, periodId, name, startDate, endDate). Um `before` que cancela veta a ação (409).
 * Só se cancela um período aberto; um fechado é reaberto antes.
 */
export function createClosingPeriodModule({ store, auth }: ClosingPeriodModuleDeps): ModuleDef {
  return defineModule({
    id: "closing_period",
    version: "1.0.0",
    prefix: "/api/closing-periods",
    permissions: CLOSING_PERIOD_PERMISSIONS,
    migrations: CLOSING_PERIOD_MIGRATIONS,
    register({ routes, events }) {
      const P = CLOSING_PERIOD_PERMISSIONS.keys;
      const NOT_FOUND = "Período de Fechamento não encontrado.";

      routes.get("/", auth, requirePermission(P["period:read"]), async (c) => {
        const all = await store.list();
        return c.json(all.sort((a, b) => b.startDate.localeCompare(a.startDate)));
      });

      routes.get("/:id", auth, requirePermission(P["period:read"]), async (c) => {
        const period = await store.get(c.req.param("id"));
        if (!period) return c.json({ error: NOT_FOUND }, 404);
        return c.json(period);
      });

      const detail = (p: ClosingPeriodRecord) => ({ periodId: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate });

      /** Transição de estado vetável: close (open -> closed) e reopen (closed -> open). */
      const transition = (action: "close" | "reopen", from: "open" | "closed", to: "open" | "closed", refusal: string) =>
        routes.post(`/:id/${action}`, auth, requirePermission(P[`period:${action}`]), async (c) => {
          const period = await store.get(c.req.param("id"));
          if (!period) return c.json({ error: NOT_FOUND }, 404);
          if (period.status !== from) return c.json({ error: refusal }, 409);
          const ran = await events.run(
            `closing_period.${action}`,
            { actorId: getAuthenticatedUser(c).sub, ...detail(period) },
            async () => {
              const updated: ClosingPeriodRecord = { ...period, status: to, version: period.version + 1, updatedAt: new Date().toISOString() };
              await store.save(updated);
              return updated;
            },
          );
          if (ran.cancelled) return c.json({ error: ran.reason }, 409);
          return c.json(ran.result);
        });
      transition("close", "open", "closed", "O período já está fechado.");
      transition("reopen", "closed", "open", "O período já está aberto.");

      routes.delete("/:id", auth, requirePermission(P["period:cancel"]), async (c) => {
        const period = await store.get(c.req.param("id"));
        if (!period) return c.json({ error: NOT_FOUND }, 404);
        if (period.status !== "open") return c.json({ error: "Só é possível cancelar um período aberto. Reabra o período antes." }, 409);
        const ran = await events.run(
          "closing_period.cancel",
          { actorId: getAuthenticatedUser(c).sub, ...detail(period) },
          () => store.delete(period.id),
        );
        if (ran.cancelled) return c.json({ error: ran.reason }, 409);
        return c.json({ success: true });
      });

      routes.put(
        "/:id/range",
        auth,
        requirePermission(P["period:update"]),
        zValidator("json", EditRangeSchema),
        async (c) => {
          const body = c.req.valid("json");
          const current = await store.get(c.req.param("id"));
          if (!current) return c.json({ error: "Período de Fechamento não encontrado." }, 404);
          if (current.status !== "open") {
            return c.json({ error: "A faixa de um Período de Fechamento fechado não pode ser editada. Reabra-o antes." }, 409);
          }
          const clash = (await store.list()).find((p) => p.id !== current.id && overlaps(p, body));
          if (clash) {
            return c.json(
              { error: `A nova faixa coincide com "${clash.name}" (${clash.startDate} a ${clash.endDate}). Uma data pertence a no máximo um Período de Fechamento.` },
              400,
            );
          }
          const next: ClosingPeriodRecord = {
            ...current,
            startDate: body.startDate,
            endDate: body.endDate,
            version: body.version + 1,
            updatedAt: new Date().toISOString(),
          };
          if (!(await store.updateIfCurrent(next, body.version))) {
            return c.json({ error: "O período foi alterado por outra pessoa. Recarregue e tente novamente." }, 409);
          }
          return c.json(next);
        },
      );

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
            version: 1,
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
