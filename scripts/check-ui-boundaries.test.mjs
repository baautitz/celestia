import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./check-ui-boundaries.mjs", import.meta.url))

function runTest() {
  const root = mkdtempSync(join(tmpdir(), "ui-boundaries-"))
  const src = join(root, "packages/web/src")
  mkdirSync(src, { recursive: true })

  const cases = {
    "sonner.tsx": 'import { toast } from "sonner"\nexport const a = toast\n',
    "base.tsx": 'import { Dialog } from "@base-ui/react/dialog"\nexport const a = Dialog\n',
    "open.tsx":
      'import { Dialog } from "@platform/ui/components/dialog"\nexport const A = () => <Dialog open={true} onOpenChange={() => {}} />\n',
    "legacy.tsx": 'import { Button } from "@/components/ui/button"\nexport const a = Button\n',
  }
  for (const [name, content] of Object.entries(cases)) writeFileSync(join(src, name), content)

  const run = () => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" })

  const bad = run()
  assert.notEqual(bad.status, 0, "deve falhar com violacoes")
  const out = bad.stderr
  for (const [name, line] of [["sonner.tsx", 1], ["base.tsx", 1], ["open.tsx", 2], ["open.tsx", 2], ["legacy.tsx", 1]]) {
    assert.match(out, new RegExp(`packages/web/src/${name}:${line} `), `${name}:${line} nao citado`)
  }
  assert.match(out, /open declarativo/)
  assert.match(out, /onOpenChange declarativo/)

  const clean = mkdtempSync(join(tmpdir(), "ui-boundaries-clean-"))
  mkdirSync(join(clean, "packages/web/src"), { recursive: true })
  writeFileSync(join(clean, "packages/web/src/ok.tsx"), 'import { Button } from "@platform/ui/components/button"\nexport const a = Button\n')
  const ok = spawnSync(process.execPath, [script, "--root", clean], { encoding: "utf8" })
  assert.equal(ok.status, 0, "arquivo limpo deve passar")
}

const d = globalThis.describe
const t = globalThis.it
if (typeof d === "function" && typeof t === "function") {
  d("check-ui-boundaries", () => {
    t("detecta violações e aceita arquivo limpo", () => {
      runTest()
    })
  })
} else {
  runTest()
  console.log("check-ui-boundaries self-test: ok")
}
