import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformApp } from "../src/index.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import { DeviceCertificateAuthority } from "../src/iam/device-certificate-authority.js";
import { MemoryDeviceStore } from "../src/iam/device-store.js";
import { authHeader, createSeededUserStore, TEST_PASSWORD } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface Issued {
  device: { id: string; name: string; status: string; fingerprint: string };
  pfx: string;
  password: string;
}

let caMaterial: Awaited<ReturnType<typeof DeviceCertificateAuthority.create>>;
beforeAll(async () => {
  caMaterial = await DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" });
});

async function setup(options: { withCa?: boolean } = {}) {
  const userStore = createSeededUserStore({ admin: true });
  await userStore.createRole({
    id: "role_devices",
    name: "Dispositivos",
    description: "d",
    permissions: ["system:devices:read", "system:devices:create", "system:devices:revoke"],
  });
  await userStore.createRole({ id: "role_read", name: "Leitura", description: "d", permissions: ["system:devices:read"] });
  await userStore.createUser({ fullname: "Gestor de Dispositivos", username: "gestor.disp", password: TEST_PASSWORD, roleId: "role_devices" });
  await userStore.createUser({ fullname: "Só Leitura", username: "so.leitura", password: TEST_PASSWORD, roleId: "role_read" });
  const auditLog = new AuditLog(new MemoryAuditStore());
  const deviceStore = new MemoryDeviceStore();
  const app = createPlatformApp({
    userStore,
    deviceStore,
    auditLog,
    deviceCertificateAuthority: options.withCa === false ? undefined : new DeviceCertificateAuthority(caMaterial),
  });
  // Cada Usuário entra uma vez; as requisições seguintes reaproveitam o token na mesma plataforma.
  const tokens = new Map<string, Promise<Record<string, string>>>();
  const as = (username: string) => ({
    request: async (path: string, init: RequestInit = {}) => {
      if (!tokens.has(username)) tokens.set(username, authHeader(app, username));
      return app.request(path, { ...init, headers: { ...init.headers, ...(await tokens.get(username)) } });
    },
  });
  const issue = async (username: string, body: object = { name: "Caixa 1" }) =>
    as(username).request("/api/iam/devices", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  return { app, as, issue, auditLog, deviceStore };
}

describe("Dispositivos (/api/iam/devices)", () => {
  it("emite um Dispositivo e devolve o .pfx e a senha uma única vez", async () => {
    const { issue, as } = await setup();
    const res = await issue("gestor.disp");
    expect(res.status).toBe(201);
    const issued = (await res.json()) as Issued;

    expect(issued.device).toMatchObject({ name: "Caixa 1", status: "active" });
    expect(issued.device.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // O .pfx devolvido abre com a senha devolvida (verificado pelo openssl, independente da nossa implementação).
    const dir = mkdtempSync(join(tmpdir(), "celestia-devices-"));
    const pfxPath = join(dir, "d.pfx");
    writeFileSync(pfxPath, Buffer.from(issued.pfx, "base64"));
    const subject = execFileSync("openssl", ["pkcs12", "-in", pfxPath, "-passin", `pass:${issued.password}`, "-nokeys", "-clcerts"], { encoding: "utf8" });
    expect(subject).toContain("Caixa 1");

    // A listagem não carrega a senha, o .pfx nem nada da chave privada.
    const listed = await as("gestor.disp").request("/api/iam/devices");
    expect(listed.status).toBe(200);
    const text = await listed.text();
    expect(text).not.toContain(issued.password);
    expect(text).not.toContain(issued.pfx);
    expect(JSON.parse(text)).toEqual([issued.device]);
  });

  it("exige autenticação e as permissões read, create e revoke", async () => {
    const { app, issue, as } = await setup();
    expect((await app.request("/api/iam/devices")).status).toBe(401);

    expect((await issue("so.leitura")).status).toBe(403);
    expect((await as("so.leitura").request("/api/iam/devices")).status).toBe(200);

    const created = (await (await issue("gestor.disp")).json()) as Issued;
    const revoke = await as("so.leitura").request(`/api/iam/devices/${created.device.id}/revoke`, { method: "POST" });
    expect(revoke.status).toBe(403);
  });

  it("valida o nome", async () => {
    const { issue } = await setup();
    expect((await issue("gestor.disp", { name: "" })).status).toBe(400);
  });

  it("responde 503 quando a CA não está configurada", async () => {
    const { as } = await setup({ withCa: false });
    const res = await as("gestor.disp").request("/api/iam/devices", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name: "Caixa" }) });
    expect(res.status).toBe(503);
  });

  it("revoga de forma definitiva, e revogar de novo ou um inexistente responde de forma previsível", async () => {
    const { issue, as, deviceStore } = await setup();
    const created = (await (await issue("gestor.disp")).json()) as Issued;

    const revoked = await as("gestor.disp").request(`/api/iam/devices/${created.device.id}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ id: created.device.id, status: "revoked" });
    expect(await deviceStore.findActiveByFingerprint(created.device.fingerprint)).toBeNull();

    const again = await as("gestor.disp").request(`/api/iam/devices/${created.device.id}/revoke`, { method: "POST" });
    expect(again.status).toBe(200);

    const missing = await as("gestor.disp").request("/api/iam/devices/nao-existe/revoke", { method: "POST" });
    expect(missing.status).toBe(404);
  });

  it("grava emissão e revogação no Audit Log, sem a senha nem o .pfx", async () => {
    const { issue, as, auditLog } = await setup();
    const created = (await (await issue("gestor.disp")).json()) as Issued;
    await as("gestor.disp").request(`/api/iam/devices/${created.device.id}/revoke`, { method: "POST" });

    const entries = await auditLog.list({ plugin: "iam" });
    expect(entries.map((e) => e.action).sort()).toEqual(["issue_device", "revoke_device"]);
    const issueEntry = entries.find((e) => e.action === "issue_device")!;
    expect(issueEntry).toMatchObject({ actorName: "Gestor de Dispositivos", targetType: "device", targetId: created.device.id });
    expect(issueEntry.summary).toBe('Emitiu o certificado do Dispositivo "Caixa 1".');
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(created.password);
    expect(serialized).not.toContain(created.pfx);
  });
});
