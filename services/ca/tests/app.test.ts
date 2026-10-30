import { describe, it, expect, beforeAll } from "vitest";
import { createCaApp } from "../src/app.js";
import { DeviceCertificateAuthority } from "../src/authority.js";
import { MemoryDeviceStore } from "../src/device-store.js";

const SECRET = "chave-em-comum-com-mais-de-32-caracteres";
const CALLBACK = "https://app.exemplo.com/login/certificado";
const AUTH = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let authority: DeviceCertificateAuthority;
beforeAll(async () => {
  authority = new DeviceCertificateAuthority(await DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" }));
});

function setup(options: { withAuthority?: boolean } = {}) {
  const deviceStore = new MemoryDeviceStore();
  const app = createCaApp({
    deviceStore,
    authority: options.withAuthority === false ? undefined : authority,
    sharedSecret: SECRET,
    publicUrl: "https://acesso.exemplo.com",
    callbackUrl: CALLBACK,
    // Os testes escolhem o certificado "apresentado" por um header; em produção ele vem do proxy.
    readCertificate: (c) => c.req.header("x-test-fingerprint"),
  });
  const call = (path: string, body?: unknown, headers: Record<string, string> = AUTH) =>
    app.request(path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const issue = async (name = "Caixa 1") => (await (await call("/devices", { name, createdBy: "admin-1" })).json()) as {
    device: { id: string; name: string; status: string; fingerprint: string };
    pfx: string;
    password: string;
  };
  return { app, call, issue, deviceStore };
}

describe("autenticação da API", () => {
  it("recusa chamadas sem a chave em comum ou com outra chave", async () => {
    const { call } = setup();
    expect((await call("/devices", undefined, {})).status).toBe(401);
    expect((await call("/devices", undefined, { Authorization: "Bearer outra" })).status).toBe(401);
    expect((await call("/devices", undefined, { Authorization: SECRET })).status).toBe(401);
    expect((await call("/devices", undefined, AUTH)).status).toBe(200);
  });

  it("recusa uma chave em comum curta demais", () => {
    expect(() => createCaApp({ deviceStore: new MemoryDeviceStore(), sharedSecret: "curta", publicUrl: "http://x", callbackUrl: CALLBACK, readCertificate: () => undefined })).toThrow(/32/);
  });
});

describe("Dispositivos", () => {
  it("emite um Dispositivo com o .pfx e a senha, e só guarda o fingerprint", async () => {
    const { call, issue } = setup();
    const issued = await issue();
    expect(issued.device).toMatchObject({ name: "Caixa 1", status: "active", createdBy: "admin-1" });
    expect(issued.pfx.length).toBeGreaterThan(100);
    expect(issued.password.length).toBeGreaterThan(10);
    expect(JSON.stringify(await (await call("/devices")).json())).not.toContain(issued.password);
  });

  it("responde 503 ao emitir sem a CA configurada", async () => {
    const { call } = setup({ withAuthority: false });
    expect((await call("/devices", { name: "Caixa 1" })).status).toBe(503);
  });

  it("valida o nome", async () => {
    const { call } = setup();
    expect((await call("/devices", { name: "  " })).status).toBe(400);
  });

  it("lista, consulta e revoga de forma definitiva e idempotente", async () => {
    const { call, issue } = setup();
    const { device } = await issue();
    expect(await (await call(`/devices/${device.id}`)).json()).toMatchObject({ id: device.id, status: "active" });

    const first = (await (await call(`/devices/${device.id}/revoke`, { revokedBy: "admin-2" })).json()) as { status: string; revokedAt: string; revokedBy: string };
    expect(first).toMatchObject({ status: "revoked", revokedBy: "admin-2" });
    const again = (await (await call(`/devices/${device.id}/revoke`, { revokedBy: "admin-3" })).json()) as typeof first;
    expect(again).toEqual(first);
    expect(await (await call("/devices")).json()).toHaveLength(1);
  });

  it("responde 404 para Dispositivo inexistente", async () => {
    const { call } = setup();
    expect((await call("/devices/nao-existe")).status).toBe(404);
    expect((await call("/devices/nao-existe/revoke", {})).status).toBe(404);
  });
});

describe("desafio de login e leitura do certificado", () => {
  async function open(call: ReturnType<typeof setup>["call"], userId = "user-1") {
    const res = await call("/challenges", { userId });
    expect(res.status).toBe(201);
    return (await res.json()) as { challengeId: string; verifyUrl: string };
  }
  const exchange = (call: ReturnType<typeof setup>["call"], challengeId: string, code?: string) => call("/challenges/exchange", { challengeId, code });

  it("monta o link de leitura no endereço público da CA", async () => {
    const { call } = setup();
    const { challengeId, verifyUrl } = await open(call);
    expect(verifyUrl).toBe(`https://acesso.exemplo.com/verify?challenge=${challengeId}`);
  });

  it("com o certificado de um Dispositivo ativo, volta ao app com o código que o backend troca pelo Dispositivo", async () => {
    const { app, call, issue } = setup();
    const { device } = await issue();
    const { challengeId } = await open(call);

    const verify = await app.request(`/verify?challenge=${challengeId}`, { headers: { "x-test-fingerprint": device.fingerprint.toUpperCase() } });
    expect(verify.status).toBe(302);
    const location = new URL(verify.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(location.searchParams.get("challenge")).toBe(challengeId);
    const code = location.searchParams.get("code")!;
    expect(code).toBeTruthy();
    expect(location.search).not.toContain(device.fingerprint);

    const res = await exchange(call, challengeId, code);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", deviceId: device.id, deviceName: "Caixa 1" });
    expect((await exchange(call, challengeId, code)).status).toBe(403);
  });

  it("sem certificado, com certificado desconhecido ou de Dispositivo revogado volta ao app sem código", async () => {
    const { app, call, issue } = setup();
    const { device } = await issue();
    await call(`/devices/${device.id}/revoke`, {});

    for (const fingerprint of [undefined, "b".repeat(64), device.fingerprint]) {
      const { challengeId } = await open(call);
      const verify = await app.request(`/verify?challenge=${challengeId}`, { headers: fingerprint ? { "x-test-fingerprint": fingerprint } : {} });
      expect(verify.status).toBe(302);
      const location = new URL(verify.headers.get("location")!);
      expect(location.searchParams.get("code")).toBeNull();
      const denied = await exchange(call, challengeId);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "device_required", userId: "user-1" });
    }
  });

  it("nega a troca se o Dispositivo foi revogado depois da leitura", async () => {
    const { app, call, issue } = setup();
    const { device } = await issue();
    const { challengeId } = await open(call);
    const verify = await app.request(`/verify?challenge=${challengeId}`, { headers: { "x-test-fingerprint": device.fingerprint } });
    const code = new URL(verify.headers.get("location")!).searchParams.get("code")!;
    await call(`/devices/${device.id}/revoke`, {});
    expect((await exchange(call, challengeId, code)).status).toBe(403);
  });

  it("volta sempre para o endereço fixo da configuração, mesmo com desafio desconhecido", async () => {
    const { app } = setup();
    const verify = await app.request("/verify?challenge=https://evil.example&callback=https://evil.example");
    expect(verify.status).toBe(302);
    const location = new URL(verify.headers.get("location")!);
    expect(location.origin).toBe("https://app.exemplo.com");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("não deixa quem não tem a chave abrir nem trocar desafios", async () => {
    const { call } = setup();
    expect((await call("/challenges", { userId: "user-1" }, {})).status).toBe(401);
    expect((await call("/challenges/exchange", { challengeId: "x" }, {})).status).toBe(401);
  });
});
