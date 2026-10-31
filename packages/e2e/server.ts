// Backend de testes de navegador: mesma app Hono, stores em memoria, um administrador semeado.
// NODE_ENV=test impede o auto-start de packages/server/src/index.ts; aqui o servidor sobe explicitamente.
process.env.NODE_ENV = "test";

const { serve } = await import("@hono/node-server");
const { createPlatformApp } = await import("../server/src/index.ts");
const { MemoryUserStore } = await import("../server/src/iam/user-store.ts");
const { PasswordService } = await import("../server/src/iam/password-service.ts");
const { createCaApp, createMockCertificateReader, DeviceCertificateAuthority, MemoryDeviceStore } = await import("../../services/ca/src/index.ts");
const { HttpCertificateAuthorityClient } = await import("../server/src/iam/certificate-authority-client.ts");
const { ADMIN_USERNAME, ADMIN_PASSWORD, CERT_USERNAME, CERT_PASSWORD, CERT_DEVICE_NAME } = await import("./tests/credentials.ts");

const store = new MemoryUserStore({
  roles: [
    { id: "role_admin", name: "Administradores", permissions: [] },
    { id: "role_operadores", name: "Operadores", permissions: ["system:users:read"] },
  ],
  users: [
    {
      id: "usr_e2e_admin",
      username: ADMIN_USERNAME,
      fullname: "Administrador E2E",
      passwordHash: PasswordService.hash(ADMIN_PASSWORD),
      roleId: "role_admin",
      status: "active",
      // Sem Dispositivo emitido ainda, o administrador do e2e entra só com a senha.
      allowWithoutCertificate: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "usr_e2e_cert",
      username: CERT_USERNAME,
      fullname: "Usuário com Certificado E2E",
      passwordHash: PasswordService.hash(CERT_PASSWORD),
      roleId: "role_operadores",
      status: "active",
      // Exige o certificado de um Dispositivo ativo.
      allowWithoutCertificate: false,
      createdAt: new Date().toISOString(),
    },
  ],
});
await store.setAdmin("usr_e2e_admin", true);

const port = Number(process.env.E2E_API_PORT) || 3100;
// Autoridade certificadora só em memória. Atende por HTTP de verdade (a leitura do certificado redireciona o navegador)
// e o backend a chama direto, sem rede. A leitura apresenta o Dispositivo CERT_DEVICE_NAME, como o proxy faria.
const sharedSecret = "chave-em-comum-do-e2e-com-mais-de-32-caracteres";
const caPort = Number(process.env.E2E_CA_PORT) || 3101;
const webPort = Number(process.env.E2E_WEB_PORT) || 5174;
const deviceStore = new MemoryDeviceStore();
const caApp = createCaApp({
  deviceStore,
  authority: new DeviceCertificateAuthority(await DeviceCertificateAuthority.create({ commonName: "Celestia CA (e2e)" })),
  sharedSecret,
  publicUrl: `http://localhost:${caPort}`,
  callbackUrl: `http://localhost:${webPort}/login/certificado`,
  readCertificate: createMockCertificateReader({ deviceStore, deviceName: CERT_DEVICE_NAME }),
});
const certificateAuthority = new HttpCertificateAuthorityClient({
  baseUrl: "http://ca.e2e",
  secret: sharedSecret,
  fetch: (input, init) => Promise.resolve(caApp.request(String(input), init)),
});
await certificateAuthority.issueDevice({ name: CERT_DEVICE_NAME });
serve({ fetch: caApp.fetch, port: caPort });
serve({ fetch: createPlatformApp({ userStore: store, certificateAuthority }).fetch, port });
console.log(`Backend E2E em http://localhost:${port} (autoridade certificadora em http://localhost:${caPort})`);
