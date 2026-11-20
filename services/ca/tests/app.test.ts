import { describe, it, expect, beforeAll, vi } from "vitest";
import { createCaApp, type CaLogger } from "../src/app.js";
import { defined } from "./helpers/defined.js";
import { DeviceCertificateAuthority } from "../src/authority.js";
import { DuplicateDeviceFingerprintError, MemoryDeviceStore } from "../src/device-store.js";

const SECRET = "chave-em-comum-com-mais-de-32-caracteres";
const CALLBACK = "https://app.exemplo.com/login/certificado";
const AUTH = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let authority: DeviceCertificateAuthority;
beforeAll(async () => {
  authority = new DeviceCertificateAuthority(await DeviceCertificateAuthority.create({ commonName: "Celestia CA (teste)" }));
});

function setup(options: { withAuthority?: boolean; deviceStore?: MemoryDeviceStore; logger?: CaLogger } = {}) {
  const deviceStore = options.deviceStore ?? new MemoryDeviceStore();
  const app = createCaApp({
    deviceStore,
    authority: options.withAuthority === false ? undefined : authority,
    sharedSecret: SECRET,
    publicUrl: "https://acesso.exemplo.com",
    callbackUrl: CALLBACK,
    logger: options.logger,
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

describe("todas as rotas da API", () => {
  const routes: { method: string; path: string; body?: unknown }[] = [
    { method: "GET", path: "/devices" },
    { method: "GET", path: "/devices/abc" },
    { method: "POST", path: "/devices", body: { name: "Caixa 1" } },
    { method: "POST", path: "/devices/abc/revoke", body: {} },
    { method: "DELETE", path: "/devices/abc" },
    { method: "POST", path: "/challenges", body: { userId: "usr_1" } },
    { method: "POST", path: "/challenges/exchange", body: { challengeId: crypto.randomUUID() } },
  ];

  it.each(routes)("$method $path responde 401 com a chave errada, sem emitir nada", async ({ method, path, body }) => {
    const { app, deviceStore } = setup();
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${"x".repeat(40)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.status).toBe(401);
    expect(await deviceStore.list()).toEqual([]);
  });

  it("nunca deixa a resposta em cache, nem a do .pfx", async () => {
    const { app, call } = setup();
    expect((await call("/devices", { name: "Caixa 1" })).headers.get("cache-control")).toBe("no-store");
    expect((await call("/devices")).headers.get("cache-control")).toBe("no-store");
    expect((await app.request("/verify")).headers.get("cache-control")).toBe("no-store");
  });

  it("limita o tamanho de quem agiu e do código", async () => {
    const { call } = setup();
    expect((await call("/devices", { name: "Caixa", createdBy: "u".repeat(101) })).status).toBe(400);
    expect((await call("/devices/abc/revoke", { revokedBy: "u".repeat(101) })).status).toBe(400);
    expect((await call("/challenges", { userId: "u".repeat(101) })).status).toBe(400);
    expect((await call("/challenges/exchange", { challengeId: "x" })).status).toBe(400);
    expect((await call("/challenges/exchange", { challengeId: crypto.randomUUID(), code: "c".repeat(201) })).status).toBe(400);
  });
});

describe("falhas na emissão", () => {
  it("responde 409 e não devolve o .pfx se o fingerprint já existe", async () => {
    const deviceStore = new MemoryDeviceStore();
    vi.spyOn(deviceStore, "create").mockRejectedValueOnce(new DuplicateDeviceFingerprintError());
    const { call } = setup({ deviceStore });
    const res = await call("/devices", { name: "Caixa 1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Já existe um Dispositivo com este certificado." });
  });

  it("responde JSON 500 sem vazar o erro e registra só o essencial", async () => {
    const deviceStore = new MemoryDeviceStore();
    vi.spyOn(deviceStore, "create").mockRejectedValueOnce(new Error("connection to 10.0.0.5 refused"));
    const logger = { error: vi.fn() };
    const { call } = setup({ deviceStore, logger });
    const res = await call("/devices", { name: "Caixa 1", createdBy: "usr_1" });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Erro interno da autoridade certificadora." });
    expect(text).not.toContain("10.0.0.5");
    expect(logger.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(logger.error.mock.calls[0]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("Caixa 1");
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
    const res = await call("/devices", { name: "  " });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: { path: unknown[]; message: string }[] } };
    expect(body.error.issues[0]?.path).toEqual(["name"]);
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
    const location = new URL(defined(verify.headers.get("location"), "the callback location"));
    expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
    expect(location.searchParams.get("challenge")).toBe(challengeId);
    const code = defined(location.searchParams.get("code"), "the callback code");
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
      const location = new URL(defined(verify.headers.get("location"), "the callback location"));
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
    const code = defined(new URL(defined(verify.headers.get("location"), "the callback location")).searchParams.get("code"), "the callback code");
    await call(`/devices/${device.id}/revoke`, {});
    expect((await exchange(call, challengeId, code)).status).toBe(403);
  });

  it("volta sempre para o endereço fixo da configuração, mesmo com desafio desconhecido", async () => {
    const { app } = setup();
    const verify = await app.request("/verify?challenge=https://evil.example&callback=https://evil.example");
    expect(verify.status).toBe(302);
    const location = new URL(defined(verify.headers.get("location"), "the callback location"));
    expect(location.origin).toBe("https://app.exemplo.com");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("com o desafio malformado volta ao app sem ecoá-lo", async () => {
    const { app } = setup();
    for (const query of ["", "?challenge=abc", `?challenge=${"a".repeat(5000)}`]) {
      const verify = await app.request(`/verify${query}`);
      expect(verify.status).toBe(302);
      expect(verify.headers.get("location")).toBe(CALLBACK);
    }
  });

  it("não deixa quem não tem a chave abrir nem trocar desafios", async () => {
    const { call } = setup();
    expect((await call("/challenges", { userId: "user-1" }, {})).status).toBe(401);
    expect((await call("/challenges/exchange", { challengeId: crypto.randomUUID() }, {})).status).toBe(401);
  });
});
