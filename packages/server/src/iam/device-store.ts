import { randomUUID } from "node:crypto";
import type { CreateDeviceInput, Device } from "@platform/shared";

export class DeviceNotFoundError extends Error {
  constructor() {
    super("Dispositivo não encontrado.");
    this.name = "DeviceNotFoundError";
  }
}

export class DuplicateDeviceFingerprintError extends Error {
  constructor() {
    super("Já existe um Dispositivo com este certificado.");
    this.name = "DuplicateDeviceFingerprintError";
  }
}

export interface DeviceStore {
  create(input: CreateDeviceInput): Promise<Device>;
  /** Do mais novo para o mais antigo, incluindo os revogados. */
  list(): Promise<Device[]>;
  /** Só devolve Dispositivo ativo: revogado é tratado como inexistente. */
  findActiveByFingerprint(fingerprint: string): Promise<Device | null>;
  findById(id: string): Promise<Device | null>;
  /** Definitivo e idempotente: revogar de novo devolve o registro sem alterar data nem autor. */
  revoke(id: string, revokedBy?: string): Promise<Device>;
}

export class MemoryDeviceStore implements DeviceStore {
  private devices = new Map<string, Device>();

  async create(input: CreateDeviceInput): Promise<Device> {
    for (const device of this.devices.values()) {
      if (device.fingerprint === input.fingerprint) throw new DuplicateDeviceFingerprintError();
    }
    const device: Device = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      status: "active",
      fingerprint: input.fingerprint,
      serial: input.serial,
      notAfter: input.notAfter,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    this.devices.set(device.id, device);
    return { ...device };
  }

  async list(): Promise<Device[]> {
    return [...this.devices.values()].reverse().map((d) => ({ ...d }));
  }

  async findActiveByFingerprint(fingerprint: string): Promise<Device | null> {
    for (const device of this.devices.values()) {
      if (device.fingerprint === fingerprint && device.status === "active") return { ...device };
    }
    return null;
  }

  async findById(id: string): Promise<Device | null> {
    const device = this.devices.get(id);
    return device ? { ...device } : null;
  }

  async revoke(id: string, revokedBy?: string): Promise<Device> {
    const device = this.devices.get(id);
    if (!device) throw new DeviceNotFoundError();
    if (device.status === "active") {
      device.status = "revoked";
      device.revokedAt = new Date().toISOString();
      device.revokedBy = revokedBy;
    }
    return { ...device };
  }
}
