import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MemoryDeviceStore } from "../src/iam/device-store.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import { upsertAdminUser } from "../src/cli/create-admin.js";
import { DEFAULT_ADMIN_ROLE_ID } from "../src/iam/initial-roles.js";
import { createSeededUserStore, TEST_PASSWORD, withAuth } from "./helpers/fixtures.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const FINGERPRINT = "a".repeat(64);
const DENIED = "Este acesso exige um Dispositivo homologado. Fale com um administrador.";

async function setup() {
  const userStore = createSeededUserStore();
  await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
  await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
  await userStore.createUser({
    fullname: "Sem Cert",
    username: "sem.cert",
    password: TEST_PASSWORD,
    roleId: "role_a",
    allowWithoutCertificate: true,
  });
  const deviceStore = new MemoryDeviceStore();
  const device = await deviceStore.create({
    name: "Caixa 1",
    fingerprint: FINGERPRINT,
    serial: "01",
    notAfter: "2036-01-01T00:00:00.000Z",
  });
  // Fingerprint que o servidor "leu" do certificado da conexão; muda de um passo para outro.
  const presented: { fingerprint?: string } = {};
  const app = createPlatformApp({ userStore, deviceStore, clientCertificateFingerprint: () => presented.fingerprint });
  const login = (username: string, password = TEST_PASSWORD) =>
    app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username, password }) });
  const refresh = (token: string) =>
    app.request("/api/auth/refresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: token }) });
  const refreshTokenOf = async (res: Response) => ((await res.json()) as { refresh_token: string }).refresh_token;
  return { presented, deviceStore, device, login, refresh, refreshTokenOf };
}

describe("login e refresh com certificado de Dispositivo", () => {
  it("nega o login de quem exige certificado e não apresentou nenhum", async () => {
    const { login } = await setup();
    const res = await login("com.cert");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: DENIED });
  });

  it("aceita o login com o certificado de um Dispositivo ativo", async () => {
    const { login, presented } = await setup();
    presented.fingerprint = FINGERPRINT;
    expect((await login("com.cert")).status).toBe(200);
  });

  it("nega certificado desconhecido e Dispositivo revogado com a mesma mensagem", async () => {
    const { login, presented, deviceStore, device } = await setup();
    presented.fingerprint = "b".repeat(64);
    const unknown = await login("com.cert");
    expect(unknown.status).toBe(403);

    presented.fingerprint = FINGERPRINT;
    await deviceStore.revoke(device.id);
    const revoked = await login("com.cert");
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual(await unknown.json());
  });

  it("não revela a exigência de certificado a quem errou a senha", async () => {
    const { login } = await setup();
    const res = await login("com.cert", "SenhaErrada@1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Credenciais inválidas." });
  });

  it("deixa entrar sem certificado quem tem a opção de acesso sem certificado", async () => {
    const { login, presented } = await setup();
    expect((await login("sem.cert")).status).toBe(200);
    presented.fingerprint = "b".repeat(64);
    expect((await login("sem.cert")).status).toBe(200);
  });

  it("aceita um leitor de certificado assíncrono", async () => {
    const { presented, deviceStore } = await setup();
    void presented;
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
    const app = createPlatformApp({ userStore, deviceStore, clientCertificateFingerprint: async () => FINGERPRINT });
    const res = await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "com.cert", password: TEST_PASSWORD }) });
    expect(res.status).toBe(200);
  });

  it("renova a sessão sem pedir o certificado de novo enquanto o Dispositivo estiver ativo", async () => {
    const { login, refresh, refreshTokenOf, presented } = await setup();
    presented.fingerprint = FINGERPRINT;
    const token = await refreshTokenOf(await login("com.cert"));

    presented.fingerprint = undefined;
    const renewed = await refresh(token);
    expect(renewed.status).toBe(200);
    expect((await refresh(await refreshTokenOf(renewed))).status).toBe(200);
  });

  it("recusa a renovação quando o Dispositivo da sessão foi revogado", async () => {
    const { login, refresh, refreshTokenOf, presented, deviceStore, device } = await setup();
    presented.fingerprint = FINGERPRINT;
    const token = await refreshTokenOf(await login("com.cert"));

    await deviceStore.revoke(device.id, "admin-1");

    expect((await refresh(token)).status).toBe(401);
  });

  it("não prende a sessão de quem tem a opção ao Dispositivo apresentado", async () => {
    const { login, refresh, refreshTokenOf, presented, deviceStore, device } = await setup();
    presented.fingerprint = FINGERPRINT;
    const token = await refreshTokenOf(await login("sem.cert"));

    await deviceStore.revoke(device.id);

    expect((await refresh(token)).status).toBe(200);
  });
});

