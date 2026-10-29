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
  const plugin = join(root, "integrations/acme/src")
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, "page.tsx"), 'import { toast } from "sonner"\nexport const a = toast\n')
  writeFileSync(
    join(src, "intrinsic.tsx"),
    ["export const A = () => <div>x</div>", "export const B = () => <h1>x</h1>", "export const C = () => <span />", ""].join("\n"),
  )
  writeFileSync(
    join(src, "styled.tsx"),
    'import { Card } from "@platform/ui/components/card"\nexport const A = () => <Card className="p-4" style={{ color: "red" }} />\n',
  )
  writeFileSync(
    join(src, "sizes.tsx"),
    [
      'import { Button } from "@platform/ui/components/button"',
      'export const A = () => <Button size="sm" />',
      'export const B = () => <Button size="icon" />',
      'export const C = () => <Button size="default" />',
      "export const D = () => <Button />",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(src, "gaps.tsx"),
    [
      'import { SidebarMenuButton } from "@platform/ui/components/sidebar"',
      "export const A = () => <SidebarMenuButton size=\"lg\" />",
      "export const B = () => <table />",
      "export const C = () => <img />",
      "export const D = () => <hr />",
      "export const E = () => <dl />",
      "export const F = (props: object) => <Card {...props} {...{ className: \"x\" }} />",
      "const extra = { style: { color: \"red\" } }",
      "export const G = () => <Card {...extra} />",
      "",
    ].join("\n"),
  )
  mkdirSync(join(root, "integrations/acme/scripts"), { recursive: true })
  writeFileSync(join(root, "integrations/acme/scripts/tool.tsx"), 'import { toast } from "sonner"\nexport const a = toast\n')
  for (const [name, content] of Object.entries(cases)) writeFileSync(join(src, name), content)

  const run = () => spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" })

  const bad = run()
  assert.notEqual(bad.status, 0, "deve falhar com violacoes")
  const out = bad.stderr
  for (const [name, line] of [["sonner.tsx", 1], ["base.tsx", 1], ["open.tsx", 2], ["open.tsx", 2], ["legacy.tsx", 1]]) {
    assert.match(out, new RegExp(`packages/web/src/${name}:${line} `), `${name}:${line} nao citado`)
  }
  for (const [path, line] of [
    ["integrations/acme/src/page.tsx", 1],
    ["packages/web/src/intrinsic.tsx", 1],
    ["packages/web/src/intrinsic.tsx", 2],
    ["packages/web/src/intrinsic.tsx", 3],
    ["packages/web/src/styled.tsx", 2],
    ["packages/web/src/sizes.tsx", 2],
  ]) {
    assert.match(out, new RegExp(`${path}:${line} `), `${path}:${line} nao citado`)
  }
  for (const line of [2, 3, 4, 5, 6, 7, 9]) assert.match(out, new RegExp(`packages/web/src/gaps\\.tsx:${line} `), `gaps:${line} nao citado`)
  assert.match(out, /integrations\/acme\/scripts\/tool\.tsx:1 /, "plugin fora de src")
  assert.match(out, /<div>/)
  assert.match(out, /className/)
  assert.match(out, /style/)
  assert.doesNotMatch(out, /sizes\.tsx:[345] /, "size icon/default/omitido devem passar")
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
