import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.severity === 2);
}

const files = {
  "source file": "packages/server/src/__lint_probe.ts",
  "test file": "packages/server/src/__lint_probe.test.ts",
};

describe.each(Object.entries(files))("lint rules in a %s", (_label, filePath) => {
  it("rejects explicit any", async () => {
    const errors = await lint("export const x: any = 1;\n", filePath);
    expect(errors.map((e) => e.ruleId)).toContain("@typescript-eslint/no-explicit-any");
  });

  it("rejects as unknown as", async () => {
    const errors = await lint("export const x = 1 as unknown as string;\n", filePath);
    expect(errors.map((e) => e.message).join()).toContain("Double assertion");
  });

  it("rejects as any as", async () => {
    const errors = await lint("export const x = 1 as any as string;\n", filePath);
    expect(errors.map((e) => e.message).join()).toContain("Double assertion");
  });

  it("accepts a single assertion", async () => {
    const errors = await lint("export const x = 1 as number;\n", filePath);
    expect(errors).toEqual([]);
  });
});