describe("acesso sem certificado: quem altera e o que acontece com as sessões", () => {
  it("só administrador liga ou desliga a opção; quem só gerencia Usuários recebe 403", async () => {
    const userStore = createSeededUserStore({ admin: true });
    await userStore.createRole({ id: "role_gestor", name: "G", description: "d", permissions: ["system:users:update", "system:users:create", "system:users:read"] });
    const gestor = await userStore.createUser({ fullname: "Gestor", username: "gestor", password: TEST_PASSWORD, roleId: "role_gestor" });
    const alvo = await userStore.createUser({ fullname: "Alvo Teste", username: "alvo", password: TEST_PASSWORD, roleId: "role_gestor" });
    const app = createPlatformApp({ userStore });
    const put = (as: string, id: string, body: object) =>
      withAuth(app, as).request(`/api/iam/users/${id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(body) });

    expect((await put("gestor", alvo.id, { allowWithoutCertificate: false })).status).toBe(403);
    expect((await put("gestor", gestor.id, { allowWithoutCertificate: true })).status).toBe(403);
    expect((await put("test.root", alvo.id, { allowWithoutCertificate: false })).status).toBe(200);

    const create = (as: string, allow: boolean) =>
      withAuth(app, as).request("/api/iam/users", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ fullname: "Novo Usuário", username: `novo.${as}`, password: TEST_PASSWORD, roleId: "role_gestor", allowWithoutCertificate: allow }),
      });
    expect((await create("gestor", true)).status).toBe(403);
    expect((await create("test.root", true)).status).toBe(201);
  });

  it("mudar a opção encerra as sessões abertas sob a regra anterior", async () => {
    const userStore = createSeededUserStore({ admin: true });
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    const user = await userStore.createUser({ fullname: "Sem Cert", username: "sem.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: true });
    const app = createPlatformApp({ userStore });
    const loginRes = await app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "sem.cert", password: TEST_PASSWORD }) });
    const token = ((await loginRes.json()) as { refresh_token: string }).refresh_token;
    const refresh = () => app.request("/api/auth/refresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ refresh_token: token }) });
    expect((await refresh()).status).toBe(200);

    const res = await withAuth(app, "test.root").request(`/api/iam/users/${user.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ allowWithoutCertificate: false }) });
    expect(res.status).toBe(200);

    expect((await refresh()).status).toBe(401);
  });

  it("o create-admin cria o Administrator com a opção ligada, e --force também liga", async () => {
    const store = new MemoryUserStore();
    await store.createRole({ id: DEFAULT_ADMIN_ROLE_ID, name: "Gestor", permissions: [] });
    const created = await upsertAdminUser(store, { username: "primeiro", fullname: "Primeiro Admin", password: TEST_PASSWORD });
    expect((await store.findById(created.id))?.allowWithoutCertificate).toBe(true);

    await store.updateUser(created.id, { allowWithoutCertificate: false });
    await upsertAdminUser(store, { username: "primeiro", fullname: "Primeiro Admin", password: TEST_PASSWORD, force: true });
    expect((await store.findById(created.id))?.allowWithoutCertificate).toBe(true);
  });
});

describe("Audit Log do acesso por certificado", () => {
  it("registra o login negado por falta de certificado, e só depois da senha correta", async () => {
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    const user = await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
    const auditLog = new AuditLog(new MemoryAuditStore());
    const app = createPlatformApp({ userStore, auditLog });
    const login = (password: string) =>
      app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username: "com.cert", password }) });

    await login("SenhaErrada@1");
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    expect((await login(TEST_PASSWORD)).status).toBe(403);
    const [entry] = await auditLog.list({ plugin: "iam" });
    expect(entry).toMatchObject({ action: "deny_login_without_certificate", actorId: user.id, targetId: user.id });
    expect(entry?.summary).toBe('Negou o login de "com.cert": o acesso exige o certificado de um Dispositivo ativo.');
  });

  it("registra o login que entrou por um Dispositivo, e nenhum quando o acesso foi sem certificado", async () => {
    const userStore = createSeededUserStore();
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    const user = await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
    await userStore.createUser({ fullname: "Sem Cert", username: "sem.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: true });
    const deviceStore = new MemoryDeviceStore();
    const device = await deviceStore.create({ name: "Caixa 1", fingerprint: FINGERPRINT, serial: "01", notAfter: "2036-01-01T00:00:00.000Z" });
    const auditLog = new AuditLog(new MemoryAuditStore());
    const app = createPlatformApp({ userStore, deviceStore, auditLog, clientCertificateFingerprint: () => FINGERPRINT });
    const login = (username: string) =>
      app.request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username, password: TEST_PASSWORD }) });

    expect((await login("sem.cert")).status).toBe(200);
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    expect((await login("com.cert")).status).toBe(200);
    const [entry] = await auditLog.list({ plugin: "iam" });
    expect(entry).toMatchObject({ action: "login_with_device", actorId: user.id, actorName: "Com Cert", targetType: "device", targetId: device.id });
    expect(entry?.summary).toBe('Entrou pelo Dispositivo "Caixa 1".');
  });

  it("registra quando a opção de acesso sem certificado muda, e só quando muda", async () => {
    const userStore = createSeededUserStore({ admin: true });
    await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
    const user = await userStore.createUser({ fullname: "Alvo Teste", username: "alvo", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
    const auditLog = new AuditLog(new MemoryAuditStore());
    const admin = withAuth(createPlatformApp({ userStore, auditLog }), "test.root");
    const put = (allow: boolean) =>
      admin.request(`/api/iam/users/${user.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ allowWithoutCertificate: allow }) });

    await put(false);
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    await put(true);
    await put(false);
    const entries = await auditLog.list({ plugin: "iam" });
    expect(entries.map((e) => e.summary).sort()).toEqual([
      'Deixou de permitir o acesso sem certificado de "alvo".',
      'Permitiu o acesso sem certificado de "alvo".',
    ]);
    expect(entries.every((e) => e.actorName === "Test Root" && e.targetId === user.id)).toBe(true);
  });
});
