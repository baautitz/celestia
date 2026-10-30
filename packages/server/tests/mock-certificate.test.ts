import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { MemoryDeviceStore } from "../src/iam/device-store.js";
import { createMockCertificateReader } from "../src/boot/mock-certificate.js";

const input = (n: number) => ({ name: `Caixa ${n}`, fingerprint: n.toString(16).padStart(64, "0"), serial: `0${n}`, notAfter: "2036-01-01T00:00:00.000Z" });

async function read(deviceStore: MemoryDeviceStore, deviceName?: string): Promise<string | null> {
  const reader = createMockCertificateReader({ deviceStore, deviceName });
  const app = new Hono();
  app.get("/", async (c) => c.json({ fingerprint: (await reader(c)) ?? null }));
  return ((await (await app.request("/")).json()) as { fingerprint: string | null }).fingerprint;
}

describe("certificado simulado (desenvolvimento)", () => {
  it("apresenta o certificado do Dispositivo ativo com o nome informado", async () => {
    const store = new MemoryDeviceStore();
    await store.create(input(1));
    await store.create(input(2));
    expect(await read(store, "Caixa 2")).toBe(input(2).fingerprint);
  });

  it("não apresenta nada sem nome, com nome desconhecido ou com o Dispositivo revogado", async () => {
    const store = new MemoryDeviceStore();
    const device = await store.create(input(1));
    expect(await read(store)).toBeNull();
    expect(await read(store, "Outro")).toBeNull();
    await store.revoke(device.id);
    expect(await read(store, "Caixa 1")).toBeNull();
  });
});
