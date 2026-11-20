import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  // Os fluxos compartilham um unico backend em memoria; cada arquivo usa dados proprios.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/mobile.e2e.ts" },
    // Tela de iPhone no Chromium: o WebKit não é instalado na CI.
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" }, testMatch: "**/mobile.e2e.ts" },
  ],
  webServer: [
    {
      // Backend com stores em memoria e um administrador semeado (sem Postgres).
      command: "pnpm exec tsx server.ts",
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_PORT: String(WEB_PORT),
        // Chave descartavel de 16 bytes (32 caracteres hex), so para os testes (cifra a senha da conexao).
        ERP_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("hex"),
      },
      // Estado em memoria: sempre um backend novo, para os testes serem repetiveis.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @platform/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      // Nunca reaproveita um Vite que ja esteja na porta: ele poderia apontar para outro backend ou ter codigo velho.
      // Com --strictPort, porta ocupada falha com mensagem clara.
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
