import { resolve } from "node:path";

/** Pasta de migrations da CA (schema Postgres "ca"). */
export const CA_MIGRATIONS = { moduleId: "ca", folder: resolve(import.meta.dirname, "migrations"), schema: "ca" };
