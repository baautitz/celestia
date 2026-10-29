import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CreateDeviceInput, Device } from "@platform/shared";
import { devices } from "./schema.js";
import { DeviceNotFoundError, DuplicateDeviceFingerprintError, type DeviceStore } from "./device-store.js";

type DeviceRow = typeof devices.$inferSelect;

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    fingerprint: row.fingerprint,
    serial: row.serial,
    notAfter: row.notAfter.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ?? undefined,
    revokedAt: row.revokedAt?.toISOString(),
    revokedBy: row.revokedBy ?? undefined,
  };
}

export class PostgresDeviceStore implements DeviceStore {
  constructor(private db: NodePgDatabase) {}

  async create(input: CreateDeviceInput): Promise<Device> {
    const [row] = await this.db
      .insert(devices)
      .values({
        id: randomUUID(),
        name: input.name,
        type: input.type,
        fingerprint: input.fingerprint,
        serial: input.serial,
        notAfter: new Date(input.notAfter),
        createdBy: input.createdBy,
      })
      .onConflictDoNothing({ target: devices.fingerprint })
      .returning();
    if (!row) throw new DuplicateDeviceFingerprintError();
    return toDevice(row);
  }

  async list(): Promise<Device[]> {
    const rows = await this.db.select().from(devices).orderBy(desc(devices.createdAt), desc(devices.id));
    return rows.map(toDevice);
  }

  async findActiveByFingerprint(fingerprint: string): Promise<Device | null> {
    const [row] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.fingerprint, fingerprint), eq(devices.status, "active")));
    return row ? toDevice(row) : null;
  }

  async findById(id: string): Promise<Device | null> {
    const [row] = await this.db.select().from(devices).where(eq(devices.id, id));
    return row ? toDevice(row) : null;
  }

  async revoke(id: string, revokedBy?: string): Promise<Device> {
    // Condicional em `status` para a revogação ser atômica e idempotente: quem chega depois não sobrescreve.
    const [revoked] = await this.db
      .update(devices)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy })
      .where(and(eq(devices.id, id), eq(devices.status, "active")))
      .returning();
    if (revoked) return toDevice(revoked);
    const existing = await this.findById(id);
    if (!existing) throw new DeviceNotFoundError();
    return existing;
  }
}
