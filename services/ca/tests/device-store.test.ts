import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDeviceStore, DeviceNotFoundError, DuplicateDeviceFingerprintError } from "../src/device-store.js";

const input = (n: number) => ({
  name: `Caixa ${n}`,
  fingerprint: n.toString(16).padStart(64, "0"),
  serial: `0${n}`,
  notAfter: "2036-01-01T00:00:00.000Z",
  createdBy: "admin-1",
});

describe("DeviceStore (em memória)", () => {
  let store: MemoryDeviceStore;
  beforeEach(() => {
    store = new MemoryDeviceStore();
  });

  it("registra um Dispositivo ativo e o encontra pelo fingerprint", async () => {
    const device = await store.create(input(1));

    expect(device).toMatchObject({ name: "Caixa 1", status: "active", createdBy: "admin-1" });
    expect(await store.findActiveByFingerprint(input(1).fingerprint)).toEqual(device);
    expect(await store.findActiveByFingerprint(input(2).fingerprint)).toBeNull();
  });

  it("revogar tira o Dispositivo do acesso, mas mantém o registro", async () => {
    const device = await store.create(input(1));

    const revoked = await store.revoke(device.id, "admin-2");

    expect(revoked).toMatchObject({ status: "revoked", revokedBy: "admin-2" });
    expect(revoked.revokedAt).toBeDefined();
    expect(await store.findActiveByFingerprint(input(1).fingerprint)).toBeNull();
    expect(await store.list()).toEqual([revoked]);
  });

  it("revogar de novo não muda a data nem quem revogou", async () => {
    const device = await store.create(input(1));
    const first = await store.revoke(device.id, "admin-2");

    const again = await store.revoke(device.id, "admin-3");

    expect(again).toEqual(first);
  });

  it("revogar um Dispositivo inexistente falha", async () => {
    await expect(store.revoke("nao-existe", "admin-2")).rejects.toBeInstanceOf(DeviceNotFoundError);
  });

  it("recusa dois Dispositivos com o mesmo fingerprint", async () => {
    await store.create(input(1));
    await expect(store.create({ ...input(2), fingerprint: input(1).fingerprint })).rejects.toBeInstanceOf(
      DuplicateDeviceFingerprintError,
    );
  });

  it("lista do mais novo para o mais antigo", async () => {
    const a = await store.create(input(1));
    const b = await store.create(input(2));
    expect((await store.list()).map((d) => d.id)).toEqual([b.id, a.id]);
  });
});
