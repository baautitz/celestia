import { describe, it, expect } from "vitest";
import { createPlatformApp } from "../src/index.js";
import { MemoryUserStore } from "../src/iam/user-store.js";
import { AuditLog } from "../src/audit/audit-log.js";
import { MemoryAuditStore } from "../src/audit/audit-store.js";
import { upsertAdminUser } from "../src/cli/create-admin.js";
import { DEFAULT_ADMIN_ROLE_ID } from "../src/iam/initial-roles.js";
import { createSeededUserStore, TEST_PASSWORD, withAuth } from "./helpers/fixtures.js";
import { createTestCertificateAuthority } from "./helpers/certificate-authority.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const DENIED = "Dispositivo não autorizado.";
const UNAVAILABLE = "A autoridade certificadora não está disponível. Tente novamente em instantes.";

async function setup(options: { auditLog?: AuditLog } = {}) {
  const userStore = createSeededUserStore();
  await userStore.createRole({ id: "role_a", name: "A", description: "d", permissions: [] });
  const comCert = await userStore.createUser({ fullname: "Com Cert", username: "com.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: false });
  await userStore.createUser({ fullname: "Sem Cert", username: "sem.cert", password: TEST_PASSWORD, roleId: "role_a", allowWithoutCertificate: true });
  const ca = await createTestCertificateAuthority();
  const { device } = await ca.issueDevice("Caixa 1");
  const app = createPlatformApp({ userStore, certificateAuthority: ca.client, auditLog: options.auditLog });
  const post = (path: string, body: object) => app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  const login = (username: string, password = TEST_PASSWORD) => post("/api/auth/login", { username, password });
  const refresh = (token: string) => post("/api/auth/refresh", { refresh_token: token });
  const refreshTokenOf = async (res: Response) => ((await res.json()) as { refresh_token: string }).refresh_token;
  /** Senha, depois o navegador apresenta `fingerprint` na CA, depois o callback troca o código. */
  const loginWithCertificate = async (username: string, fingerprint?: string) => {
    const first = (await (await login(username)).json()) as { certificateRequired: true; verifyUrl: string };
    const { challengeId, code } = await ca.followVerifyUrl(first.verifyUrl, fingerprint);
    return post("/api/auth/login/certificate", { challengeId, code });
  };
  return { ca, device, comCert, userStore, auditLog: options.auditLog, app, login, refresh, refreshTokenOf, loginWithCertificate, post };
}

describe("login por certificado de Dispositivo", () => {
  it("pede o certificado a quem exige, depois da senha, e devolve o link da CA no lugar dos tokens", async () => {
    const { login } = await setup();
    const res = await login("com.cert");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ certificateRequired: true, verifyUrl: expect.stringMatching(/^https:\/\/acesso\.exemplo\.com\/verify\?challenge=/) });
  });

  it("entra com o certificado de um Dispositivo ativo", async () => {
    const { loginWithCertificate, device } = await setup();
    const res = await loginWithCertificate("com.cert", device.fingerprint);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accessToken: expect.any(String), user: { username: "com.cert" } });
  });

  it("nega quem não apresentou certificado, certificado desconhecido e Dispositivo revogado com a mesma mensagem", async () => {
    const { loginWithCertificate, device, ca } = await setup();
    const none = await loginWithCertificate("com.cert");
    expect(none.status).toBe(403);
    expect(await none.json()).toEqual({ error: DENIED });

    expect((await loginWithCertificate("com.cert", "b".repeat(64))).status).toBe(403);

    await ca.client.revokeDevice(device.id);
    const revoked = await loginWithCertificate("com.cert", device.fingerprint);
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual({ error: DENIED });
  });

  it("o código só vale uma vez e só para o desafio dele", async () => {
    const { login, post, ca, device } = await setup();
    const first = (await (await login("com.cert")).json()) as { verifyUrl: string };
    const second = (await (await login("com.cert")).json()) as { verifyUrl: string };
    const one = await ca.followVerifyUrl(first.verifyUrl, device.fingerprint);
    const two = await ca.followVerifyUrl(second.verifyUrl, device.fingerprint);

    expect((await post("/api/auth/login/certificate", { challengeId: two.challengeId, code: one.code })).status).toBe(403);
    expect((await post("/api/auth/login/certificate", one)).status).toBe(200);
    expect((await post("/api/auth/login/certificate", one)).status).toBe(403);
  });

  it("não revela a exigência de certificado a quem errou a senha", async () => {
    const { login } = await setup();
    const res = await login("com.cert", "SenhaErrada@1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Credenciais inválidas." });
  });

  it("deixa entrar só com a senha quem tem a opção de acesso sem certificado, mesmo com a CA fora do ar", async () => {
    const { login, ca } = await setup();
    ca.setDown(true);
    const res = await login("sem.cert");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accessToken: expect.any(String) });
  });

  it("falha fechado com 503 quando a CA está fora do ar, só para quem exige certificado", async () => {
    const { login, post, ca } = await setup();
    ca.setDown(true);
    const res = await login("com.cert");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: UNAVAILABLE });
    expect((await post("/api/auth/login/certificate", { challengeId: "x", code: "y" })).status).toBe(503);
  });

  it("renova a sessão sem pedir o certificado de novo enquanto o Dispositivo estiver ativo", async () => {
    const { loginWithCertificate, refresh, refreshTokenOf, device } = await setup();
    const token = await refreshTokenOf(await loginWithCertificate("com.cert", device.fingerprint));

    const renewed = await refresh(token);
    expect(renewed.status).toBe(200);
    expect((await refresh(await refreshTokenOf(renewed))).status).toBe(200);
  });

  it("recusa a renovação quando o Dispositivo da sessão foi revogado", async () => {
    const { loginWithCertificate, refresh, refreshTokenOf, ca, device } = await setup();
    const token = await refreshTokenOf(await loginWithCertificate("com.cert", device.fingerprint));

    await ca.client.revokeDevice(device.id, "admin-1");

    expect((await refresh(token)).status).toBe(401);
  });

  it("recusa a renovação com 503, e não a renova às cegas, quando a CA está fora do ar", async () => {
    const { loginWithCertificate, refresh, refreshTokenOf, ca, device } = await setup();
    const token = await refreshTokenOf(await loginWithCertificate("com.cert", device.fingerprint));

    ca.setDown(true);
    const res = await refresh(token);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: UNAVAILABLE });

    ca.setDown(false);
    expect((await refresh(token)).status).toBe(200);
  });

  it("não prende a sessão de quem tem a opção a um Dispositivo", async () => {
    const { login, refresh, refreshTokenOf, ca, device } = await setup();
    const token = await refreshTokenOf(await login("sem.cert"));
    await ca.client.revokeDevice(device.id);
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
    const auditLog = new AuditLog(new MemoryAuditStore());
    const { comCert: user, login, loginWithCertificate } = await setup({ auditLog });

    await login("com.cert", "SenhaErrada@1");
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    // A senha certa só abre o desafio; a negação é registrada quando o certificado não aparece.
    expect((await login("com.cert")).status).toBe(200);
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    expect((await loginWithCertificate("com.cert")).status).toBe(403);
    const [entry] = await auditLog.list({ plugin: "iam" });
    expect(entry).toMatchObject({ action: "deny_login_without_certificate", actorId: user.id, targetId: user.id });
    expect(entry?.summary).toBe('Negou o login de "com.cert": o acesso exige o certificado de um Dispositivo ativo.');
  });

  it("registra o login que entrou por um Dispositivo, e nenhum quando o acesso foi sem certificado", async () => {
    const auditLog = new AuditLog(new MemoryAuditStore());
    const { comCert: user, device, login, loginWithCertificate } = await setup({ auditLog });

    expect((await login("sem.cert")).status).toBe(200);
    expect(await auditLog.list({ plugin: "iam" })).toEqual([]);

    expect((await loginWithCertificate("com.cert", device.fingerprint)).status).toBe(200);
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
