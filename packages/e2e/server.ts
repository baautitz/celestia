// Backend de testes de navegador: mesma app Hono, stores em memoria, um administrador semeado.
// NODE_ENV=test impede o auto-start de packages/server/src/index.ts; aqui o servidor sobe explicitamente.
process.env.NODE_ENV = "test";

const { serve } = await import("@hono/node-server");
const { createPlatformApp } = await import("../server/src/index.ts");
const { MemoryUserStore } = await import("../server/src/iam/user-store.ts");
const { PasswordService } = await import("../server/src/iam/password-service.ts");
const { ADMIN_USERNAME, ADMIN_PASSWORD } = await import("./tests/credentials.ts");

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
      externals: {},
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ],
});
await store.setAdmin("usr_e2e_admin", true);

const port = Number(process.env.E2E_API_PORT) || 3100;
serve({ fetch: createPlatformApp({ userStore: store }).fetch, port });
console.log(`Backend E2E em http://localhost:${port}`);
