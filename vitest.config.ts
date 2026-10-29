import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: {
    alias: {
      "@platform/shared": path.resolve(__dirname, "./packages/shared/src/index.ts"),
      "@": path.resolve(__dirname, "./packages/web/src"),
    },
  },
});
