import { resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { defineModule, type ModuleDef } from "@platform/core/module";
import { requirePermission } from "../iam/middleware.js";
import type { AuditLog } from "./audit-log.js";

/** Pasta de migrations do Module `audit` (schema Postgres "audit"). */
export const AUDIT_MIGRATIONS = { folder: resolve(import.meta.dirname, "migrations"), schema: "audit" };

export interface AuditModuleDeps {
  auditLog: AuditLog;
  auth: MiddlewareHandler;
}

const Query = z.object({
  targetType: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  plugin: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Module `audit`: consulta do Audit Log em /api/audit (somente leitura; a gravação é por `AuditLog.record`). */
export function createAuditModule({ auditLog, auth }: AuditModuleDeps): ModuleDef {
  return defineModule({
    id: "audit",
    version: "1.0.0",
    prefix: "/api/audit",
    migrations: AUDIT_MIGRATIONS,
    register({ routes }) {
      routes.get("/", auth, requirePermission("system:audit:read"), zValidator("query", Query), async (c) =>
        c.json(await auditLog.list(c.req.valid("query"))),
      );
    },
  });
}
