import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Sem limite, o Vitest sobe um processo por núcleo e a suíte satura a CPU (e derruba a VPS); os testes de UI
    // estouram o tempo sob essa carga. O limite mantém a máquina respirando e a suíte estável.
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@platform/shared": path.resolve(__dirname, "./packages/shared/src/index.ts"),
      "@platform/ca": path.resolve(__dirname, "./services/ca/src/index.ts"),
      "@": path.resolve(__dirname, "./packages/web/src"),
    },
  },
});
