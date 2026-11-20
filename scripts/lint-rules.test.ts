import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));

function lint(code: string, fileName: string) {
  const dir = mkdtempSync(join(cwd, "scripts", ".lint-probe-"));
  try {
    const file = join(dir, fileName);
    writeFileSync(file, code);
    const result = spawnSync("pnpm", ["exec", "biome", "lint", file], { cwd, encoding: "utf8" });
    return { failed: result.status !== 0, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const files = {
  "source file": "probe.ts",
  "test file": "probe.test.ts",
};

describe.each(Object.entries(files))("lint rules in a %s", (_label, filePath) => {
  it("rejects explicit any", () => {
    const { failed, output } = lint("export const x: any = 1;\n", filePath);
    expect(failed).toBe(true);
    expect(output).toContain("noExplicitAny");
  });

  it("rejects as unknown as", () => {
    const { failed, output } = lint("export const x = 1 as unknown as string;\n", filePath);
    expect(failed).toBe(true);
    expect(output).toContain("Double assertion");
  });

  it("rejects as any as", () => {
    const { failed, output } = lint("export const x = 1 as any as string;\n", filePath);
    expect(failed).toBe(true);
    expect(output).toContain("Double assertion");
  });

  it("accepts a single assertion", () => {
    expect(lint("export const x = 1 as number;\n", filePath).failed).toBe(false);
  });
});
