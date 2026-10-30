import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { assertMigrationsUpToDate, runModuleMigrations } from "@platform/core/migrations";
import { DeviceNotFoundError, DuplicateDeviceFingerprintError } from "../src/device-store.js";
import { CA_MIGRATIONS } from "../src/migrations.js";
import { PostgresDeviceStore } from "../src/postgres-device-store.js";
import { createTestPool, dbTestsEnabled } from "./helpers/test-db.js";

describe.skipIf(!dbTestsEnabled)("Dispositivos contra Postgres real", () => {
  // Criados no beforeAll: o corpo do describe roda mesmo quando a suíte é ignorada.
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pool = createTestPool();
    db = drizzle({ client: pool });
    await runModuleMigrations(db, [CA_MIGRATIONS]);
    await assertMigrationsUpToDate(db, [CA_MIGRATIONS]);
  });
  afterAll(async () => {
    await pool?.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE ca.devices`);
  });

  const input = (n: number) => ({
    name: `Caixa ${n}`,
    fingerprint: n.toString(16).padStart(64, "0"),
    serial: `0${n}`,
    notAfter: "2036-01-01T00:00:00.000Z",
  });

  it("aplica a migration no schema próprio da CA e rodar de novo não faz nada", async () => {
    expect(await runModuleMigrations(db, [CA_MIGRATIONS])).toEqual([{ moduleId: "ca", applied: [] }]);
    const tables = await db.execute<{ schema: string; name: string }>(sql`
      SELECT table_schema AS schema, table_name AS name FROM information_schema.tables WHERE table_schema = 'ca'
    `);
    expect(tables.rows).toEqual([{ schema: "ca", name: "devices" }]);
  });

  it("registra, encontra só o ativo e revoga de forma definitiva e idempotente", async () => {
    const store = new PostgresDeviceStore(db);
    const device = await store.create(input(1));
    expect(await store.findActiveByFingerprint(input(1).fingerprint)).toEqual(device);

    const revoked = await store.revoke(device.id, "admin-1");
    expect(revoked).toMatchObject({ status: "revoked", revokedBy: "admin-1" });
    expect(await store.findActiveByFingerprint(input(1).fingerprint)).toBeNull();
    expect(await store.revoke(device.id, "admin-2")).toEqual(revoked);
    expect(await store.list()).toEqual([revoked]);
  });

  it("recusa fingerprint duplicado e revogação de Dispositivo inexistente", async () => {
    const store = new PostgresDeviceStore(db);
    await store.create(input(1));
    await expect(store.create({ ...input(2), fingerprint: input(1).fingerprint })).rejects.toBeInstanceOf(DuplicateDeviceFingerprintError);
    await expect(store.revoke("nao-existe")).rejects.toBeInstanceOf(DeviceNotFoundError);
  });
});
