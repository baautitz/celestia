import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-plugin-boundaries.mjs", import.meta.url));

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "plugin-boundaries-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
}

describe("check-plugin-boundaries", () => {
  it("aceita Plugin que importa só Core, UI, libs e arquivos próprios", () => {
    const r = check({
      "integrations/ok/src/a.ts": 'import { defineModule } from "@platform/core/module";\nimport { b } from "./b.js";\nimport { Hono } from "hono";\nexport { b, defineModule, Hono };\n',
      "integrations/ok/src/b.ts": "export const b = 1;\n",
      "integrations/ok/src/web.tsx": 'import { Card } from "@platform/ui/components/card";\nexport const C = Card;\n',
    });
    expect(r.status).toBe(0);
  });

  it.each([
    ['import x from "@platform/server";', "@platform/server"],
    ['import x from "@platform/web/src/App";', "@platform/web"],
    ['import x from "../../../packages/server/src/index.js";', "fora do Plugin"],
    ['export { x } from "@platform/shared";', "@platform/shared"],
    ['const x = await import("@platform/server");', "@platform/server"],
  ])("falha em %s", (line, expected) => {
    const r = check({ "integrations/bad/src/a.ts": `${line}\n` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("integrations/bad/src/a.ts:1");
    expect(r.stderr).toContain(expected);
  });
});
